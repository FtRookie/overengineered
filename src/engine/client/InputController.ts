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

/** Basic class of input data type control */
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

	/**
	 * Held keys tracked from input events. IsKeyDown alone is not dependable for modifiers on every platform — a
	 * held Ctrl reports false under the Android build, which silently breaks undo/redo and every modifier check —
	 * while the key events themselves still arrive. Polling is kept as well so nothing regresses where it works.
	 */
	const heldKeys = new Set<Enum.KeyCode>();
	UserInputService.InputBegan.Connect((input) => heldKeys.add(input.KeyCode));
	UserInputService.InputEnded.Connect((input) => heldKeys.delete(input.KeyCode));
	// Keys released while the window is unfocused never report their end, and would otherwise stay held forever.
	UserInputService.WindowFocusReleased.Connect(() => heldKeys.clear());

	/**
	 * Whether `key` is currently held. Every source is consulted because no single one is dependable on every
	 * platform: the tracked events, the direct query, and the pressed-key list, which come from different paths
	 * and disagree about held modifiers under the Android build.
	 */
	export function isKeyHeld(key: Enum.KeyCode): boolean {
		if (heldKeys.has(key)) return true;
		if (UserInputService.IsKeyDown(key)) return true;

		for (const input of UserInputService.GetKeysPressed()) {
			if (input.KeyCode === key) return true;
		}

		return false;
	}

	/**
	 * Record a key as held or released from a source other than UserInputService. ContextActionService still
	 * delivers a modifier that UserInputService and IsKeyDown both miss, so a binding feeds what it sees back
	 * here and every modifier check benefits.
	 */
	export function setKeyHeld(key: Enum.KeyCode, held: boolean) {
		if (held) heldKeys.add(key);
		else heldKeys.delete(key);
	}

	/** Returns true if the right or left ctrl is pressed */
	export function isCtrlPressed(): boolean {
		return isKeyHeld(Enum.KeyCode.LeftControl) || isKeyHeld(Enum.KeyCode.RightControl);
	}

	/** Returns true if the right or left shift is pressed */
	export function isShiftPressed(): boolean {
		return isKeyHeld(Enum.KeyCode.LeftShift) || isKeyHeld(Enum.KeyCode.RightShift);
	}
}
