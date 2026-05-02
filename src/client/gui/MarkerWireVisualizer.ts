import { Workspace } from "@rbxts/services";
import { LogControl } from "client/gui/static/LogControl";
import { ServiceIntegrityChecker } from "client/integrity/ServiceIntegrityChecker";
import { Interface } from "engine/client/gui/Interface";
import { Colors } from "engine/shared/Colors";
import { Component } from "engine/shared/component/Component";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { Element } from "engine/shared/Element";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { BlockWireManager } from "shared/blockLogic/BlockWireManager";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";

const markerParent = Element.create("ScreenGui", {
	Name: "Markers",
	ScreenInsets: Enum.ScreenInsets.None,
	IgnoreGuiInset: true,
	DisplayOrder: -1, // to draw behind the wires
	Parent: Interface.getPlayerGui(),
	ResetOnSpawn: false,
});
ServiceIntegrityChecker.whitelistInstance(markerParent);
const wireParent = Element.create("ViewportFrame", {
	Name: "WireViewportFrame",
	Size: UDim2.fromScale(1, 1),
	CurrentCamera: Workspace.CurrentCamera,
	Transparency: 1,
	Parent: markerParent,
	Ambient: Colors.white,
	LightColor: Colors.white,
	ZIndex: -1,
});

const looped = new Map<defined, (tick: number) => void>();
task.spawn(() => {
	let tick = 0;
	while (true as boolean) {
		task.wait(0.5);

		tick++;
		for (const [_, value] of looped) {
			value(tick);
		}
	}
});

export namespace MarkerWireVisualizer {
	export function getTypeColor(wireType: keyof BlockLogicTypes.Primitives) {
		const color = BlockWireManager.types[wireType]?.color;
		if (!color) {
			LogControl.instance.addLine(
				"Some of your wires have incompatible types, fix before proceeding.",
				Colors.red,
			);
			return Colors.purple;
		}

		return color;
	}

	export class ColorLooper extends Component {
		readonly colors;
		readonly pause;

		constructor(private readonly setColor: (color: Color3) => void) {
			super();

			this.colors = new ObservableValue<readonly Color3[]>([Colors.white]);
			this.pause = new ObservableValue(false);

			this.onDestroy(() => looped.delete(this));
			this.event.subscribeObservable(
				this.colors,
				(colors) => {
					looped.delete(this);

					if (colors.size() === 1) {
						setColor(colors[0]);
					} else {
						const func = (index: number) => {
							if (this.pause.get()) return;
							setColor(colors[index % (colors.size() === 0 ? 1 : colors.size())]);
						};

						looped.set(this, func);
					}
				},
				true,
				true,
			);
		}

		/** Temporarily override marker color to the specified one, or cancel if nil */
		tempOverride(color: Color3 | undefined) {
			if (color) {
				this.pause.set(true);
				this.setColor(color);
			} else {
				this.pause.set(false);
			}
		}

		set(colors: readonly Color3[]) {
			this.colors.set(colors);
		}
		sub(colors: ReadonlyObservableValue<readonly Color3[]>) {
			this.event.subscribeObservable(colors, () => this.colors.set(colors.get()), true);
		}
	}

	export type MarkerDefinition = BillboardGui & {
		readonly TextButton: GuiButton & {
			readonly White: Frame;
			readonly Filled: Frame;
		};
	};
	export abstract class Marker extends InstanceComponent<MarkerDefinition> {
		static createInstance(
			origin: BasePart,
			offset: Vector3 | "center",
			scale: Vector3,
			prefab: MarkerDefinition,
		): MarkerDefinition {
			if (offset === "center") {
				offset = Vector3.zero;
			}

			offset = offset.mul(scale);
			const scaleNum = math.clamp(scale.findMin(), 0.4, 1);

			const markerInstance = prefab.Clone();
			markerInstance.StudsOffset = Vector3.zero;
			markerInstance.Size = new UDim2(
				markerInstance.Size.X.Scale * scaleNum,
				markerInstance.Size.X.Offset * scaleNum,
				markerInstance.Size.Y.Scale * scaleNum,
				markerInstance.Size.Y.Offset * scaleNum,
			);
			markerInstance.MaxDistance = 200;
			markerInstance.Adornee = origin;
			markerInstance.StudsOffsetWorldSpace = origin.CFrame.PointToObjectSpace(
				origin.CFrame.PointToWorldSpace(offset),
			);

			markerInstance.Parent = markerParent;
			return markerInstance;
		}

		readonly position: Vector3;
		readonly colors;

		constructor(instance: MarkerDefinition) {
			super(instance);

			this.$onInjectAuto((playerDataStorage: PlayerDataStorage) => {
				const trp = this.event.addObservable(
					playerDataStorage.config.fReadonlyCreateBased((c) => 1 - c.visuals.wires.markerTransparency),
				);

				this.parent(new InstanceComponent(instance.TextButton)) //
					.overlayValue("BackgroundTransparency", trp);
				this.parent(new InstanceComponent(instance.TextButton.White)) //
					.overlayValue("BackgroundTransparency", trp);
				this.parent(new InstanceComponent(instance.TextButton.Filled)) //
					.overlayValue("BackgroundTransparency", trp);

				const origSize = this.instance.Size;
				this.overlayValue(
					"Size",
					this.event.addObservable(
						playerDataStorage.config.fReadonlyCreateBased(
							(c) =>
								new UDim2(
									origSize.X.Scale * c.visuals.wires.markerSizeMultiplier,
									origSize.X.Offset * c.visuals.wires.markerSizeMultiplier,
									origSize.Y.Scale * c.visuals.wires.markerSizeMultiplier,
									origSize.Y.Offset * c.visuals.wires.markerSizeMultiplier,
								),
						),
					),
				);
			});

			this.colors = this.parent(
				new ColorLooper((color) => {
					this.instance.TextButton.BackgroundColor3 = color;
					this.instance.TextButton.Filled.BackgroundColor3 = color;
				}),
			);
			this.colors.set([Colors.purple]);

			this.position = (instance.Adornee as PVInstance)
				.GetPivot()
				.PointToWorldSpace(instance.StudsOffsetWorldSpace);
			this.unhighlight();

			const adornee = instance.Adornee;
			this.onEnable(() => (instance.Adornee = adornee));
			this.onDisable(() => (instance.Adornee = undefined));
		}

		highlight() {
			this.colors.tempOverride(Colors.red);
		}
		unhighlight() {
			this.colors.tempOverride(undefined);
		}
	}

	export type WireDefinition = Part;
	export class Wire extends InstanceComponent<WireDefinition> {
		static create(thickness: number, from?: Vector3, to?: Vector3): Wire {
			return new Wire(this.createInstance(thickness), from, to);
		}
		private static createInstance(thickness: number): WireDefinition {
			return Element.create("Part", {
				Anchored: true,
				CanCollide: false,
				CanQuery: false,
				CanTouch: false,
				CastShadow: false,

				Material: Enum.Material.Neon,
				Shape: Enum.PartType.Cylinder,
				Size: new Vector3(1, thickness, thickness),

				Parent: wireParent,
			});
		}

		readonly colors;

		constructor(instance: WireDefinition, from?: Vector3, to?: Vector3) {
			super(instance);
			this.colors = this.parent(new ColorLooper((color) => (this.instance.Color = color)));

			this.$onInjectAuto((playerDataStorage: PlayerDataStorage) => {
				this.valuesComponent()
					.get("Transparency")
					.addTransitionBetweenBoolObservables(
						this.event,
						this.enabledState,
						this.event.addObservable(
							playerDataStorage.config.fReadonlyCreateBased((c) => 1 - c.visuals.wires.wireTransparency),
						),
						new ObservableValue(1),
						{ duration: 0 },
					);

				const origThickness = this.instance.Size.Y;
				this.overlayValue(
					"Size",
					this.event.addObservable(
						playerDataStorage.config.fReadonlyCreateBased(
							(c) =>
								new Vector3(
									this.instance.Size.X,
									origThickness * c.visuals.wires.wireThicknessMultiplier,
									origThickness * c.visuals.wires.wireThicknessMultiplier,
								),
						),
					),
				);
			});

			this.onDisable(() => (instance.Transparency = 1));

			if (from && to) {
				Wire.staticSetPosition(this.instance, from, to);
			}
		}

		static staticSetPosition(wire: WireDefinition, from: Vector3, to: Vector3) {
			const distance = to.sub(from).Magnitude;

			const distscale = (wire.Size.Y / 0.15) * 0.4;
			wire.Size = new Vector3(distance - distscale, wire.Size.Y, wire.Size.Z);
			wire.CFrame = new CFrame(from, to)
				.mul(new CFrame(0, 0, -distance / 2))
				.mul(CFrame.Angles(0, math.rad(90), 0));
		}
	}
}
