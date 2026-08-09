import { RunService, UserInputService } from "@rbxts/services";
import { setCursor } from "engine/client/gui/Cursor";
import {
	ancestry,
	clampPositionToScreen,
	positionBounds,
	scalesAbove,
	screenEdges,
} from "engine/client/gui/WindowGeometry";
import type { ComponentEvents } from "engine/shared/component/ComponentEvents";

/**
 * Move `target` by pressing and holding `handle` — typically a window's title bar. A GuiButton inside the handle
 * sinks its own press, so grabbing one of those never starts a drag.
 *
 * The window is kept fully on screen — while dragging, when the viewport resizes under it, and when the window
 * itself grows — so a window can't be lost. One larger than the screen is instead kept covering it, since it
 * cannot satisfy the former.
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
	/**
	 * The input this drag belongs to. UserInputService reports every active touch, so without it a second finger
	 * anywhere on screen reads as this one having jumped there, and the window follows the gap between them.
	 */
	let activeInput: InputObject | undefined;
	let cursorX = 0;
	let cursorY = 0;
	/** Latest pointer position, applied once on the next frame rather than on every input event. */
	let pending = false;
	let pendingX = 0;
	let pendingY = 0;
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

		// An AutomaticSize window grows when its own content does — a section expanded near the bottom edge
		// would otherwise hang off screen with nothing to pull it back. Watching the window's own size is safe
		// here where a size clamp could not: this one writes Position, which never feeds back into AbsoluteSize.
		event.subscribe(target.GetPropertyChangedSignal("AbsoluteSize"), () => clampPositionToScreen(target));

		// Rescaling moves a window on screen without resizing the screen, so it needs its own trigger.
		for (const uiscale of scalesAbove(target)) {
			event.subscribe(uiscale.GetPropertyChangedSignal("Scale"), () => clampPositionToScreen(target));
		}

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
		activeInput = input;
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
		// A touch drag only follows the finger that started it. A mouse cannot use identity — the press arrives as
		// MouseButton1 and the movement as MouseMovement — but a mouse only has one pointer.
		if (activeInput?.UserInputType === Enum.UserInputType.Touch && input !== activeInput) return;

		// Buffered, not applied. Input fires independently of the frame, so writing here lands several times per
		// frame and sometimes mid-frame, which reads as the window jittering. PreRender applies the latest.
		pendingX = input.Position.X;
		pendingY = input.Position.Y;
		pending = true;
	});

	event.subscribe(RunService.PreRender, () => {
		if (!pending || !dragging) return;
		pending = false;

		// Clamp where the window lands, not how far the cursor moved, so overshooting parks it against the edge
		// and dragging back picks it up immediately.
		const [minX, minY, maxX, maxY] = positionBounds(target, left, top, right, bottom);
		const clampedX = math.clamp(startAbsX + (pendingX - cursorX), minX, maxX);
		const clampedY = math.clamp(startAbsY + (pendingY - cursorY), minY, maxY);

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
			if (activeInput?.UserInputType === Enum.UserInputType.Touch && input !== activeInput) return;

			// Only on a real drag, so a click on the title bar doesn't rewrite the stored position.
			if (dragging && target.Position !== start) onMoved?.(target.Position);
			dragging = false;
			activeInput = undefined;
			refreshCursor();
		}
	});
}
