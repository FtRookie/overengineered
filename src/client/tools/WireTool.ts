import { GamepadService, GuiService, Players, ReplicatedStorage, RunService } from "@rbxts/services";
import { MarkerWireVisualizer } from "client/gui/MarkerWireVisualizer";
import { LogControl } from "client/gui/static/LogControl";
import { ToolBase } from "client/tools/ToolBase";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { InputController } from "engine/client/InputController";
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { BlockWireManager } from "shared/blockLogic/BlockWireManager";
import { BlockManager } from "shared/building/BlockManager";
import { Colors } from "shared/Colors";
import { ReplicatedAssets } from "shared/ReplicatedAssets";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { Tooltip } from "client/gui/static/TooltipsControl";
import type { ActionController } from "client/modes/build/ActionController";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ClientBuilding } from "client/modes/build/ClientBuilding";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";
import type { SharedPlot } from "shared/building/SharedPlot";

namespace Markers {
	export abstract class Marker extends MarkerWireVisualizer.Marker {
		private static getPartMarkerPositions(originalOrigin: BasePart): Vector3[] {
			const sizeX = originalOrigin.Size.X / 2;
			const sizeY = originalOrigin.Size.Y / 2;
			const sizeZ = originalOrigin.Size.Z / 2;
			const offset = 0.25;

			return [
				new Vector3(-sizeX + offset, 0, 0),
				new Vector3(sizeX - offset, 0, 0),
				new Vector3(0, 0, -sizeZ + offset),
				new Vector3(0, 0, sizeZ - offset),
				new Vector3(0, -sizeY + offset, 0),
				new Vector3(0, sizeY - offset, 0),
				new Vector3(0, 0, 0),
			];
		}
		static createInstance2(
			origin: BasePart,
			offset: Vector3 | number | "center",
			scale: Vector3,
			originalOrigin: BasePart,
		): MarkerWireVisualizer.MarkerDefinition {
			if (typeIs(offset, "number")) {
				offset = this.getPartMarkerPositions(originalOrigin)[offset];
			}

			return this.createInstance(origin, offset, scale, ReplicatedStorage.Assets.Wires.WireMarker);
		}

		readonly data;
		readonly availableTypes;
		sameGroupMarkers?: readonly Marker[];
		protected readonly children;

		constructor(
			readonly block: BlockModel,
			instance: MarkerWireVisualizer.MarkerDefinition,
			marker: BlockWireManager.Markers.Marker,
			readonly plot: SharedPlot,
		) {
			super(instance);

			this.children = this.parent(new ComponentChildren().withParentInstance(instance));
			this.data = marker.data;
			this.availableTypes = marker.availableTypes;

			this.initTooltips();
			this.colors.sub(
				this.event.addObservable(
					this.availableTypes.fReadonlyCreateBased((c) => c.map(MarkerWireVisualizer.getTypeColor)),
				),
			);
		}

		private initTooltips() {
			const tooltipParent = this.parent(
				new ComponentChild<Control<GuiObject & { WireInfoLabel: TextLabel; TypeTextLabel: TextLabel }>>(true),
			);
			const createTooltip = () => {
				const wireInfoSource = ReplicatedAssets.get<{
					Wires: { WireInfo: GuiObject & { WireInfoLabel: TextLabel; TypeTextLabel: TextLabel } };
				}>().Wires.WireInfo;
				const control = new Control(wireInfoSource.Clone());

				control.instance.WireInfoLabel.Text = this.data.name;
				control.instance.TypeTextLabel.Text = this.availableTypes.get().join("/");

				control.instance.Parent = this.instance;
				control.instance.AnchorPoint = new Vector2(0.5, 0.98); // can't set Y to 1 because then it doesn't render
				control.instance.Position = new UDim2(0.5, 0, 0, 0);
				control.instance.Size = new UDim2(2, 0, 1, 0);

				tooltipParent.set(control);
			};
			const removeTooltip = () => tooltipParent.clear();

			this.event.onPrepare((inputType, eh) => {
				if (inputType === "Desktop") {
					eh.subscribe(this.instance.TextButton.MouseEnter, createTooltip);
					eh.subscribe(this.instance.TextButton.MouseLeave, removeTooltip);
				} else if (inputType === "Touch") {
					createTooltip();
				} else if (inputType === "Gamepad") {
					eh.subscribe(this.instance.TextButton.MouseEnter, createTooltip);
					eh.subscribe(this.instance.TextButton.MouseLeave, removeTooltip);
				}

				if (inputType === "Gamepad") {
					this.instance.Size = new UDim2(
						this.instance.Size.X.Scale * 1.5,
						this.instance.Size.X.Offset * 1.5,
						this.instance.Size.Y.Scale * 1.5,
						this.instance.Size.Y.Offset * 1.5,
					);
				}
			});
		}
	}
	export class Input extends Marker {
		private connected = false;

		constructor(
			blockInstance: BlockModel,
			gui: MarkerWireVisualizer.MarkerDefinition,
			readonly marker: BlockWireManager.Markers.Input,
			plot: SharedPlot,
			componentMap: ReadonlyMap<BlockWireManager.Markers.Marker, Marker>,
		) {
			super(blockInstance, gui, marker, plot);

			this.instance.TextButton.White.Visible = true;

			this.event.subscribeObservable(
				marker.connected,
				(connected) => {
					this.updateConnectedVisual(connected !== undefined);
					this.children.clear();

					if (connected) {
						const from = componentMap.get(connected) as Output;
						const wire = this.children.add(
							new MarkerWireVisualizer.Wire(
								MarkerWireVisualizer.Wire.createInstance(
									(gui.Size.X.Scale / ReplicatedStorage.Assets.Wires.WireMarker.Size.X.Scale) * 0.15,
								),
								from.position,
								this.position,
							),
						);
						wire.colors.sub(
							this.event.addObservable(
								from.availableTypes.fReadonlyCreateBased((c) =>
									c.map(MarkerWireVisualizer.getTypeColor),
								),
							),
						);
					}
				},
				true,
			);
		}

		private updateConnectedVisual(connected: boolean) {
			this.connected = connected;
			this.instance.TextButton.Filled.Visible = connected;
		}

		isConnected() {
			return this.connected;
		}
	}
	export class Output extends Marker {
		constructor(
			blockInstance: BlockModel,
			gui: MarkerWireVisualizer.MarkerDefinition,
			readonly marker: BlockWireManager.Markers.Output,
			plot: SharedPlot,
		) {
			super(blockInstance, gui, marker, plot);

			this.instance.TextButton.White.Visible = false;
			this.instance.TextButton.Filled.Visible = false;
		}

		hideWires() {
			for (const child of this.children.getAll()) {
				child.disable();
			}
		}
		enable() {
			// show hidden wires
			if (this.isEnabled()) {
				for (const child of this.children.getAll()) {
					child.enable();
				}
			}

			super.enable();
		}
	}
}

namespace Scene {
	export type WireToolSceneDefinition = GuiObject & {
		readonly Bottom: {
			readonly CancelButton: GuiButton;
		};
		readonly NameLabel: TextLabel;
		readonly TextLabel: TextLabel;
	};

	@injectable
	export class WireToolScene extends Component {
		constructor(@inject tool: WireTool, @inject mainScreen: MainScreenLayout) {
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
						wireTooltip.instance.TextLabel.Text = "CLICK ON THE SECOND POINT";
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

namespace Visual {
	const hidden: Record<string, Set<Markers.Marker> | undefined> = {};

	function hide(tipe: string, marker: Markers.Marker) {
		(hidden[tipe] ??= new Set()).add(marker);
	}
	function show(tipe: string, markers: readonly Markers.Marker[]) {
		for (const marker of markers) {
			hidden[tipe]?.delete(marker);

			const h = asMap(hidden).any((k, v) => v.has(marker));
			if (h) continue;

			marker.enable();
		}
	}

	export function hideNonConnectableMarkers(from: Markers.Output, markers: readonly Markers.Marker[]) {
		for (const marker of markers) {
			if (marker === from) {
				if (marker instanceof Markers.Output) {
					marker.hideWires();
					hide("connectable", marker);
				}

				continue;
			}

			if (
				marker instanceof Markers.Output ||
				(marker instanceof Markers.Input && !BlockWireManager.canConnect(from.marker, marker.marker))
			) {
				marker.disable();
				hide("connectable", marker);
			}
		}
	}
	export function showNonConnectableMarkers(markers: readonly Markers.Marker[]) {
		show("connectable", markers);
	}

	export function hideConnectedMarkers(markers: readonly Markers.Marker[]) {
		for (const marker of markers) {
			if (marker instanceof Markers.Input && marker.isConnected()) {
				marker.disable();
				hide("connected", marker);
			}
		}
	}
	export function showConnectedMarkers(markers: readonly Markers.Marker[]) {
		show("connected", markers);
	}
}

namespace Controllers {
	const connectMarkers = (clientBuilding: ClientBuilding, from: Markers.Output, to: Markers.Input) => {
		if (from.plot !== to.plot) {
			throw "Interplot connections are not supported";
		}

		from.marker.connect(to.marker);
		task.spawn(async () => {
			const result = clientBuilding.logicConnectOperation.execute({
				plot: from.plot,
				inputBlock: to.block,
				inputConnection: to.data.id,
				outputBlock: from.block,
				outputConnection: from.data.id,
			});

			if (!result.success) {
				LogControl.instance.addLine(result.message, Colors.red);
			}
		});
	};
	const disconnectMarker = (clientBuilding: ClientBuilding, marker: Markers.Input) => {
		marker.marker.disconnect();

		task.spawn(async () => {
			const result = clientBuilding.logicDisconnectOperation.execute({
				plot: marker.plot,
				inputBlock: marker.block,
				inputConnection: marker.data.id,
			});

			if (!result.success) {
				LogControl.instance.addLine(result.message, Colors.red);
			}
		});
	};

	export interface IController extends Component {
		readonly selectedMarker: ReadonlyObservableValue<Markers.Output | undefined>;

		stopDragging(): void;
	}
	@injectable
	export class Desktop extends Component implements IController {
		readonly selectedMarker = new ObservableValue<Markers.Output | undefined>(undefined);
		private readonly currentMoverContainer;

		constructor(markers: readonly Markers.Marker[], @inject clientBuilding: ClientBuilding) {
			class WireMover extends InstanceComponent<MarkerWireVisualizer.WireDefinition> {
				readonly marker;

				constructor(instance: MarkerWireVisualizer.WireDefinition, marker: Markers.Output) {
					super(instance);
					this.marker = marker;

					Visual.hideNonConnectableMarkers(marker, markers);
					this.onDestroy(() => Visual.showNonConnectableMarkers(markers));

					this.event.subscribe(RunService.Heartbeat, () => {
						const endPosition =
							hoverMarker !== undefined
								? hoverMarker.position
								: Players.LocalPlayer.GetMouse().Hit.Position;

						MarkerWireVisualizer.Wire.staticSetPosition(instance, marker.position, endPosition);
					});
					this.event.subInput((ih) =>
						ih.onMouse1Up(() => {
							if (hoverMarker) {
								connectMarkers(clientBuilding, this.marker, hoverMarker);
							}

							this.destroy();
						}, true),
					);
					this.event.subInput((ih) =>
						ih.onMouse2Down(() => {
							if (hoverMarker) {
								connectMarkers(clientBuilding, this.marker, hoverMarker);
							}
						}, true),
					);
				}
			}

			super();

			const currentMoverContainer = this.parent(new ComponentChild<WireMover>(true));
			this.currentMoverContainer = currentMoverContainer;
			currentMoverContainer.childSet.Connect((child) => this.selectedMarker.set(child?.marker));
			let hoverMarker: Markers.Input | undefined;

			for (const marker of markers) {
				if (marker instanceof Markers.Input) {
					this.event.subscribe(marker.instance.TextButton.MouseButton1Click, () => {
						disconnectMarker(clientBuilding, marker);
					});

					this.event.subscribe(marker.instance.TextButton.MouseEnter, () => {
						const currentMove = currentMoverContainer.get();
						if (!currentMove) return;

						hoverMarker = marker;
					});
					this.event.subscribe(marker.instance.TextButton.MouseLeave, () => {
						if (hoverMarker !== marker) return;
						hoverMarker = undefined;
					});
				} else if (marker instanceof Markers.Output) {
					this.event.subscribe(marker.instance.TextButton.MouseButton1Down, () => {
						if (currentMoverContainer.get()) return;

						const wire = MarkerWireVisualizer.Wire.createInstance(
							(marker.instance.Size.X.Scale / ReplicatedStorage.Assets.Wires.WireMarker.Size.X.Scale) *
								0.15,
						);
						currentMoverContainer.set(new WireMover(wire, marker));
					});
				}
			}
		}

		stopDragging() {
			this.currentMoverContainer.clear();
		}
	}
	@injectable
	export class Touch extends Component implements IController {
		readonly selectedMarker = new ObservableValue<Markers.Output | undefined>(undefined);
		private readonly markers: readonly Markers.Marker[];

		constructor(markers: readonly Markers.Marker[], @inject clientBuilding: ClientBuilding) {
			super();
			this.markers = markers;

			this.onEnable(() => {
				for (const marker of markers) {
					marker.instance.TextButton.Active = true;
				}
			});
			this.onDisable(() => this.unset());

			for (const marker of markers) {
				if (marker instanceof Markers.Input) {
					this.event.subscribe(marker.instance.TextButton.Activated, () => {
						const selected = this.selectedMarker.get();
						if (!selected) {
							disconnectMarker(clientBuilding, marker);
							return;
						}

						connectMarkers(clientBuilding, selected!, marker);
						this.unset();
					});
				} else if (marker instanceof Markers.Output) {
					this.event.subscribe(marker.instance.TextButton.Activated, () => {
						if (this.selectedMarker.get()) this.unset();
						else this.set(marker);
					});
				}
			}
		}

		private set(marker: Markers.Output) {
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
		constructor(markers: readonly Markers.Marker[], @inject clientBuilding: ClientBuilding) {
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

/** A tool for wiring */
@injectable
export class WireTool extends ToolBase {
	readonly selectedMarker = new ObservableValue<Markers.Output | undefined>(undefined);
	private readonly markers = this.parent(new ComponentChildren<Markers.Marker>(true));
	private readonly controllerContainer = this.parent(new ComponentChild<Controllers.IController>(true));

	constructor(
		@inject mode: BuildingMode,
		@inject actionController: ActionController,
		@inject private readonly blockList: BlockList,
		@inject di: DIContainer,
	) {
		super(mode);

		this.parent(di.resolveForeignClass(Scene.WireToolScene));

		this.event.onPrepare(() => this.createEverything());
		this.onDisable(() => this.markers.clear());

		this.event.subscribe(actionController.onUndo, () => {
			this.disable();
			this.enable();
		});
		this.event.subscribe(actionController.onRedo, () => {
			this.disable();
			this.enable();
		});

		const controllers = {
			Desktop: Controllers.Desktop,
			Touch: Controllers.Touch,
			Gamepad: Controllers.Gamepad,
		} as const satisfies Record<
			InputType,
			new (markers: readonly Markers.Marker[], ...args: any[]) => Controllers.IController
		>;

		const setController = () => {
			const inputType = InputController.inputType.get();
			const controller = this.controllerContainer.set(
				di.resolveForeignClass<Controllers.IController, [readonly Markers.Marker[], ...never[]]>(
					controllers[inputType],
					[this.markers.getAll()],
				),
			);
			controller.selectedMarker.subscribe((m) => this.selectedMarker.set(m), true);
		};
		this.event.onPrepare(setController);
		this.event.subInput((ih) => {
			ih.onKeyDown("F", () => Visual.hideConnectedMarkers(this.markers.getAll()));
			ih.onKeyUp("F", () => Visual.showConnectedMarkers(this.markers.getAll()));
		});
	}

	stopDragging() {
		this.controllerContainer.get()?.stopDragging();
	}

	private createEverything() {
		this.createEverythingOnPlot(this.targetPlot.get());
	}
	private createEverythingOnPlot(plot: SharedPlot) {
		this.markers.clear();

		const components = new Map<BlockWireManager.Markers.Marker, Markers.Marker>();
		for (const [uuid, markers] of BlockWireManager.fromPlot(plot, this.blockList)) {
			let [ii, oi, ai] = [0, 0, 0];
			const size = markers.size();

			for (const [, marker] of pairs(markers)) {
				const block = this.blockList.blocks[marker.data.blockId];
				if (!block) continue;

				const configDef = block.logic?.definition;
				if (!configDef) continue;

				if ((configDef.input[marker.data.id] ?? configDef.output[marker.data.id]).connectorHidden) {
					continue;
				}

				const blockid = marker.data.blockId;
				const positions = this.blockList.blocks[blockid]?.markerPositions;
				let markerpos = positions?.[marker.data.id];
				if (!markerpos) {
					if (marker instanceof BlockWireManager.Markers.Input) {
						if (configDef.inputOrder) {
							markerpos =
								positions?.[`@i${configDef.inputOrder.indexOf(marker.data.id)}` as BlockConnectionName];
						} else {
							markerpos = positions?.[`@i${ii}` as BlockConnectionName];
						}

						if (markerpos) ii++;
					} else {
						if (configDef.outputOrder) {
							markerpos =
								positions?.[
									`@o${configDef.outputOrder.indexOf(marker.data.id)}` as BlockConnectionName
								];
						} else {
							markerpos = positions?.[`@o${oi}` as BlockConnectionName];
						}

						if (markerpos) oi++;
					}
				}

				const blockInstance = plot.getBlock(uuid);
				if (!blockInstance.PrimaryPart) {
					LogControl.instance.addLine(`PrimaryPart of ${uuid} is nil, skipping marker creation`, Colors.red);
					continue;
				}

				const markerInstance = Markers.Marker.createInstance2(
					blockInstance.PrimaryPart,
					markerpos !== undefined ? markerpos : size === 1 ? "center" : ai++,
					BlockManager.manager.scale.get(blockInstance) ?? Vector3.one,
					this.blockList.blocks[BlockManager.manager.id.get(blockInstance)]!.model.PrimaryPart!,
				);

				const component =
					marker instanceof BlockWireManager.Markers.Input
						? new Markers.Input(blockInstance, markerInstance, marker, plot, components)
						: new Markers.Output(blockInstance, markerInstance, marker, plot);

				components.set(marker, component);
			}
		}

		for (const [, component] of components) {
			this.markers.add(component);
		}
	}

	getDisplayName(): string {
		return "Wiring";
	}

	getImageID(): string {
		return "http://www.roblox.com/asset/?id=15895880948";
	}

	protected getTooltips(): readonly Tooltip[] {
		return [
			{ keys: [["F"]], text: "Hide connected markers" },
			{ keys: [["ButtonY"]], text: "Marker selection mode" },
			{ keys: [["ButtonA"]], text: "Click on marker" },
			{ keys: [["ButtonX"]], text: "Cancel selection" },
			{ keys: [["ButtonB"]], text: "Unequip" },
		];
	}
}
