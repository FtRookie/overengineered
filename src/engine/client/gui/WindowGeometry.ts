import { GuiService, Workspace } from "@rbxts/services";

/**
 * Combined UIScale above `target`, plus the screen it lives on. A scale sits on the ScreenGui for anything under
 * the scaled interface, and on nothing at all for a window with its own screen, so the caller reads it rather than
 * having to know which case it is.
 */
export function ancestry(target: GuiObject): LuaTuple<[scale: number, screen: ScreenGui | undefined]> {
	let scale = 1;
	let current = target.Parent;

	while (current) {
		const uiscale = current.FindFirstChildOfClass("UIScale");
		if (uiscale) scale *= uiscale.Scale;
		if (current.IsA("ScreenGui")) return $tuple(scale, current);

		current = current.Parent;
	}

	return $tuple(scale, undefined);
}

/**
 * The screen's usable rectangle in AbsolutePosition space: left, top, right, bottom.
 */
export function screenEdges(screen: ScreenGui): LuaTuple<[number, number, number, number]> {
	// AbsolutePosition is measured from the top left of the window, so an inset-respecting screen starts below the
	// topbar rather than at zero. GetGuiInset returns a tuple; comparing it undestructured is meaningless.
	const [inset] = GuiService.GetGuiInset();
	const originX = screen.IgnoreGuiInset ? 0 : inset.X;
	const originY = screen.IgnoreGuiInset ? 0 : inset.Y;

	// Whether ScreenGui.AbsoluteSize already excludes the inset is not something the docs pin down, and guessing
	// wrong lets the window hang off the bottom by the inset. The viewport is the hard edge either way, so take
	// whichever limit is nearer.
	const area = screen.AbsoluteSize;
	const viewport = Workspace.CurrentCamera?.ViewportSize ?? area;

	return $tuple(originX, originY, math.min(originX + area.X, viewport.X), math.min(originY + area.Y, viewport.Y));
}
