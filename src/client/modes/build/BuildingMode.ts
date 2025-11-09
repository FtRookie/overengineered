import { LoadingController } from "client/controller/LoadingController";
import { MirrorVisualizer } from "client/controller/MirrorVisualizer";
import { SwitchControl } from "client/gui/controls/SwitchControl";
import { SavePopup } from "client/gui/popup/SavePopup";
import { Scene } from "client/gui/Scene";
import { ActionController } from "client/modes/build/ActionController";
import { CenterOfMassController } from "client/modes/build/CenterOfMassController";
import { ClientBuilding } from "client/modes/build/ClientBuilding";
import { ClientBuildingValidationController } from "client/modes/build/ClientBuildingValidationController";
import { GridController } from "client/modes/build/GridController";
import { WeldVisualizerController } from "client/modes/build/WeldVisualizer";
import { PlayMode } from "client/modes/PlayMode";
import { requestMode } from "client/modes/PlayModeRequest";
import { RideMode } from "client/modes/ride/RideMode";
import { BuildTool } from "client/tools/BuildTool";
import { ConfigTool } from "client/tools/ConfigTool";
import { DeleteTool } from "client/tools/DeleteTool";
import { EditTool } from "client/tools/EditTool";
import { BlockSelect } from "client/tools/highlighters/BlockSelect";
import { PaintTool } from "client/tools/PaintTool";
import { WeldTool } from "client/tools/WeldTool";
import { WireTool } from "client/tools/WireTool";
import { Action } from "engine/client/Action";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { EventHandler } from "engine/shared/event/EventHandler";
import { NumberObservableValue } from "engine/shared/event/NumberObservableValue";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Instances } from "engine/shared/fixes/Instances";
import { Objects } from "engine/shared/fixes/Objects";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { SharedRagdoll } from "shared/SharedRagdoll";
import { spawnPositions } from "shared/SpawnPositions";
import type { SwitchControlDefinition } from "client/gui/controls/SwitchControl";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { PopupController } from "client/gui/PopupController";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { Theme } from "client/Theme";
import type { ToolBase } from "client/tools/ToolBase";
import type { ToolController } from "client/tools/ToolController";
import type { SharedPlot } from "shared/building/SharedPlot";
import type { SpawnPosition } from "shared/SpawnPositions";

declare global {
	type MirrorMode = {
		readonly x?: number;
		readonly y?: number;
		readonly z?: number;
	};
}

@injectable
export class BuildingModeScene extends Scene {
	constructor(
		@inject readonly mode: BuildingMode,
		@inject mainScreen: MainScreenLayout,
		@inject theme: Theme,
	) {
		super();

		this.parent(mainScreen.top.main.addButton("Save", { iconId: 15266766613 }))
			.themeButton(theme, "buttonNormal")
			.subscribeToAction(mode.openSavePopupAction)
			.subscribeVisibilityFrom({ main_enabled: this.enabledState });

		const runbtn = this.parent(
			mainScreen.top.main.addButton("Run", { text: "►", background: "accent", width: 200 }),
		)
			.themeButton(theme, "accent")
			.subscribeToAction(mode.runAction)
			.subscribeVisibilityFrom({ main_enabled: this.enabledState });

		{
			type gui = GuiObject & {
				readonly TextLabel: TextLabel;
				readonly Control: {
					readonly Switch: GuiObject & {
						readonly Control: SwitchControlDefinition;
					};
				};
			};
			const template = Instances.waitForChild<gui>(Interface.getInterface(), "Floating", "Switch");
			const gui = template.Clone();
			gui.Parent = template.Parent;
			gui.Visible = false;
			gui.TextLabel.Text = "CHOOSE SPAWN";

			const contol = this.parent(new Control(gui));
			const sw = contol.parent(new SwitchControl(gui.Control.Switch.Control, spawnPositions));
			sw.value.set(mode.spawnPosition.get());
			sw.value.subscribe((v) => mode.spawnPosition.set(v));

			this.onDisable(() => contol.hide());

			const runtp = this.parent(mainScreen.top.main.addButton("Teleport", { text: "?" }))
				.addButtonAction(() => contol.setVisibleAndEnabled(!contol.isInstanceVisible()))
				.subscribeVisibilityFrom({ main_enabled: this.enabledState });
		}

		{
			const eh = new EventHandler();
			this.onDisable(() => eh.unsubscribeAll());
			this.event.subscribe(runbtn.instance.MouseButton1Down, () => {
				let holding = true;

				eh.subscribe(runbtn.instance.MouseLeave, () => {
					holding = false;
					eh.unsubscribeAll();
				});
				eh.subscribe(runbtn.instance.MouseButton1Up, () => {
					holding = false;
					eh.unsubscribeAll();
				});

				task.delay(1, () => {
					if (!holding) return;
					mode.runAction.execute(false);
				});
			});
		}

		this.parent(mainScreen.top.main.addButton("TeleportToPlot", { iconId: 18886409314 }))
			.themeButton(theme, "buttonNormal")
			.subscribeToAction(mode.teleportToPlotAction)
			.subscribeVisibilityFrom({ main_enabled: this.enabledState });
	}
}

export type EditMode = "global" | "local";

@injectable
export class BuildingMode extends PlayMode {
	readonly openSavePopupAction = this.parent(new Action());
	readonly runAction = this.parent(
		new Action<[runLogic?: boolean]>((runLogic = true) => {
			RideMode.runWithoutLogicThisTime = !runLogic;
			requestMode("ride", this.spawnPosition.get());
		}),
	);
	readonly teleportToPlotAction = this.parent(new Action(() => this.teleportToPlot()));
	readonly spawnPosition = new ObservableValue<SpawnPosition>("plot");

	readonly mirrorMode = new ObservableValue<MirrorMode>({});
	readonly targetPlot;
	readonly mirrorVisualizer;
	readonly gridEnabled = new ObservableValue(true);
	readonly moveGrid = new NumberObservableValue<number>(1, 0, 256);
	readonly rotateGrid = new NumberObservableValue<number>(90, 0, 360);
	readonly editMode = new ObservableValue<EditMode>("global");
	readonly tools;

	private readonly actionController;
	readonly building;

	constructor(
		@inject plot: SharedPlot,
		@inject private readonly toolController: ToolController,
		@inject popupController: PopupController,
		@inject private readonly playerData: PlayerDataStorage,
		@inject private readonly blockList: BlockList,
		@inject di: DIContainer,
	) {
		super();

		this.openSavePopupAction.subscribe(() => popupController.showPopup(new SavePopup()));

		di = di.beginScope((di) => {
			di.registerSingletonValue(this);
			di.registerSingletonClass(ActionController);
			di.registerSingletonClass(CenterOfMassController);
			di.registerSingletonClass(WeldVisualizerController);
			di.registerSingletonClass(ClientBuilding);
			di.registerSingletonClass(ClientBuildingValidationController);
			di.registerSingletonClass(GridController).withArgs([this.moveGrid, this.rotateGrid, this.editMode]);

			di.registerSingletonClass(BuildTool);
			di.registerSingletonClass(EditTool);
			di.registerSingletonClass(DeleteTool);
			di.registerSingletonClass(ConfigTool);
			di.registerSingletonClass(PaintTool);
			di.registerSingletonClass(WireTool);
			di.registerSingletonClass(WeldTool);
		});

		this.building = di.resolve<ClientBuilding>();
		this.parent(di.resolve<ClientBuildingValidationController>());

		this.event.subscribeObservable(
			toolController.selectedTool,
			(tool) => this.mirrorVisualizer.setEnabled(tool?.supportsMirror() ?? false),
			true,
		);

		let mg = this.moveGrid.get();
		let rg = this.moveGrid.get();
		this.event.subInput((ih) => {
			ih.onKeyDown("LeftControl", () => {
				this.gridEnabled.set(false);

				mg = this.moveGrid.get();
				this.moveGrid.set(0);

				rg = this.rotateGrid.get();
				this.rotateGrid.set(0);
			});
			ih.onKeyUp("LeftControl", () => {
				this.gridEnabled.set(true);
				this.moveGrid.set(mg);
				this.rotateGrid.set(rg);
			});
		});

		this.runAction.subCanExecuteFrom({
			notLoading: LoadingController.isNotLoading,
		});
		this.openSavePopupAction.subCanExecuteFrom({
			notLoading: LoadingController.isNotLoading,
		});

		this.targetPlot = new ObservableValue<SharedPlot>(plot);
		this.targetPlot.subscribePrev((plot, prev) => {
			const index = BlockSelect.blockRaycastParams.FilterDescendantsInstances.indexOf(prev.instance);
			if (index !== -1) {
				BlockSelect.blockRaycastParams.FilterDescendantsInstances.remove(index);
			}

			BlockSelect.blockRaycastParams.AddToFilter(plot.instance);
		}, true);
		this.mirrorVisualizer = this.parent(new MirrorVisualizer(this.targetPlot, this.mirrorMode));

		this.parent(di.resolveForeignClass(BuildingModeScene));

		this.actionController = this.parent(di.resolve<ActionController>());
		const sl = playerData.slotLoading.Connect(() => this.actionController.clearHistory());
		this.onDestroy(() => sl.Disconnect());

		this.event.subscribe(this.actionController.onUndo, () => {
			for (const block of plot.getBlocks()) {
				BlockCreation.runImmediateFrom(block, blockList);
			}
		});
		this.event.subscribe(this.actionController.onRedo, () => {
			for (const block of plot.getBlocks()) {
				BlockCreation.runImmediateFrom(block, blockList);
			}
		});

		const sl2 = plot.instance.WaitForChild("Blocks").ChildAdded.Connect((child) => {
			if (!BlockManager.isBlockModel(child)) return;
			BlockCreation.runImmediateFrom(child, blockList);
		});
		// playerData.slotLoaded.Connect(() => {
		// 	for (const block of plot.getBlocks()) {
		// 		BlockCreation.runImmediateFrom(block, blockList);
		// 	}
		// });
		this.onDestroy(() => sl2.Disconnect());

		this.parent(di.resolve<GridController>());
		this.parent(di.resolve<CenterOfMassController>());
		this.parent(di.resolve<WeldVisualizerController>());

		this.event.subInput((ih) => {
			ih.onKeyDown("LeftControl", () => this.gridEnabled.set(false));
			ih.onKeyUp("LeftControl", () => this.gridEnabled.set(true));
		});

		const tools = [
			["buildTool", di.resolve<BuildTool>()],
			["editTool", di.resolve<EditTool>()],
			["deleteTool", di.resolve<DeleteTool>()],
			["configTool", di.resolve<ConfigTool>()],
			["paintTool", di.resolve<PaintTool>()],
			["wireTool", di.resolve<WireTool>()],
			["weldTool", di.resolve<WeldTool>()],
		] as const;
		for (const [, tool] of tools) {
			this.parentDestroyOnly(tool);
		}

		const toolsArr: readonly ToolBase[] = tools.map((t) => t[1]);

		this.tools = Objects.fromEntries(tools);

		this.onEnable(() => toolController.tools.add(...toolsArr));
		this.onDisable(() => toolController.tools.remove(...toolsArr));

		// this.onEnable(() => {
		// 	di.resolveForeignClass(TestTutorial2).enable();
		// });
	}

	getName(): PlayModes {
		return "build";
	}

	teleportToPlot() {
		const rootPart = LocalPlayer.rootPart.get();
		if (!rootPart) return;

		const humanoid = LocalPlayer.humanoid.get();
		if (!humanoid) return;

		if (SharedRagdoll.isPlayerRagdolling(humanoid)) {
			task.spawn(() => SharedRagdoll.event.send(false));
		}

		if (humanoid.Sit) {
			humanoid.Sit = false;
			task.wait();
		}

		const pos = this.targetPlot.get().getSpawnCFrame();
		rootPart.CFrame = pos;
		rootPart.AssemblyLinearVelocity = Vector3.zero;
		rootPart.AssemblyAngularVelocity = Vector3.zero;
	}

	switchTutorialMode(tutorialMode: boolean): void {
		this.actionController.undoAction.canExecute.and("build_tutorialMode", !tutorialMode);
		this.actionController.redoAction.canExecute.and("build_tutorialMode", !tutorialMode);

		if (tutorialMode) {
			this.toolController.enabledTools.disableAll();
		} else {
			this.toolController.enabledTools.enableAll();
		}

		this.openSavePopupAction.canExecute.and("this_tutorialMode", !tutorialMode);
		this.runAction.canExecute.and("this_tutorialMode", !tutorialMode);
	}

	onSwitchToNext(mode: PlayModes | undefined) {}
	onSwitchFromPrev(prev: PlayModes | undefined) {
		const plot = this.targetPlot.get();

		for (const block of plot.getBlocks()) {
			BlockCreation.runImmediateFrom(block, this.blockList);
		}

		if (prev === "ride") {
			RideMode.buildModeScheduler.execute(this.building, plot);
		}

		const tp = () => {
			if (!this.playerData.config.get().autoPlotTeleport) {
				return;
			}

			const rootPart = LocalPlayer.rootPart.get();
			if (!rootPart) return;

			const pos = plot.getSpawnPosition();
			if (rootPart.Position.sub(pos).Magnitude < plot.instance.BuildingArea.ExtentsSize.X) {
				return;
			}

			this.teleportToPlot();
		};

		if (!prev) {
			task.delay(0.1, () => this.teleportToPlot());
		} else {
			task.delay(0.1, tp);
		}
	}
}
