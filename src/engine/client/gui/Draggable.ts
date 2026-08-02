import { UserInputService } from "@rbxts/services";
import { setCursor } from "engine/client/gui/Cursor";
import { ancestry, clampPositionToScreen, positionBounds, screenEdges } from "engine/client/gui/WindowGeometry";
import type { ComponentEvents } from "engine/shared/component/ComponentEvents";

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
		event.subscribe(screen.GetPropertyChangedSignal("AbsoluteSize"), () => clampPositionToScreen(target));

		// Authored positions are laid out on a desktop viewport and can fall outside a smaller one, where nothing
		// would ever pull them back: until now this only ran when the viewport changed. Deferred past the first
		// layout pass, since an AutomaticSize window measures short before it.
		task.defer(() => clampPositionToScreen(target));
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
		const [minX, minY, maxX, maxY] = positionBounds(target, left, top, right, bottom);
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
