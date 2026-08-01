import { UserInputService } from "@rbxts/services";
import { setCursor } from "engine/client/gui/Cursor";
import { ancestry, screenEdges } from "engine/client/gui/WindowGeometry";
import type { ComponentEvents } from "engine/shared/component/ComponentEvents";

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
	/** Uploaded image asset shown while hovering or dragging the handle. Omitted leaves the cursor alone. */
	moveCursor?: string,
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

	// Cursor hint on the handle, declared after `dragging` so the closure captures the local rather than a nil
	// global. Held for the whole drag, since the pointer routinely leaves the handle while the window follows it.
	const token = {};
	let hovering = false;
	const refreshCursor = () => setCursor(token, hovering || dragging ? moveCursor : undefined);
	if (moveCursor !== undefined) {
		event.subscribe(handle.MouseEnter, () => {
			hovering = true;
			refreshCursor();
		});
		event.subscribe(handle.MouseLeave, () => {
			hovering = false;
			refreshCursor();
		});
		event.state.onDisable(() => setCursor(token, undefined));
	}

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
		refreshCursor();
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
			refreshCursor();
		}
	});
}
