import { Players } from "@rbxts/services";

export namespace Interface {
	// fixme: GetMouse() is deprecated. Migrate to UserInputService.GetMouseLocation(), but first verify the
	// GUI-inset offset — GetGuiObjectsAtPosition consumes mouse.X/Y and a naive swap shifts it by the inset.
	export const mouse = Players.LocalPlayer.GetMouse();

	const playergui = Players.LocalPlayer.FindFirstChildOfClass("PlayerGui")!;
	const gameui = playergui.WaitForChild("Interface");
	const popups = playergui.WaitForChild("Popups");
	const templates = gameui.WaitForChild("Templates");
	const unscaled = playergui.WaitForChild("Unscaled");

	/** Returns PlayerGui */
	export function getPlayerGui<T = PlayerGui>(): T {
		return playergui as T;
	}

	/** Returns PlayerGui.Interface */
	export function getInterface<T = ScreenGui>(): T {
		return gameui as T;
	}

	/** Returns PlayerGui.Interface.Templates */
	export function getTemplates<T>(): T {
		return templates as T;
	}

	/** Returns PlayerGui.Popups */
	export function getPopupUI<T = ScreenGui>(): T {
		return popups as T;
	}

	/** Returns PlayerGui.Unscaled */
	export function getUnscaled<T = ScreenGui>(): T {
		return unscaled as T;
	}

	export function isCursorOnVisibleGui(): boolean {
		const objects = playergui.GetGuiObjectsAtPosition(mouse.X, mouse.Y);
		return objects.some((value) => value.Visible && value.BackgroundTransparency < 1);
	}
}
