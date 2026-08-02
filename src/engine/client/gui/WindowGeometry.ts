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
 * A UIScale parented to `target` itself, which {@link ancestry} deliberately excludes — it starts at the parent.
 *
 * The distinction matters: an own-scale multiplies the frame's Size but not its Position, since Position resolves
 * in the parent's space. Anything converting between screen pixels and Size offsets has to include it; anything
 * converting to Position offsets must not.
 */
export function ownScale(target: GuiObject): number {
	return (target.FindFirstChildOfClass("UIScale")?.Scale ?? 1) || 1;
}

/**
 * Every UIScale above `target`, so a caller can react to the combined scale moving. A saved position is stored in
 * local units, so its position on screen is `offset × scale` — rescaling shifts a window without the screen ever
 * changing size, and nothing else would notice.
 */
export function scalesAbove(target: GuiObject): UIScale[] {
	const scales: UIScale[] = [];
	let current = target.Parent;

	while (current) {
		const uiscale = current.FindFirstChildOfClass("UIScale");
		if (uiscale) scales.push(uiscale);
		if (current.IsA("ScreenGui")) break;

		current = current.Parent;
	}

	return scales;
}

/**
 * The screen's usable rectangle in AbsolutePosition space: left, top, right, bottom.
 *
 * Read off the ScreenGui rather than derived from the GUI inset. A LayerCollector reports its own AbsolutePosition
 * and AbsoluteSize in the same space its children are measured in, with the inset and `IgnoreGuiInset` already
 * applied by the engine — so there is nothing left to work out, and no assumption to get wrong. Deriving it by
 * hand added the inset a second time, which on a mobile topbar is tall enough to pin a window below it and refuse
 * to let it be dragged back up.
 */
export function screenEdges(screen: ScreenGui): LuaTuple<[number, number, number, number]> {
	const at = screen.AbsolutePosition;
	const size = screen.AbsoluteSize;

	return $tuple(at.X, at.Y, at.X + size.X, at.Y + size.Y);
}

/**
 * Travel limits for `target`'s top-left corner, in AbsolutePosition space, so no part of it leaves the screen.
 * Size is read fresh rather than snapshotted: these windows are AutomaticSize, so a height measured too early
 * reads short and the far edge would let that much of the window hang off screen.
 * Slack goes negative when the window is bigger than the screen; min/max then swap so it stays covering it.
 */
export function positionBounds(
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
export function clampPositionToScreen(target: GuiObject) {
	const [ancestorScale, screen] = ancestry(target);
	if (!screen) return;

	const [left, top, right, bottom] = screenEdges(screen);
	const [minX, minY, maxX, maxY] = positionBounds(target, left, top, right, bottom);
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
 * How large `target`'s Size *offsets* may be and still fit the screen. The Scale component already contributes
 * part of the window, so it is measured off the current absolute size and taken out of the room on offer.
 */
export function offsetRoom(target: GuiObject, screen: ScreenGui, scale: number): LuaTuple<[number, number]> {
	const [left, top, right, bottom] = screenEdges(screen);
	const size = target.Size;
	const absolute = target.AbsoluteSize;
	// Size offsets render at the ancestor scale *and* the frame's own, so both convert screen pixels to offsets.
	const sizeScale = scale * ownScale(target);

	return $tuple(
		(right - left) / sizeScale - (absolute.X / sizeScale - size.X.Offset),
		(bottom - top) / sizeScale - (absolute.Y / sizeScale - size.Y.Offset),
	);
}

/**
 * Shrink `target` to fit the screen, down to `min` — and past it when even that will not fit, because a window
 * too large to fit is worse than one below its designed minimum. An AutomaticSize axis is left alone; the engine
 * writes it from content and would overwrite anything set here.
 */
export function clampSizeToScreen(target: GuiObject, min: Vector2) {
	const [ancestorScale, screen] = ancestry(target);
	if (!screen) return;

	const scale = math.max(ancestorScale, 0.001);
	const [roomX, roomY] = offsetRoom(target, screen, scale);
	const auto = target.AutomaticSize;
	const size = target.Size;

	const fit = (offset: number, room: number, smallest: number) =>
		math.clamp(offset, math.min(smallest, math.max(room, 0)), math.max(room, 0));

	const freeX = auto !== Enum.AutomaticSize.X && auto !== Enum.AutomaticSize.XY;
	const freeY = auto !== Enum.AutomaticSize.Y && auto !== Enum.AutomaticSize.XY;
	const width = freeX ? fit(size.X.Offset, roomX, min.X) : size.X.Offset;
	const height = freeY ? fit(size.Y.Offset, roomY, min.Y) : size.Y.Offset;
	if (width === size.X.Offset && height === size.Y.Offset) return;

	target.Size = new UDim2(size.X.Scale, width, size.Y.Scale, height);
}
