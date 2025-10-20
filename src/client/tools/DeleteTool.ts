import { SoundController } from "client/controller/SoundController";
import { ConfirmPopup } from "client/gui/popup/ConfirmPopup";
import { LogControl } from "client/gui/static/LogControl";
import { MultiBlockSelector } from "client/tools/highlighters/MultiBlockSelector";
import { SelectedBlocksHighlighter } from "client/tools/highlighters/SelectedBlocksHighlighter";
import { ToolBase } from "client/tools/ToolBase";
import { Action } from "engine/client/Action";
import { InputController } from "engine/client/InputController";
import { Keybinds } from "engine/client/Keybinds";
import { Component } from "engine/shared/component/Component";
import { ObservableCollectionSet } from "engine/shared/event/ObservableCollection";
import { Colors } from "shared/Colors";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { PopupController } from "client/gui/PopupController";
import type { Tooltip } from "client/gui/static/TooltipsControl";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ClientBuilding } from "client/modes/build/ClientBuilding";

namespace Scene {
	@injectable
	export class DeleteToolScene extends Component {
		constructor(@inject tool: DeleteTool, @inject mainScreen: MainScreenLayout) {
			super();

			const line = this.parentGui(mainScreen.bottom.push());
			line.addButton("clear plot", "12539349041", "buttonNegative", { width: 150 }) //
				.subscribeToAction(tool.clearPlotAction);

			this.parent(mainScreen.right.pushImage("rbxassetid://12539349041")) //
				.with((c) => (c.instance.BackgroundColor3 = Color3.fromRGB(52, 17, 17)))
				.addButtonAction(() => tool.deleteHighlightedBlocks())
				.subscribeVisibilityFrom({
					main: this.enabledState,
					hasSelectedBlocks: this.event.addObservable(
						tool.highlightedBlocks.fReadonlyCreateBased((c) => !c.isEmpty()),
					),
					isTouch: this.event.addObservable(
						InputController.inputType.fReadonlyCreateBased((c) => c === "Touch"),
					),
				});
		}
	}
}

const clearPlotKey = Keybinds.registerDefinition("delete_clearPlot", ["Delete Tool", "Clear Plot"], [["ButtonY"]]);

@injectable
export class DeleteTool extends ToolBase {
	readonly highlightedBlocks = new ObservableCollectionSet<BlockModel>();
	readonly clearPlotAction: Action;

	constructor(
		@inject mode: BuildingMode,
		@inject keybinds: Keybinds,
		@inject private readonly clientBuilding: ClientBuilding,
		@inject popupController: PopupController,
		@inject di: DIContainer,
	) {
		super(mode);

		this.clearPlotAction = this.parent(
			new Action(() => {
				popupController.showPopup(
					new ConfirmPopup(
						"Are you sure you want to delete all blocks?",
						"It will be impossible to undo this action",
						() => this.deleteBlocks("all"),
					),
				);
			}),
		);
		this.clearPlotAction.initKeybind(keybinds.fromDefinition(clearPlotKey));
		this.event.subscribeObservable(
			mode.targetPlot,
			(plot) => {
				plot.instance
					.WaitForChild("Blocks")
					.ChildAdded.Connect(() => this.clearPlotAction.canExecute.and("plotIsEmpty", true));
				plot.instance
					.WaitForChild("Blocks")
					.ChildRemoved.Connect(() =>
						this.clearPlotAction.canExecute.and(
							"plotIsEmpty",
							plot.instance.WaitForChild("Blocks").GetChildren().size() !== 0,
						),
					);
			},
			true,
		);

		this.parent(di.resolveForeignClass(Scene.DeleteToolScene));
		this.parent(di.resolveForeignClass(SelectedBlocksHighlighter, [this.highlightedBlocks]));

		const fireSelected = async (blocks: readonly BlockModel[]) => {
			if (!blocks || blocks.size() === 0) return;

			if (InputController.inputType.get() === "Touch") {
				this.highlightedBlocks.setRange(blocks);
				return;
			}

			await this.deleteBlocks(blocks);
		};
		const stuff = this.parent(new MultiBlockSelector(mode.targetPlot, undefined, keybinds));
		stuff.submit.Connect(fireSelected);

		this.event.onPrepareGamepad((eh, ih) => {
			ih.onKeyDown("ButtonY", () => this.clearPlotAction.execute());
		});
	}

	supportsMirror() {
		return false;
	}

	deleteHighlightedBlocks() {
		const blocks = this.highlightedBlocks.getArr();
		this.highlightedBlocks.clear();

		return this.deleteBlocks(blocks);
	}
	async deleteBlocks(blocks: readonly BlockModel[] | "all") {
		if (blocks !== "all" && blocks.size() === 0) {
			return;
		}
		if (blocks !== "all" && blocks.any((b) => !this.targetPlot.get().hasBlock(b))) {
			return;
		}

		const response = await this.clientBuilding.deleteOperation.execute({ plot: this.targetPlot.get(), blocks });
		if (response.success) {
			task.wait();

			SoundController.getUISounds().Build.BlockDelete.PlaybackSpeed = SoundController.randomSoundSpeed();
			SoundController.getUISounds().Build.BlockDelete.Play();
		} else {
			LogControl.instance.addLine(response.message, Colors.red);
			SoundController.getUISounds().Build.BlockPlaceError.Play();
		}
	}
	getDisplayName(): string {
		return "Deleting";
	}

	getImageID(): string {
		return "rbxassetid://12539349041";
	}

	protected getTooltips(): readonly Tooltip[] {
		return [
			{ keys: [["ButtonX"]], text: "Delete" },
			{ keys: [["ButtonB"]], text: "Unequip" },
		];
	}
}
