import { GamepadService, GuiService, Players, ReplicatedStorage, RunService } from "@rbxts/services";
import { MarkerWireVisualizer } from "client/gui/MarkerWireVisualizer";
import { ToolBase } from "client/tools/ToolBase";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { InputController } from "engine/client/InputController";
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Instances } from "engine/shared/fixes/Instances";
import { Objects } from "engine/shared/fixes/Objects";
import { BlockManager } from "shared/building/BlockManager";
import { Colors } from "shared/Colors";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { Tooltip } from "client/gui/static/TooltipsControl";
import type { ActionController } from "client/modes/build/ActionController";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ClientBuilding, ClientBuildingTypes } from "client/modes/build/ClientBuilding";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";
import type { SharedPlot } from "shared/building/SharedPlot";

const weldToData = (weld: WeldConstraint): ClientBuildingTypes.WeldArgs["datas"][number] => {
	const leftPart = weld.Part0;
	const rightPart = weld.Part1;
	if (!leftPart || !rightPart) throw "no";

	const thisBlock = BlockManager.tryGetBlockModelByPart(leftPart)!;
	const otherBlock = BlockManager.tryGetBlockModelByPart(rightPart)!;

	return {
		welded: weld.Enabled,
		thisUuid: BlockManager.manager.uuid.get(thisBlock),
		thisPart: Instances.relativePathOf(leftPart, thisBlock),
		otherUuid: BlockManager.manager.uuid.get(otherBlock),
		otherPart: Instances.relativePathOf(rightPart, otherBlock),
	};
};

const toggleMarkers = (building: ClientBuilding, left: Marker, right: Marker) => {
	if (left === right) {
		let allState: boolean | undefined = undefined;
		for (const weld of left.welds) {
			const weldState = weld.Enabled;
			if (allState === undefined) {
				allState = weldState;
				continue;
			}

			if (allState !== weldState) {
				allState = undefined;
				break;
			}
		}

		const enabled = !(allState === true);
		for (const weld of left.welds) {
			weld.Enabled = enabled;
		}

		building.weldOperation.execute({ plot: left.plot, datas: left.welds.map(weldToData) });
		return;
	}

	const common = left.welds.filter((w) => right.welds.includes(w));
	if (common.size() === 0) return;
	if (common.size() > 1) {
		throw "Found more than 1 weld between two parts";
	}

	const weld = common[0];
	weld.Enabled = !weld.Enabled;
	building.weldOperation.execute({ plot: left.plot, datas: [weldToData(weld)] });
};

class Marker extends MarkerWireVisualizer.Marker {
	static createInstance(origin: BasePart) {
		return MarkerWireVisualizer.Marker.createInstance(
			origin,
			"center",
			BlockManager.getBlockDataByPart(origin)?.scale ?? Vector3.one,
			ReplicatedStorage.Assets.Wires.WeldMarker,
		);
	}

	constructor(
		instance: MarkerWireVisualizer.MarkerDefinition,
		readonly welds: readonly WeldConstraint[],
		readonly plot: SharedPlot,
	) {
		super(instance);
	}
}

namespace Visual {
	export function hideAllWires(markers: readonly Marker[]) {
		for (const marker of markers) {
			for (const weld of marker.welds) {
				weld.Archivable = false;
			}
		}
	}
	export function showAllWires(markers: readonly Marker[]) {
		for (const marker of markers) {
			for (const weld of marker.welds) {
				weld.Archivable = true;
			}
		}
	}

	export function hideNonConnectableMarkers(from: Marker, markers: readonly Marker[]) {
		for (const marker of markers) {
			if (marker === from) continue;

			if (!marker.welds.any((w) => from.welds.includes(w))) {
				marker.disable();
			}

			for (const weld of marker.welds) {
				weld.Archivable = false;
			}
		}

		for (const weld of from.welds) {
			weld.Archivable = true;
		}
	}
	export function showNonConnectableMarkers(markers: readonly Marker[]) {
		for (const marker of markers) {
			marker.enable();
			for (const weld of marker.welds) {
				weld.Archivable = true;
			}
		}
	}
}

namespace Controllers {
	export interface IController extends Component {
		readonly selectedMarker: ReadonlyObservableValue<Marker | undefined>;

		stopDragging(): void;
	}
	@injectable
	export class Desktop extends Component implements IController {
		readonly selectedMarker = new ObservableValue<Marker | undefined>(undefined);
		private readonly currentMoverContainer;

		constructor(markers: readonly Marker[], @inject clientBuilding: ClientBuilding) {
			class WireMover extends Component {
				readonly marker;

				constructor(wire: MarkerWireVisualizer.Wire, marker: Marker) {
					super();
					this.marker = marker;
					this.parentDestroyOnly(wire);

					Visual.hideNonConnectableMarkers(marker, markers);
					this.onDestroy(() => Visual.showNonConnectableMarkers(markers));

					this.event.subscribe(RunService.Heartbeat, () => {
						const endPosition =
							hoverMarker !== undefined
								? hoverMarker.position
								: Players.LocalPlayer.GetMouse().Hit.Position;

						MarkerWireVisualizer.Wire.staticSetPosition(wire.instance, marker.position, endPosition);
					});
					this.event.subInput((ih) =>
						ih.onMouse1Up(() => {
							if (hoverMarker) {
								toggleMarkers(clientBuilding, this.marker, hoverMarker);
							}

							this.destroy();
						}, true),
					);
					this.event.subInput((ih) =>
						ih.onMouse2Down(() => {
							if (hoverMarker && hoverMarker !== marker) {
								toggleMarkers(clientBuilding, this.marker, hoverMarker);
							}
						}, true),
					);
				}
			}

			super();

			const currentMoverContainer = this.parent(new ComponentChild<WireMover>(true));
			this.currentMoverContainer = currentMoverContainer;
			currentMoverContainer.childSet.Connect((child) => this.selectedMarker.set(child?.marker));
			let hoverMarker: Marker | undefined;

			for (const marker of markers) {
				this.event.subscribe(marker.instance.TextButton.MouseButton1Down, () => {
					if (currentMoverContainer.get()) return;

					hoverMarker = marker;

					const wire = MarkerWireVisualizer.Wire.create(
						(marker.instance.Size.X.Scale / ReplicatedStorage.Assets.Wires.WireMarker.Size.X.Scale) * 0.15,
					);
					currentMoverContainer.set(new WireMover(wire, marker));
				});

				this.event.subscribe(marker.instance.TextButton.MouseEnter, () => {
					if (!currentMoverContainer.get()) return;
					hoverMarker = marker;
				});

				this.event.subscribe(marker.instance.TextButton.MouseLeave, () => {
					if (!currentMoverContainer.get()) return;

					if (hoverMarker !== marker) return;
					hoverMarker = undefined;
				});
			}
		}

		stopDragging() {
			this.currentMoverContainer.clear();
		}
	}
	@injectable
	export class Touch extends Component implements IController {
		readonly selectedMarker = new ObservableValue<Marker | undefined>(undefined);
		private readonly markers: readonly Marker[];

		constructor(markers: readonly Marker[], @inject clientBuilding: ClientBuilding) {
			super();
			this.markers = markers;

			this.onEnable(() => {
				for (const marker of markers) {
					marker.instance.TextButton.Active = true;
				}
			});
			this.onDisable(() => this.unset());

			for (const marker of markers) {
				this.event.subscribe(marker.instance.TextButton.Activated, () => {
					const selected = this.selectedMarker.get();
					if (!selected) {
						this.set(marker);
						return;
					}

					toggleMarkers(clientBuilding, selected!, marker);
					this.unset();
				});
			}
		}

		private set(marker: Marker) {
			this.selectedMarker.set(marker);
			marker.highlight();
			Visual.hideNonConnectableMarkers(marker, this.markers);
		}
		private unset() {
			if (this.selectedMarker.get()?.isDestroyed()) return;
			this.selectedMarker.get()?.unhighlight();
			this.selectedMarker.set(undefined);

			Visual.showNonConnectableMarkers(this.markers);
		}

		stopDragging() {
			this.unset();
		}
	}
	@injectable
	export class Gamepad extends Desktop implements IController {
		constructor(markers: readonly Marker[], @inject clientBuilding: ClientBuilding) {
			super(markers, clientBuilding);

			this.event.onKeyDown("ButtonY", () => {
				if (GamepadService.GamepadCursorEnabled) {
					GamepadService.DisableGamepadCursor();
				} else {
					GamepadService.EnableGamepadCursor(undefined);
				}
			});

			this.onDisable(() => GamepadService.DisableGamepadCursor());
		}
	}
}

namespace Scene {
	export type SceneDefinition = GuiObject & {
		//
	};

	@injectable
	export class Scene extends Component {
		constructor(@inject tool: WeldTool, @inject mainScreen: MainScreenLayout) {
			super();

			const update = () => {
				cancelLayer.setVisibleAndEnabled(false);
				wireTooltip.instance.Visible = false;
				nameTooltip.instance.Visible = false;

				const inputType = InputController.inputType.get();
				if (inputType !== "Desktop") {
					wireTooltip.instance.Visible = true;

					if (!tool.selectedMarker.get()) {
						wireTooltip.instance.TextLabel.Text = "CLICK ON THE FIRST POINT";
						cancelLayer.setVisibleAndEnabled(false);
					} else {
						wireTooltip.instance.TextLabel.Text = "CLICK ON THE SECOND POINT OR ITSELF";
						if (InputController.inputType.get() !== "Gamepad") {
							cancelLayer.setVisibleAndEnabled(true);
						}
					}
				}

				if (InputController.inputType.get() === "Gamepad") {
					if (GamepadService.GamepadCursorEnabled) {
						if (GuiService.SelectedObject) {
							nameTooltip.instance.Visible = true;
							nameTooltip.instance.TextLabel.Text = GuiService.SelectedObject.Name;
							nameTooltip.instance.TextLabel.TextColor3 = GuiService.SelectedObject.BackgroundColor3;
						} else {
							nameTooltip.instance.Visible = false;
						}
					}
				}
			};

			const wireTooltipLayer = this.parentGui(mainScreen.bottom.push());
			const nameTooltip = wireTooltipLayer.parent(
				new Control(
					Interface.getInterface<{
						Tools: { Shared: { Bottom: { WireToolTip: GuiObject & { TextLabel: TextLabel } } } };
					}>().Tools.Shared.Bottom.WireToolTip.Clone(),
				),
			);
			const wireTooltip = wireTooltipLayer.parent(
				new Control(
					Interface.getInterface<{
						Tools: { Shared: { Bottom: { WireToolTip: GuiObject & { TextLabel: TextLabel } } } };
					}>().Tools.Shared.Bottom.WireToolTip.Clone(),
				),
			);

			const cancelLayer = this.parentGui(mainScreen.bottom.push());
			cancelLayer
				.addButton("Cancel") //
				.addButtonAction(() => {
					tool.stopDragging();
					update();
				});

			tool.selectedMarker.subscribe(update, true);
			this.event.subscribe(GuiService.GetPropertyChangedSignal("SelectedObject"), update);
			this.event.onPrepare(update);
		}
	}
}

@injectable
export class WeldTool extends ToolBase {
	readonly selectedMarker = new ObservableValue<Marker | undefined>(undefined);
	private readonly instances = this.parent(new ComponentChildren<Marker | MarkerWireVisualizer.Wire>(true));
	private readonly markers = this.parent(new ComponentChildren<Marker>(true));
	private readonly controllerContainer = this.parent(new ComponentChild<Controllers.IController>(true));

	constructor(
		@inject mode: BuildingMode,
		@inject actionController: ActionController,
		@inject private readonly blockList: BlockList,
		@inject di: DIContainer,
	) {
		super(mode);

		this.parent(di.resolveForeignClass(Scene.Scene));
		this.onEnable(() => this.createEverythingOnPlot(this.targetPlot.get()));

		const controllers = {
			Desktop: Controllers.Desktop,
			Touch: Controllers.Touch,
			Gamepad: Controllers.Gamepad,
		} as const satisfies Record<
			InputType,
			new (markers: readonly Marker[], ...args: any[]) => Controllers.IController
		>;
		const setController = () => {
			const inputType = InputController.inputType.get();
			const controller = this.controllerContainer.set(
				di.resolveForeignClass<Controllers.IController, [readonly Marker[], ...never[]]>(
					controllers[inputType],
					[this.markers.getAll()],
				),
			);

			controller.selectedMarker.subscribe((m) => this.selectedMarker.set(m), true);
		};
		this.event.onPrepare(setController);

		this.event.subInput((ih) => {
			ih.onKeyDown("F", () => Visual.hideAllWires(this.markers.getAll()));
			ih.onKeyUp("F", () => Visual.showAllWires(this.markers.getAll()));
		});
	}

	private createEverythingOnPlot(plot: SharedPlot) {
		const welds = plot.getBlocks().flatmap((c) =>
			c
				.GetDescendants()
				.filter((c) => c.IsA("WeldConstraint"))
				.filter((c) => c.Name === "AutoWeld")
				.filter((c) => c.Part0?.Parent !== undefined && c.Part1?.Parent !== undefined),
		);
		let partWelds = new Map<BasePart, WeldConstraint[]>();
		for (const weld of welds) {
			partWelds.getOrSet(weld.Part0!, () => []).push(weld);
			partWelds.getOrSet(weld.Part1!, () => []).push(weld);
		}
		partWelds = partWelds.mapToMap((k, v) => $tuple(k, v.distinct()));

		const parts = welds.flatmapToSet((c) => [c.Part0!, c.Part1!]);
		const partMarkers = new Map<BasePart, Marker>();

		for (const part of parts) {
			const instance = Marker.createInstance(part);
			const marker = this.markers.add(new Marker(instance, partWelds.get(part) ?? Objects.empty, plot));

			partMarkers.set(part, marker);
		}

		for (const weld of welds) {
			if (!weld.Part0 || !weld.Part1) continue;

			const marker1 = partMarkers.get(weld.Part0);
			if (!marker1) continue;

			const marker2 = partMarkers.get(weld.Part1);
			if (!marker2) continue;

			const wire = this.instances.add(
				MarkerWireVisualizer.Wire.create(
					math.min(
						marker1.instance.Size.X.Scale / ReplicatedStorage.Assets.Wires.WireMarker.Size.X.Scale,
						marker2.instance.Size.X.Scale / ReplicatedStorage.Assets.Wires.WireMarker.Size.X.Scale,
					) * 0.15,
					weld.Part0.Position,
					weld.Part1.Position,
				),
			);
			wire.event
				.observableFromInstanceParam(weld, "Enabled")
				.subscribe((enabled) => wire.colors.set([enabled ? Colors.white : Colors.red]), true);
			wire.event
				.observableFromInstanceParam(weld, "Archivable") //
				.subscribe((enabled) => (wire.instance.Transparency = enabled ? 0.4 : 1), true);
		}
	}

	stopDragging() {
		this.controllerContainer.get()?.stopDragging();
	}

	getDisplayName(): string {
		return "Welding";
	}

	getImageID(): string {
		return "http://www.roblox.com/asset/?id=84532983912875";
	}

	protected getTooltips(): readonly Tooltip[] {
		return [
			{ keys: [["F"]], text: "Hide wires" },
			{ keys: [["ButtonY"]], text: "Marker selection mode" },
			{ keys: [["ButtonA"]], text: "Click on marker" },
			{ keys: [["ButtonX"]], text: "Cancel selection" },
			{ keys: [["ButtonB"]], text: "Unequip" },
		];
	}
}
