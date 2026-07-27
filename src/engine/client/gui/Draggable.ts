import { GuiService, UserInputService, Workspace } from "@rbxts/services";
import type { ComponentEvents } from "engine/shared/component/ComponentEvents";

/**
 * Combined UIScale above `target`, plus the screen it lives on. A scale sits on the ScreenGui for anything under
 * the scaled interface, and on nothing at all for a window with its own screen, so the drag reads it rather than
 * making the caller know which case it is.
 */
function ancestry(target: GuiObject): LuaTuple<[scale: number, screen: ScreenGui | undefined]> {
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
 * Travel limits for `target`'s top-left corner, in AbsolutePosition space, so no part of it leaves the screen.
 * Slack goes negative when the window is bigger than the screen; min/max then swap so it stays covering it.
 */
function screenEdges(screen: ScreenGui): LuaTuple<[number, number, number, number]> {
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

/**
 * Travel limits for `target`'s top-left corner, in AbsolutePosition space, so no part of it leaves the screen.
 * Size is read fresh rather than snapshotted: these windows are AutomaticSize, so a height measured too early
 * reads short and the far edge would let that much of the window hang off screen.
 * Slack goes negative when the window is bigger than the screen; min/max then swap so it stays covering it.
 */
function bounds(
	target: GuiObject,
	left: number,
	top: number,
	right: number,
	bottom: number,
): LuaTuple<[number, number, number, number]> {
	const size = target.AbsoluteSize;
	const farX = right - size.X;
	const farY = bottom - size.Y;

	return $tuple(math.min(left, farX), math.min(top, farY), math.max(left, farX), math.max(top, farY));
}

/** Pull `target` fully back on screen — the viewport can be resized out from under a window that was in view. */
function clampToScreen(target: GuiObject) {
	const [ancestorScale, screen] = ancestry(target);
	if (!screen) return;

	const [left, top, right, bottom] = screenEdges(screen);
	const [minX, minY, maxX, maxY] = bounds(target, left, top, right, bottom);
	const absolutePosition = target.AbsolutePosition;
	const dx = math.clamp(absolutePosition.X, minX, maxX) - absolutePosition.X;
	const dy = math.clamp(absolutePosition.Y, minY, maxY) - absolutePosition.Y;
	if (dx === 0 && dy === 0) return;

	const scale = math.max(ancestorScale, 0.001);
	const position = target.Position;
	target.Position = new UDim2(
		position.X.Scale,
		position.X.Offset + dx / scale,
		position.Y.Scale,
		position.Y.Offset + dy / scale,
	);
}

/**
 * Move `target` by pressing and holding `handle` — typically a window's title bar. A GuiButton inside the handle
 * sinks its own press, so grabbing one of those never starts a drag.
 *
 * The window is kept fully on screen, both while dragging and when the viewport resizes under it, so a window
 * can't be lost. One larger than the screen is instead kept covering it, since it cannot satisfy the former.
 */
export function initDragging(
	event: ComponentEvents,
	handle: GuiObject,
	target: GuiObject,
	onMoved?: (position: UDim2) => void,
) {
	handle.Active = true; // a Frame only gets InputBegan once it's Active

	let dragging = false;
	let cursorX = 0;
	let cursorY = 0;
	let scale = 1;
	let start = target.Position;
	let startAbsX = 0;
	let startAbsY = 0;
	// Screen edges hold still for a drag; the size-dependent limits are derived from them on every move.
	let left = -math.huge;
	let top = -math.huge;
	let right = math.huge;
	let bottom = math.huge;

	const [, screen] = ancestry(target);
	if (screen) {
		event.subscribe(screen.GetPropertyChangedSignal("AbsoluteSize"), () => clampToScreen(target));
	}

	event.subscribe(handle.InputBegan, (input) => {
		if (
			input.UserInputType !== Enum.UserInputType.MouseButton1 &&
			input.UserInputType !== Enum.UserInputType.Touch
		) {
			return;
		}

		dragging = true;
		cursorX = input.Position.X;
		cursorY = input.Position.Y;
		start = target.Position;

		const absolutePosition = target.AbsolutePosition;
		startAbsX = absolutePosition.X;
		startAbsY = absolutePosition.Y;

		// Resolved per drag: the window may have been resized, or the UI rescaled, since the last one.
		const [ancestorScale, dragScreen] = ancestry(target);
		scale = math.max(ancestorScale, 0.001); // a pixel of cursor travel is worth 1/scale of Position offset

		if (!dragScreen) {
			left = top = -math.huge;
			right = bottom = math.huge;
			return;
		}

		[left, top, right, bottom] = screenEdges(dragScreen);
	});
	event.subscribe(UserInputService.InputChanged, (input) => {
		if (!dragging) return;
		if (
			input.UserInputType !== Enum.UserInputType.MouseMovement &&
			input.UserInputType !== Enum.UserInputType.Touch
		) {
			return;
		}

		// Clamp where the window lands, not how far the cursor moved, so overshooting parks it against the edge
		// and dragging back picks it up immediately.
		const [minX, minY, maxX, maxY] = bounds(target, left, top, right, bottom);
		const clampedX = math.clamp(startAbsX + (input.Position.X - cursorX), minX, maxX);
		const clampedY = math.clamp(startAbsY + (input.Position.Y - cursorY), minY, maxY);

		target.Position = new UDim2(
			start.X.Scale,
			start.X.Offset + (clampedX - startAbsX) / scale,
			start.Y.Scale,
			start.Y.Offset + (clampedY - startAbsY) / scale,
		);
	});
	event.subscribe(UserInputService.InputEnded, (input) => {
		if (
			input.UserInputType === Enum.UserInputType.MouseButton1 ||
			input.UserInputType === Enum.UserInputType.Touch
		) {
			// Only on a real drag, so a click on the title bar doesn't rewrite the stored position.
			if (dragging && target.Position !== start) onMoved?.(target.Position);
			dragging = false;
		}
	});
}
