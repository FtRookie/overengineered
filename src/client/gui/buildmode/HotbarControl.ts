import { StarterGui, UserInputService } from "@rbxts/services";
import { LoadingController } from "client/controller/LoadingController";
import { SoundController } from "client/controller/SoundController";
import { toolKeybinds } from "client/tools/ToolController";
import { Control } from "engine/client/gui/Control";
import { HoldPress } from "engine/client/gui/HoldPress";
import { InputController } from "engine/client/InputController";
import { ComponentKeyedChildren } from "engine/shared/component/ComponentKeyedChildren";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { Transforms } from "engine/shared/component/Transforms";
import { Keys } from "engine/shared/fixes/Keys";
import type { Theme } from "client/Theme";
import type { ToolBase } from "client/tools/ToolBase";
import type { ToolController } from "client/tools/ToolController";
import type { KeyCombination, Keybinds } from "engine/client/Keybinds";

/** Seconds a tool button is held before it can be dragged; a quicker release is a click */
const hotbarHoldTime = 0.3;

export type HotbarToolButtonControlDefinition = TextButton & {
	readonly ImageLabel: ImageLabel;
	readonly NumLabel: TextLabel;
};

@injectable
export class HotbarButtonControl extends Control<HotbarToolButtonControlDefinition> {
	/** The press that picks this button up to drag it; the release that drops it does not also select the tool */
	hold?: HoldPress;

	constructor(
		gui: HotbarToolButtonControlDefinition,
		tools: ToolController,
		tool: ToolBase,
		index: number,
		@inject theme: Theme,
		@inject keybinds: Keybinds,
	) {
		super(gui);

		this.instance.Name = tool.getDisplayName();
		this.instance.ImageLabel.Image = tool.getImageID();

		// the slot's own key, which follows the position rather than the tool
		const slot = toolKeybinds.slots[index - 1];
		const showKey = (combos: readonly KeyCombination[]) => {
			const combo = combos.find((c) => !c.any(Keys.isKeyGamepad));
			this.instance.NumLabel.Text = combo ? combo.map(Keys.toReadable).join("+") : "";
		};
		if (slot) this.event.subscribeObservable(keybinds.fromDefinition(slot).keys, showKey, true);
		else this.instance.NumLabel.Text = "";

		this.event.subscribe(this.instance.Activated, () => {
			if (this.hold?.held()) return;
			if (LoadingController.isLoading.get()) return;
			tools.selectedTool.set(tool === tools.selectedTool.get() ? undefined : tool);
		});

		this.initializeSimpleTransform("BackgroundColor3");
		this.event.subscribeObservable(
			tools.selectedTool,
			(newTool) => this.themeButton(theme, newTool === tool ? "buttonActive" : "buttonNormal"),
			true,
		);
	}
}

export type HotbarControlDefinition = GuiObject & {
	readonly Tools: GuiObject & {
		readonly GamepadLeft: Frame & { ImageLabel: ImageLabel };
		readonly GamepadRight: Frame & { ImageLabel: ImageLabel };
		readonly ToolTemplate: HotbarToolButtonControlDefinition;
	};
	readonly NameLabel: TextLabel;
};

@injectable
export class HotbarControl extends InstanceComponent<HotbarControlDefinition> {
	private readonly nameLabel;

	constructor(gui: HotbarControlDefinition, @inject toolController: ToolController, @inject di: DIContainer) {
		super(gui);

		// Disable roblox native backpack
		StarterGui.SetCoreGuiEnabled(Enum.CoreGuiType.Backpack, false);

		const template = this.asTemplate(this.instance.Tools.ToolTemplate);
		const toolButtons = this.parent(
			new ComponentKeyedChildren<ToolBase, HotbarButtonControl>().withParentInstance(this.instance.Tools),
		);

		this.nameLabel = this.parent(new Control(this.instance.NameLabel));

		/** Enabled state and key labels, for buttons built at any time, not only when those change */
		const styleButtons = () => {
			const desktop = InputController.inputType.get() === "Desktop";
			for (const [tool, control] of toolButtons.getAll()) {
				const isenabled = toolController.enabledTools.isEnabled(tool);

				control.instance.BackgroundTransparency = isenabled ? 0.2 : 0.6;
				control.instance.Active = isenabled;
				control.instance.Interactable = isenabled;
				control.instance.AutoButtonColor = isenabled;
				control.instance.NumLabel.Visible = desktop;
			}
		};

		const attachDrag = this.initDragging(toolController, toolButtons);
		this.event.subscribeObservable(
			toolController.tools,
			(tools) => {
				toolButtons.clear();

				let index = 0;
				for (const tool of tools) {
					const button = di.resolveForeignClass(HotbarButtonControl, [
						template(),
						toolController,
						tool,
						++index,
					]);
					toolButtons.add(tool, button);
					// between the gamepad hints at -1 and 9999; the drag preview reorders by these
					button.instance.LayoutOrder = index;
					attachDrag(tool, button);
				}
				styleButtons();
			},
			true,
		);
		this.event.subscribeImmediately(toolController.enabledTools.updated, styleButtons, true);

		this.event.onPrepare((inputType) => {
			styleButtons();
			this.instance.Tools.GamepadLeft.Visible = inputType === "Gamepad";
			this.instance.Tools.GamepadRight.Visible = inputType === "Gamepad";
		});

		this.event.onPrepareGamepad(() => {
			this.instance.Tools.GamepadLeft.ImageLabel.Image = UserInputService.GetImageForKeyCode(
				Enum.KeyCode.ButtonL1,
			);
			this.instance.Tools.GamepadRight.ImageLabel.Image = UserInputService.GetImageForKeyCode(
				Enum.KeyCode.ButtonR1,
			);
		});

		const toolChanged = (tool: ToolBase | undefined, prev: ToolBase | undefined) => {
			const duration = tool && prev ? 0.07 : 0.15;

			Transforms.create()
				.if(prev !== undefined, (tr) =>
					tr
						.moveRelative(this.nameLabel.instance, new UDim2(0, 0, 0, -20), { duration })
						.transform(this.nameLabel.instance, "TextTransparency", 1, { duration: duration * 0.8 })
						.then()
						.moveRelative(this.nameLabel.instance, new UDim2(0, 0, 0, 20)),
				)
				.then()
				.func(() => (this.instance.NameLabel.Text = tool?.getDisplayName() ?? ""))
				.if(tool !== undefined, (tr) =>
					tr
						.then()
						.moveRelative(this.nameLabel.instance, new UDim2(0, 0, 0, 20))
						.transform(this.nameLabel.instance, "TextTransparency", 1)
						.moveRelative(this.nameLabel.instance, new UDim2(0, 0, 0, -20), { duration })
						.transform(this.nameLabel.instance, "TextTransparency", 0, { duration: duration * 0.8 })
						.then(),
				)
				.run(this.nameLabel.instance);

			// Play sound
			SoundController.getUISounds().Click.Play();
		};
		this.event.subscribeObservablePrev(toolController.selectedTool, toolChanged, true);
		this.instance.NameLabel.Text = "";
	}

	/**
	 * Holding a tool button picks it up; dragging sideways shows where it will land, and releasing moves the tool
	 * there. A release before the hold is long enough is an ordinary click.
	 */
	private initDragging(
		toolController: ToolController,
		toolButtons: ComponentKeyedChildren<ToolBase, HotbarButtonControl>,
	): (tool: ToolBase, button: HotbarButtonControl) => void {
		type Drag = {
			readonly tool: ToolBase;
			readonly button: HotbarButtonControl;
			// the other buttons' centres, measured once the drag starts, before the preview moves them
			readonly centers: readonly number[];
			target: number;
		};
		let drag: Drag | undefined;

		const isPress = (input: InputObject) =>
			input.UserInputType === Enum.UserInputType.MouseButton1 || input.UserInputType === Enum.UserInputType.Touch;

		/** The buttons as currently laid out, left to right */
		const laidOut = (): HotbarButtonControl[] => {
			const buttons: HotbarButtonControl[] = [];
			for (const [, button] of toolButtons.getAll()) buttons.push(button);
			return buttons.sort((a, b) => a.instance.LayoutOrder < b.instance.LayoutOrder);
		};

		/** Lays the buttons out with the dragged one at `target`, reusing the layout orders they already have */
		const preview = (d: Drag) => {
			const ordered = laidOut();
			const orders = ordered.map((b) => b.instance.LayoutOrder);
			const others = ordered.filter((b) => b !== d.button);
			others.insert(math.clamp(d.target, 0, others.size()), d.button);
			others.forEach((b, i) => (b.instance.LayoutOrder = orders[i]));
		};

		const start = (tool: ToolBase, button: HotbarButtonControl) => {
			button.instance.BackgroundTransparency = 0.6;

			const ordered = laidOut();
			drag = {
				tool,
				button,
				target: ordered.indexOf(button),
				centers: ordered
					.filter((b) => b !== button)
					.map((b) => b.instance.AbsolutePosition.X + b.instance.AbsoluteSize.X / 2),
			};
		};

		this.event.subscribe(UserInputService.InputChanged, (input) => {
			const d = drag;
			if (!d) return;
			if (
				input.UserInputType !== Enum.UserInputType.MouseMovement &&
				input.UserInputType !== Enum.UserInputType.Touch
			) {
				return;
			}

			const x = input.Position.X;
			const target = d.centers.count((center) => center < x);
			if (target === d.target) return;

			d.target = target;
			preview(d);
		});
		this.event.subscribe(UserInputService.InputEnded, (input) => {
			const d = drag;
			if (!d || !isPress(input)) return;
			drag = undefined;

			toolController.moveTool(d.tool, d.target);
		});

		return (tool, button) => {
			button.hold = button.parent(new HoldPress(button.instance, hotbarHoldTime, () => start(tool, button)));
		};
	}
}
