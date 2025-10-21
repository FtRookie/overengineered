import { StarterGui, UserInputService } from "@rbxts/services";
import { LoadingController } from "client/controller/LoadingController";
import { SoundController } from "client/controller/SoundController";
import { Control } from "engine/client/gui/Control";
import { ComponentKeyedChildren } from "engine/shared/component/ComponentKeyedChildren";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { Transforms } from "engine/shared/component/Transforms";
import type { Theme } from "client/Theme";
import type { ToolBase } from "client/tools/ToolBase";
import type { ToolController } from "client/tools/ToolController";

export type HotbarToolButtonControlDefinition = TextButton & {
	readonly ImageLabel: ImageLabel;
	readonly NumLabel: TextLabel;
};

@injectable
export class HotbarButtonControl extends Control<HotbarToolButtonControlDefinition> {
	constructor(
		gui: HotbarToolButtonControlDefinition,
		tools: ToolController,
		tool: ToolBase,
		index: number,
		@inject theme: Theme,
	) {
		super(gui);

		this.instance.Name = tool.getDisplayName();
		this.instance.ImageLabel.Image = tool.getImageID();
		this.instance.NumLabel.Text = tostring(index);

		this.event.subscribe(this.instance.Activated, () => {
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
				}
			},
			true,
		);
		this.event.subscribeImmediately(
			toolController.enabledTools.updated,
			() => {
				for (const [tool, control] of toolButtons.getAll()) {
					const isenabled = toolController.enabledTools.isEnabled(tool);

					control.instance.BackgroundTransparency = isenabled ? 0.2 : 0.6;
					control.instance.Active = isenabled;
					control.instance.Interactable = isenabled;
					control.instance.AutoButtonColor = isenabled;
				}
			},
			true,
		);

		this.event.onPrepare((inputType) => {
			for (const button of toolButtons.getAll()) {
				button[1].instance.NumLabel.Visible = inputType === "Desktop";
			}

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
}
