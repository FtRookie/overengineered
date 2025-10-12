import { Players } from "@rbxts/services";
import { MultiBlockConfigControl } from "client/gui/BlockConfigControls";
import { ToggleControl } from "client/gui/controls/ToggleControl";
import { GuiAnimator } from "client/gui/GuiAnimator";
import { ReportSubmitPopup } from "client/gui/popup/ReportSubmitPopup";
import { LogControl } from "client/gui/static/LogControl";
import { MultiBlockHighlightedSelector } from "client/tools/highlighters/MultiBlockHighlightedSelector";
import { SelectedBlocksHighlighter } from "client/tools/highlighters/SelectedBlocksHighlighter";
import { ToolBase } from "client/tools/ToolBase";
import { Action } from "engine/client/Action";
import { Control } from "engine/client/gui/Control";
import { InputController } from "engine/client/InputController";
import { Keybinds } from "engine/client/Keybinds";
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ObservableCollectionSet } from "engine/shared/event/ObservableCollection";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { JSON } from "engine/shared/fixes/Json";
import { Objects } from "engine/shared/fixes/Objects";
import { Localization } from "engine/shared/Localization";
import { BlockConfig } from "shared/blockLogic/BlockConfig";
import { BlockWireManager } from "shared/blockLogic/BlockWireManager";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { Colors } from "shared/Colors";
import { VectorUtils } from "shared/utils/VectorUtils";
import type { ToggleControlDefinition } from "client/gui/controls/ToggleControl";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { PopupController } from "client/gui/PopupController";
import type { ActionController } from "client/modes/build/ActionController";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ClientBuildingTypes } from "client/modes/build/ClientBuilding";
import type { ClientBuilding } from "client/modes/build/ClientBuilding";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type { BlockLogicBothDefinitions } from "shared/blockLogic/BlockLogic";

namespace Scene {
	export type ConfigToolSceneDefinition = GuiObject & {
		readonly ParamsSelection: Frame & {
			readonly Content: GuiObject & {
				readonly ScrollingFrame: GuiObject;
			};
			readonly Heading: GuiObject & {
				readonly NameLabel: TextLabel;
				readonly AmountLabel: TextLabel;
			};
		};
		readonly Bottom: {
			readonly DeselectButton: TextButton;
			readonly ResetButton: TextButton;
		};
	};

	const configKeybinds = {
		copy: Keybinds.registerDefinition("config_copy", ["Config tool", "Copy"], [["C"]]),
		paste: Keybinds.registerDefinition("config_paste", ["Config tool", "Paste"], [["V"]]),
		reset: Keybinds.registerDefinition("config_reset", ["Config tool", "Reset"], [["R"]]),
	} as const;

	@injectable
	export class ConfigToolScene extends Control<ConfigToolSceneDefinition> {
		readonly configContainer;
		private readonly configParent;
		private readonly copiedConfig = new ObservableValue<[BlockId, PlacedBlockConfig] | undefined>(undefined);

		constructor(
			gui: ConfigToolSceneDefinition,
			@inject keybinds: Keybinds,
			@inject private readonly tool: ConfigTool,
			@inject private readonly blockList: BlockList,
			@inject private readonly di: DIContainer,
			@inject private readonly popupController: PopupController,
			@inject private readonly mainScreen: MainScreenLayout,
			@inject private readonly clientBuilding: ClientBuilding,
			@inject actionController: ActionController,
		) {
			super(gui);

			type cc = GuiObject & {
				Content: GuiObject & {
					ScrollingFrame: ScrollingFrame;
					PreviewButton: GuiButton & { Toggle: ToggleControlDefinition };
				};
				Header: GuiObject & { Copy: GuiButton; Paste: GuiButton; Reset: GuiButton };
			};
			this.configContainer = this.parentGui(this.mainScreen.registerLeft<cc>("Config"));
			this.configParent = this.configContainer.parent(new ComponentChild(true));

			const copyAction = () => {
				const blockmodel = selected.get().first();
				if (!blockmodel) return;

				const id = BlockManager.manager.id.get(blockmodel)!;
				const block = this.blockList.blocks[id];
				if (!block) return undefined!;

				const defs = block.logic?.definition.input;
				if (!defs) return undefined!;

				this.copiedConfig.set([
					BlockManager.manager.id.get(blockmodel),
					BlockConfig.addDefaults(BlockManager.manager.config.get(blockmodel) as PlacedBlockConfig, defs),
				]);
			};

			const pasteAction = () => {
				const selected = this.tool.selected.get();
				if (selected.any((c) => BlockManager.manager.id.get(c) !== this.copiedConfig.get()![0]))
					$log(`Sending (${selected.size()}) block config values ${JSON.serialize(this.copiedConfig.get())}`);

				const response = this.clientBuilding.updateConfigOperation.execute({
					plot: this.tool.targetPlot.get(),
					configs: selected.map(
						(b) =>
							({
								block: b,
								cfg: this.copiedConfig.get()![1]!,
							}) satisfies ClientBuildingTypes.UpdateConfigArgs["configs"][number],
					),
				});
				if (!response.success) {
					LogControl.instance.addLine(response.message, Colors.red);
					this.updateConfigs([...selected]);
				}

				this.updateConfigs(this.tool.selected.getArr());
			};

			const resetAction = () => {
				const response = clientBuilding.resetConfigOperation.execute({
					plot: tool.targetPlot.get(),
					blocks: selected.getArr(),
				});

				if (!response.success) {
					LogControl.instance.addLine(response.message, Colors.red);
				}

				this.updateConfigs(selected.getArr());
			};

			const actions = {
				copy: this.parent(new Action(copyAction)),
				paste: this.parent(new Action(pasteAction)),
				reset: this.parent(new Action(resetAction)),
			} as const;

			for (const [k, action] of pairs(actions)) {
				if (k in configKeybinds) {
					action.initKeybind(keybinds.fromDefinition(configKeybinds[k as never]));
				}
			}

			const hasCopied = this.copiedConfig.fReadonlyCreateBased((c) => c !== undefined);
			actions.paste.subCanExecuteFrom({ hasCopied });

			this.parent(new Control(this.configContainer.instance.Header.Copy)) //
				.subscribeToAction(actions.copy);

			this.parent(new Control(this.configContainer.instance.Header.Paste)) //
				.subscribeToAction(actions.paste);

			this.parent(new Control(this.configContainer.instance.Header.Reset)) //
				.subscribeToAction(actions.reset);

			const selected = tool.selected;
			this.event.subscribeCollection(selected, () => {
				this.updateConfigs(selected.getArr());
			});
			this.event.subscribe(actionController.onRedo, () => {
				this.updateConfigs(selected.getArr());
			});
			this.event.subscribe(actionController.onUndo, () => {
				this.updateConfigs(selected.getArr());
			});

			this.gui.Bottom.DeselectButton.Activated.Connect(() => {
				tool.unselectAll();
			});

			let previewComponent: Component | undefined;
			this.onDisable(() => {
				previewComponent?.destroy();
				previewComponent = undefined;
			});
			const previewToggle = this.parent(
				new ToggleControl(this.configContainer.instance.Content.PreviewButton.Toggle),
			);
			previewToggle.value.subscribe((c) => {
				if (!c) {
					previewComponent?.destroy();
					previewComponent = undefined;
					return;
				}

				previewComponent = new Component();
				this.tryProvideDIToChild(previewComponent);

				for (const block of selected.get()) {
					const preview = blockList.blocks[BlockManager.manager.id.get(block)]?.logic?.preview;
					if (!preview) continue;

					previewComponent.parent(new preview(block));
				}

				previewComponent.enable();
			});
			this.parent(new Control(this.configContainer.instance.Content.PreviewButton)) //
				.addButtonAction(() => previewToggle.value.set(!previewToggle.value.get()));
			this.event.subscribeObservable(
				selected,
				(c) =>
					(this.configContainer.instance.Content.PreviewButton.Visible =
						!c.isEmpty() &&
						blockList.blocks[BlockManager.manager.id.get(c.first()!)]?.logic?.preview !== undefined),
				true,
			);
			this.event.subscribeObservable(selected, () => previewToggle.value.set(false), true);

			this.onEnable(() => this.updateConfigs([]));
			this.event.onPrepare((inputType) => {
				this.gui.Bottom.DeselectButton.Visible = inputType !== "Gamepad";
			});
		}

		private updateConfigs(selected: readonly BlockModel[]) {
			this.configParent.clear();

			const wasVisible = this.gui.Visible;

			this.gui.Visible = selected.size() !== 0;
			if (!this.gui.Visible) return;

			if (!wasVisible) GuiAnimator.transition(this.gui, 0.2, "up");
			const blockmodel = selected[0];
			const block = this.blockList.blocks[BlockManager.manager.id.get(blockmodel)!];
			if (!block) return;

			const onedef = block.logic?.definition.input;
			if (!onedef) return;

			const deforder = block.logic?.definition.inputOrder;

			this.gui.Visible = Objects.size(onedef) !== 0;
			if (!this.gui.Visible) return;

			this.gui.ParamsSelection.Heading.NameLabel.Text = Localization.translateForPlayer(
				Players.LocalPlayer,
				block.displayName,
			).fullUpper();
			this.gui.ParamsSelection.Heading.AmountLabel.Text = selected.size() > 1 ? `x${selected.size()}` : "";

			const configs = selected.map((selected) => {
				const blockmodel = selected;
				const id = BlockManager.manager.id.get(blockmodel)!;
				const block = this.blockList.blocks[id];
				if (!block) return undefined!;

				const defs = block.logic?.definition.input;
				if (!defs) return undefined!;

				const config = BlockConfig.addDefaults(
					BlockManager.manager.config.get(blockmodel) as PlacedBlockConfig,
					defs,
				);
				return {
					blockmodel,
					uuid: BlockManager.manager.uuid.get(blockmodel),
					config,
				} as const;
			});

			this.gui.ParamsSelection.Content.ScrollingFrame.Visible = false;

			const markered = BlockWireManager.fromPlot(
				this.tool.targetPlot.get(),
				this.tool.blockList,
				selected.map(BlockManager.manager.uuid.get),
			);

			this.configContainer.instance.Content.ScrollingFrame.Visible = false;
			const gui = this.configContainer.instance.Content.ScrollingFrame.Clone();
			gui.Visible = true;
			gui.Parent = this.configContainer.instance.Content;

			try {
				const configControl = this.configParent.set(
					this.di.resolveForeignClass(MultiBlockConfigControl, [
						gui,
						onedef,
						asObject(configs.mapToMap((c) => $tuple(c.uuid, c.config))),
						deforder,
						markered,
					]),
				);

				configControl.travelledTo.Connect((uuid) => {
					this.tool.unselectAll();
					this.tool.selectBlockByUuid(uuid);
				});
				configControl.submitted.Connect((config) => {
					const selected = this.tool.selected.get();
					$log(`Sending (${selected.size()}) block config values ${JSON.serialize(asMap(config).values())}`);

					const response = this.clientBuilding.updateConfigOperation.execute({
						plot: this.tool.targetPlot.get(),
						configs: selected.map(
							(b) =>
								({
									block: b,
									cfg: config[BlockManager.manager.uuid.get(b)] as never,
								}) satisfies ClientBuildingTypes.UpdateConfigArgs["configs"][number],
						),
					});
					if (!response.success) {
						LogControl.instance.addLine(response.message, Colors.red);
						this.updateConfigs([...selected]);
					}

					for (const model of selected) {
						BlockCreation.runImmediateFrom(model, this.blockList);
					}
				});
			} catch (err) {
				this.popupController.showPopup(new ReportSubmitPopup({ err, selected, configs }));
			}
		}
	}
}

type TutorialConfigBlockHighlight = { position: Vector3 }; // TODO: config tool tutorial something delete this or not
@injectable
export class ConfigTool extends ToolBase {
	readonly blocksToConfigure: TutorialConfigBlockHighlight[] = [];
	readonly selected = new ObservableCollectionSet<BlockModel>();
	readonly gui;

	constructor(
		@inject mode: BuildingMode,
		@inject readonly blockList: BlockList,
		@inject keybinds: Keybinds,
		@inject di: DIContainer,
	) {
		super(mode);
		this.gui = this.parentGui(
			di.resolveForeignClass(Scene.ConfigToolScene, [
				ToolBase.getToolGui<"Config", Scene.ConfigToolSceneDefinition>().Config,
			]),
		);

		this.parent(di.resolveForeignClass(SelectedBlocksHighlighter, [this.selected]));

		const canBeSelected = (block: BlockModel): boolean => {
			if (this.blocksToConfigure.size() > 0) {
				if (
					!this.blocksToConfigure.any(
						(value) =>
							VectorUtils.roundVector3(value.position) ===
							VectorUtils.roundVector3(
								this.targetPlot
									.get()
									.instance.BuildingArea.GetPivot()
									.PointToObjectSpace(block.GetPivot().Position),
							),
					)
				) {
					return false;
				}
			}

			const configDef = blockList.blocks[BlockManager.manager.id.get(block)]?.logic?.definition;
			if (!configDef) return false;

			if (!asMap((configDef as BlockLogicBothDefinitions).input).findValue((k, v) => !v.configHidden)) {
				return false;
			}

			return true;
		};
		const filter = (blocks: readonly BlockModel[]): readonly BlockModel[] => {
			blocks = blocks.filter(canBeSelected);

			let selected = this.selected.get();
			if (!InputController.isShiftPressed() && InputController.inputType.get() === "Desktop") {
				selected = new Set();
			}

			const newBlocks = new Set<BlockModel>();
			const getIdentifier = (block: BlockModel) =>
				blockList.blocks[BlockManager.manager.id.get(block)]?.logic?.definition;

			for (const block of blocks) {
				const id = getIdentifier(block);
				const differentId =
					selected.find((s) => getIdentifier(s) !== id) ?? blocks.find((s) => getIdentifier(s) !== id);

				if (differentId === undefined) {
					newBlocks.add(block);
				}
			}

			return [...newBlocks];
		};

		this.parent(new MultiBlockHighlightedSelector(mode.targetPlot, this.selected, { filter }, keybinds));
		this.onDisable(() => this.unselectAll());
	}

	selectBlockByUuid(uuid: BlockUuid) {
		this.selected.setRange([this.targetPlot.get().getBlock(uuid)]);
	}
	unselectAll() {
		this.selected.clear();
	}

	getDisplayName(): string {
		return "Configuring";
	}

	getImageID(): string {
		return "http://www.roblox.com/asset/?id=15414751900";
	}
}
