import { GuiService, UserInputService } from "@rbxts/services";
import { ObservableValue } from "engine/shared/event/ObservableValue";

/** A permanent event that monitors the change in the type of input type, which makes the game more flexible */
namespace InputTypeChangeEvent {
	/** Returns the input type based on the given input type */
	function getInputTypeByEnum(userInputType: Enum.UserInputType): InputType {
		if (userInputType === Enum.UserInputType.Gamepad1) {
			return "Gamepad";
		} else if (userInputType === Enum.UserInputType.Touch) {
			return "Touch";
		} else {
			return "Desktop";
		}
	}

	/** Callback of subscribed event */
	function onLastInputTypeChanged(lastInputType: Enum.UserInputType) {
		const newInputType = getInputTypeByEnum(lastInputType);

		if (newInputType !== InputController.inputType.get()) {
			if (UserInputService.GetFocusedTextBox()) {
				return;
			}

			InputController.inputType.set(newInputType);
		}
	}

	export function subscribe() {
		// Event
		UserInputService.LastInputTypeChanged.Connect(onLastInputTypeChanged);
	}
}
InputTypeChangeEvent.subscribe();

/**
 * Device input type and held-key state.
 *
 * Player-facing binds go through Keybinds.ts
 */
export namespace InputController {
	export const inputType = new ObservableValue<InputType>(InputController.getPhysicalInputType());
	export const isDesktop = inputType.createBased((inputType) => inputType === "Desktop");
	export const isGamepad = inputType.createBased((inputType) => inputType === "Gamepad");
	export const isTouch = inputType.createBased((inputType) => inputType === "Touch");

	/** Returns the input type based on the device the client is playing from */
	export function getPhysicalInputType(): InputType {
		if (GuiService.IsTenFootInterface()) {
			return "Gamepad";
		} else if (UserInputService.TouchEnabled && !UserInputService.MouseEnabled) {
			return "Touch";
		} else {
			return "Desktop";
		}
	}

	const heldKeys = new Set<Enum.KeyCode>();
	UserInputService.InputBegan.Connect((input) => heldKeys.add(input.KeyCode));
	UserInputService.InputEnded.Connect((input) => heldKeys.delete(input.KeyCode));
	UserInputService.WindowFocusReleased.Connect(() => heldKeys.clear());

	export function isKeyHeld(key: Enum.KeyCode): boolean {
		if (heldKeys.has(key)) return true;
		if (UserInputService.IsKeyDown(key)) return true;

		for (const input of UserInputService.GetKeysPressed()) {
			if (input.KeyCode === key) return true;
		}

		return false;
	}

	export function setKeyHeld(key: Enum.KeyCode, held: boolean) {
		if (held) heldKeys.add(key);
		else heldKeys.delete(key);
	}

	// below keys are used as modifiers

	export function isCtrlPressed(): boolean {
		return isKeyHeld(Enum.KeyCode.LeftControl) || isKeyHeld(Enum.KeyCode.RightControl);
	}

	export function isShiftPressed(): boolean {
		return isKeyHeld(Enum.KeyCode.LeftShift) || isKeyHeld(Enum.KeyCode.RightShift);
	}
}
