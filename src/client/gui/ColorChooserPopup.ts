import { ContextActionService, UserInputService } from "@rbxts/services";
import { Anim } from "client/gui/Anim";
import { Color4Chooser } from "client/gui/Color4Chooser";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import type { Color4ChooserDefinition } from "client/gui/Color4Chooser";
import type { PopupController } from "client/gui/PopupController";
import type { SubmittableValue } from "engine/shared/event/SubmittableValue";

/** Nudge a freshly positioned window back inside the screen, in the units its own scale is drawn at. */
const fitToScreen = (instance: GuiObject) => {
	const min = instance.AbsolutePosition;
	if (min.X < 0) {
		instance.Position = instance.Position.add(new UDim2(0, -min.X, 0, 0));
	}
	if (min.Y < 0) {
		instance.Position = instance.Position.add(new UDim2(0, 0, 0, -min.Y));
	}

	const screen = instance.FindFirstAncestorWhichIsA("ScreenGui");
	if (!screen) return;
	const scale = screen.FindFirstChild("UIScale") as UIScale | undefined;
	if (!scale) return;

	const screenSize = screen.AbsoluteSize.add(new Vector2(0, -40));
	const max = instance.AbsolutePosition.add(instance.AbsoluteSize);

	if (max.X > screenSize.X) {
		instance.Position = instance.Position.add(new UDim2(0, (screenSize.X - max.X) / scale.Scale, 0, 0));
	}
	if (max.Y > screenSize.Y) {
		instance.Position = instance.Position.add(new UDim2(0, 0, 0, (screenSize.Y - max.Y) / scale.Scale));
	}
};

/**
 * Open the floating colour chooser at the cursor, bound to `value`, and dismiss it on a click or tap outside.
 * Keyboard and gamepad are sunk while it is open so the game does not act on what is typed into it.
 *
 * `near` only supplies the UI scale the cursor position is divided by; the window itself is its own screen.
 */
export function showColorChooser(
	popupController: PopupController,
	near: GuiObject,
	value: SubmittableValue<Color4>,
	allowAlpha: boolean,
) {
	const scale = (Anim.findScreen(near)?.FindFirstChild("UIScale") as UIScale | undefined)?.Scale ?? 1;
	const mousePos = UserInputService.GetMouseLocation().div(scale);

	const template = Interface.getInterface<{
		Floating: {
			Color: GuiObject & { Content: GuiObject & { Control: Color4ChooserDefinition } };
		};
	}>().Floating.Color;
	const colorGui = template.Clone();
	colorGui.Position = new UDim2(0, mousePos.X, 0, mousePos.Y);

	const window = new Control(colorGui);
	window.parent(new Color4Chooser(colorGui.Content.Control, value, allowAlpha));

	const popup = popupController.showPopup(window);
	fitToScreen(colorGui);

	let isInside = false;
	colorGui.MouseEnter.Connect(() => (isInside = true));
	colorGui.MouseLeave.Connect(() => (isInside = false));

	ContextActionService.BindAction(
		"everything",
		() => Enum.ContextActionResult.Sink,
		false,
		Enum.UserInputType.Keyboard,
		Enum.UserInputType.Gamepad1,
	);
	popup.onDestroy(() => ContextActionService.UnbindAction("everything"));

	popup.event.subInput((ih) => {
		task.delay(0, () => {
			ih.onTouchTap(() => {
				const mouse = Interface.mouse;
				const objects = Interface.getPlayerGui().GetGuiObjectsAtPosition(mouse.X, mouse.Y);
				if (objects.contains(colorGui)) return;

				popup.destroy();
			});
		});

		ih.onMouse1Down(() => {
			if (isInside) return;
			popup.destroy();
		}, true);
	});
}
