import { UserInputService } from "@rbxts/services";
import { setCursor } from "engine/client/gui/Cursor";
import { ancestry, screenEdges } from "engine/client/gui/WindowGeometry";
import type { ComponentEvents } from "engine/shared/component/ComponentEvents";

/** How near an edge a press must land to grab it, in screen pixels. */
const GRAB = 8;

export type ResizeConfig = {
	/** Smallest allowed Size offsets. */
	readonly min: Vector2;
	/** Largest allowed Size offsets; unbounded when omitted, the screen still clamps. */
	readonly max?: Vector2;
	/**
	 * Edges that may be grabbed; all four by default. Exclude any edge occupied by a drag handle — a title bar
	 * along the top would otherwise share its band with the resize zone and the two fight over the same press.
	 */
	readonly edges?: {
		readonly left?: boolean;
		readonly right?: boolean;
		readonly top?: boolean;
		readonly bottom?: boolean;
	};
	/**
	 * Hover cursors per grab direction, as uploaded image asset ids. Omitted directions leave the cursor alone,
	 * and omitting the whole table skips hover tracking entirely. Roblox's built-in `SystemCursors` are Studio
	 * plugin only and cannot be used here.
	 */
	readonly cursors?: {
		/** Left and right edges. */
		readonly horizontal?: string;
		/** Top and bottom edges. */
		readonly vertical?: string;
		/** Top-left and bottom-right corners. */
		readonly diagonal?: string;
		/** Top-right and bottom-left corners. */
		readonly antidiagonal?: string;
	};
	/** Fired once per gesture, on release, only when the size actually changed. */
	readonly onResized?: (size: UDim2) => void;
};

function cursorFor(grab: Grab, cursors: ResizeConfig["cursors"]): string | undefined {
	if (grab.x === 0) return cursors?.vertical;
	if (grab.y === 0) return cursors?.horizontal;

	// Same sign is the top-left/bottom-right diagonal; opposite signs the other one.
	return grab.x === grab.y ? cursors?.diagonal : cursors?.antidiagonal;
}

type Grab = { readonly x: -1 | 0 | 1; readonly y: -1 | 0 | 1 };

/** Which edges a press at `absolute` grabs, or undefined when it lands away from every grabbable edge. */
function grabAt(
	target: GuiObject,
	absoluteX: number,
	absoluteY: number,
	edges: ResizeConfig["edges"],
): Grab | undefined {
	const pos = target.AbsolutePosition;
	const size = target.AbsoluteSize;

	const left = absoluteX - pos.X;
	const right = pos.X + size.X - absoluteX;
	const top = absoluteY - pos.Y;
	const bottom = pos.Y + size.Y - absoluteY;

	// Outside the window entirely — a press that merely passes near an edge from outside is not a grab.
	if (left < 0 || right < 0 || top < 0 || bottom < 0) return undefined;

	// An AutomaticSize axis is written by the engine to fit content, so a grab there would be overwritten on the
	// next layout pass. Refuse it rather than offer a handle that does nothing.
	const auto = target.AutomaticSize;
	const freeX = auto !== Enum.AutomaticSize.X && auto !== Enum.AutomaticSize.XY;
	const freeY = auto !== Enum.AutomaticSize.Y && auto !== Enum.AutomaticSize.XY;

	const grabLeft = edges?.left ?? true;
	const grabRight = edges?.right ?? true;
	const grabTop = edges?.top ?? true;
	const grabBottom = edges?.bottom ?? true;

	const x = !freeX ? 0 : grabLeft && left <= GRAB ? -1 : grabRight && right <= GRAB ? 1 : 0;
	const y = !freeY ? 0 : grabTop && top <= GRAB ? -1 : grabBottom && bottom <= GRAB ? 1 : 0;
	if (x === 0 && y === 0) return undefined;

	return { x, y };
}

/**
 * Resize `target` by pressing and dragging within {@link GRAB} pixels of any edge or corner. The zone is read from
 * where the press lands rather than from a dedicated handle, so the same code serves mouse and touch — hover does
 * not exist on touch. A GuiButton inside the window sinks its own press, so controls never start a resize.
 *
 * Assumes an AnchorPoint of (0, 0): a left or top grab moves Position by exactly what it takes off Size, leaving
 * the opposite edge where it is. Size Scale components are preserved; only the offsets move.
 */
export function initResizing(event: ComponentEvents, target: GuiObject, config: ResizeConfig) {
	target.Active = true; // a Frame only gets InputBegan once it's Active

	// Identity for cursor ownership; the icon is global and only one resizer may hold it at a time.
	const token = {};
	event.state.onDisable(() => setCursor(token, undefined));

	let grab: Grab | undefined;
	let cursorX = 0;
	let cursorY = 0;
	let scale = 1;
	let startSize = target.Size;
	let startPosition = target.Position;
	let startAbsolute = target.AbsoluteSize;
	// Screen room is measured from where the gesture started, matching the size delta. Reading it live would
	// shrink the remaining room by what a left/top grab had already moved, and the two would fight.
	let startAbsolutePosition = target.AbsolutePosition;
	// Screen edges hold still for one gesture.
	let left = -math.huge;
	let top = -math.huge;
	let right = math.huge;
	let bottom = math.huge;

	/** Offset delta for one axis, clamped so the window keeps its size limits and stays on screen. */
	const clampDelta = (
		delta: number,
		dir: -1 | 1,
		startOffset: number,
		startAbs: number,
		absoluteStart: number,
		min: number,
		max: number,
		edgeNear: number,
		edgeFar: number,
	): number => {
		// A near-edge grab shrinks by what it moves, so the size delta runs opposite to the cursor.
		const sizeDelta = dir === 1 ? delta : -delta;
		const clampedSize = math.clamp(startOffset + sizeDelta, min, max) - startOffset;

		// Room before the moving edge meets the screen, in offset units.
		const room =
			dir === 1
				? (edgeFar - (absoluteStart + startAbs)) / scale //
				: (absoluteStart - edgeNear) / scale;

		const limited = math.min(clampedSize, room);
		return dir === 1 ? limited : -limited;
	};

	event.subscribe(target.InputBegan, (input) => {
		if (
			input.UserInputType !== Enum.UserInputType.MouseButton1 &&
			input.UserInputType !== Enum.UserInputType.Touch
		) {
			return;
		}

		grab = grabAt(target, input.Position.X, input.Position.Y, config.edges);
		if (!grab) return;

		cursorX = input.Position.X;
		cursorY = input.Position.Y;
		startSize = target.Size;
		startPosition = target.Position;
		startAbsolute = target.AbsoluteSize;
		startAbsolutePosition = target.AbsolutePosition;

		// Resolved per gesture: the window may have been rescaled since the last one.
		const [ancestorScale, screen] = ancestry(target);
		scale = math.max(ancestorScale, 0.001); // a pixel of cursor travel is worth 1/scale of offset

		if (!screen) {
			left = top = -math.huge;
			right = bottom = math.huge;
			return;
		}

		[left, top, right, bottom] = screenEdges(screen);
	});

	event.subscribe(UserInputService.InputChanged, (input) => {
		if (
			input.UserInputType !== Enum.UserInputType.MouseMovement &&
			input.UserInputType !== Enum.UserInputType.Touch
		) {
			return;
		}

		// Hover feedback, only while idle: during a gesture the cursor keeps the grabbed edge's icon even once
		// it has travelled off that edge.
		if (!grab && config.cursors) {
			const hover = grabAt(target, input.Position.X, input.Position.Y, config.edges);
			setCursor(token, hover ? cursorFor(hover, config.cursors) : undefined);
		}

		if (!grab) return;

		const maxX = config.max?.X ?? math.huge;
		const maxY = config.max?.Y ?? math.huge;

		let width = startSize.X.Offset;
		let height = startSize.Y.Offset;
		let x = startPosition.X.Offset;
		let y = startPosition.Y.Offset;

		if (grab.x !== 0) {
			const d = clampDelta(
				(input.Position.X - cursorX) / scale,
				grab.x,
				startSize.X.Offset,
				startAbsolute.X,
				startAbsolutePosition.X,
				config.min.X,
				maxX,
				left,
				right,
			);

			width = startSize.X.Offset + (grab.x === 1 ? d : -d);
			if (grab.x === -1) x = startPosition.X.Offset + d;
		}

		if (grab.y !== 0) {
			const d = clampDelta(
				(input.Position.Y - cursorY) / scale,
				grab.y,
				startSize.Y.Offset,
				startAbsolute.Y,
				startAbsolutePosition.Y,
				config.min.Y,
				maxY,
				top,
				bottom,
			);

			height = startSize.Y.Offset + (grab.y === 1 ? d : -d);
			if (grab.y === -1) y = startPosition.Y.Offset + d;
		}

		target.Size = new UDim2(startSize.X.Scale, width, startSize.Y.Scale, height);
		target.Position = new UDim2(startPosition.X.Scale, x, startPosition.Y.Scale, y);
	});

	event.subscribe(UserInputService.InputEnded, (input) => {
		if (
			input.UserInputType === Enum.UserInputType.MouseButton1 ||
			input.UserInputType === Enum.UserInputType.Touch
		) {
			// Only on a real resize, so a click near the edge doesn't report a change.
			if (grab && target.Size !== startSize) config.onResized?.(target.Size);
			grab = undefined;
		}
	});
}
