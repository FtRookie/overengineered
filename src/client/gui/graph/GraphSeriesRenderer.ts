import { GraphData } from "client/gui/graph/GraphSessionStore";
import { ancestry } from "engine/client/gui/WindowGeometry";
import { Component } from "engine/shared/component/Component";
import { Strings } from "engine/shared/fixes/String.propmacro";
import type { GraphAxisConfig, GraphGroup, RecordedOutput } from "client/gui/graph/GraphSessionStore";

/** Default per channel rather than per series, so X is the same hue on every graph until a row overrides it. */
export const CHANNEL_COLORS: readonly Color3[] = [
	Color3.fromRGB(79, 176, 255),
	Color3.fromRGB(110, 231, 135),
	Color3.fromRGB(255, 123, 114),
];

const POINT_SIZE = 3;
const SEGMENT_THICKNESS = 2;
/** Padding inside the plot so a point sitting exactly on a bound is not half-clipped. */
const INSET = 4;
/** Range opened up when bounds collapse or invert, so an unsatisfiable axis still divides cleanly. */
const DEGENERATE_SPAN = 1;
/** Matches the template's authored width, so a single-tick burn is still visible rather than sub-pixel. */
const SENTINEL_MIN_WIDTH = 3;
/** Axis window opened when nothing has ever been drawn, so a fully burned series still has somewhere to land. */
const FALLBACK_BOUND = 1;

/** Both ends pinned, and backwards. Module level so the check costs no closure per redraw. */
const isInverted = (axis: GraphAxisConfig) => axis.min !== undefined && axis.max !== undefined && axis.min > axis.max;

/** Grid lines aimed for per axis. The 1/2/5 rounding only ever lengthens the step, so this is also the maximum. */
const GRID_TARGET = 5;
/** How near the pointer must come to a pinned cursor, in local pixels, to snap onto it and so be able to remove it. */
const CURSOR_SNAP = 6;
/** Pixels between neighbouring lines below which their labels would collide and are dropped instead. */
const GRID_LABEL_GAP_X = 44;
const GRID_LABEL_GAP_Y = 18;
/** Margin at each end owned by the corner bound boxes; a grid label landing inside it is dropped. */
const GRID_EDGE_X = 28;
const GRID_EDGE_Y = 14;

/**
 * Round step at or just above `range / target` — 1, 2 or 5 times a power of ten — so every line lands on a number
 * worth reading and the labels stay stable as the bounds drift.
 */
const niceStep = (range: number, target: number): number => {
	if (range <= 0) return 1;

	const raw = range / target;
	const magnitude = math.pow(10, math.floor(math.log(raw, 10)));
	const n = raw / magnitude;

	return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * magnitude;
};

type GridLine = Frame & { readonly Label: TextLabel };
type CursorLine = Frame & { readonly Intercept: TextLabel };
type Pooled = {
	readonly points: Frame[];
	readonly segments: Frame[];
	readonly sentinels: Frame[];
	readonly gridX: GridLine[];
	readonly gridY: GridLine[];
	readonly cursors: CursorLine[];
};
/** The two grid layers and their templates, grouped so the constructor keeps one parameter per concern. */
export type GraphGrid = {
	readonly x: GuiObject;
	readonly y: GuiObject;
	readonly xTemplate: () => GridLine;
	readonly yTemplate: () => GridLine;
	readonly cursorTemplate: () => CursorLine;
};

/**
 * Draws a group's samples as pooled Frames: one dot per plotted sample, plus an optional rotated bar between
 * consecutive dots.
 *
 * Both pools are allocated once and reused. Nothing is created or destroyed per redraw, and the sample count is
 * capped at the plot's pixel width, so a full buffer costs the same as a nearly empty one.
 */
export class GraphSeriesRenderer extends Component {
	private readonly pool: Pooled = { points: [], segments: [], sentinels: [], gridX: [], gridY: [], cursors: [] };
	private usedPoints = 0;
	private usedSegments = 0;
	private usedSentinels = 0;
	private usedGridX = 0;
	private usedGridY = 0;
	private usedCursors = 0;
	private prevCursors = 0;
	/**
	 * The grid and cursor layers span the whole plot, while the trace is inset by the axis gutters. A position in
	 * trace space therefore has to be rebased before it is written into them, or everything drawn there sits off
	 * by the gutter width.
	 */
	private gridOffsetX = 0;
	private gridOffsetY = 0;
	private gridSpanX = 1;
	private gridSpanY = 1;
	/** Pointer position in screen pixels, or undefined when it is not over the plot. */
	private pointerAbs?: number;
	/** Resolved each render, for drawing only: presses resolve their own position through {@link fractionAt}. */
	private cursorFraction?: number;
	private cursorPinned?: number;
	private prevPoints = 0;
	private prevSegments = 0;
	private prevSentinels = 0;
	private prevGridX = 0;
	private prevGridY = 0;
	// Written back so the window can show them as placeholder text.
	xMin = 0;
	xMax = 1;
	yMin = 0;
	yMax = 1;
	/** Why the plot is empty, read back by the window. Empty string whenever something was actually drawn. */
	status = "";
	/** Whether a real range has ever been established, deciding what an empty plot falls back to. */
	private hasDrawn = false;

	constructor(
		private readonly layer: GuiObject,
		private readonly pointTemplate: () => Frame,
		private readonly segmentTemplate: () => Frame,
		private readonly sentinelTemplate: () => Frame,
		private readonly grid: GraphGrid,
	) {
		super();

		this.onDestroy(() => {
			for (const p of this.pool.points) p.Destroy();
			for (const s of this.pool.segments) s.Destroy();
			for (const s of this.pool.sentinels) s.Destroy();
			for (const g of this.pool.gridX) g.Destroy();
			for (const g of this.pool.gridY) g.Destroy();
			for (const c of this.pool.cursors) c.Destroy();
		});
	}

	/** Screen-space pointer position, or undefined once it leaves the plot. Read on the next redraw. */
	setPointer(absoluteX: number | undefined) {
		this.pointerAbs = absoluteX;
	}

	/**
	 * Where a screen X falls across the trace (0..1), or undefined when it is outside it.
	 *
	 * Measured from the live instance rather than from the last redraw's hover state, so a tap resolves on its own.
	 * Touch has no hover to leave that state behind, and a mouse should not depend on one having happened either.
	 */
	fractionAt(absoluteX: number): number | undefined {
		const [uiScale] = ancestry(this.layer);
		const inverseScale = 1 / math.max(uiScale, 0.001);
		const px = (absoluteX - this.layer.AbsolutePosition.X) * inverseScale;
		const width = this.layer.AbsoluteSize.X * inverseScale - INSET * 2;
		if (width <= 0 || px < INSET || px > INSET + width) return undefined;

		return (px - INSET) / width;
	}

	/** Index of a pinned cursor within snapping distance of `fraction`, which is the one a press would remove. */
	pinnedNear(group: GraphGroup, fraction: number): number | undefined {
		const [uiScale] = ancestry(this.layer);
		const width = this.layer.AbsoluteSize.X / math.max(uiScale, 0.001) - INSET * 2;

		for (let i = 0; i < group.cursors.size(); i++) {
			if (math.abs((group.cursors[i] - fraction) * width) <= CURSOR_SNAP) return i;
		}
	}

	private takeCursor(): CursorLine {
		const existing = this.pool.cursors[this.usedCursors];
		if (existing) {
			this.usedCursors++;
			return existing;
		}

		const cursor = this.grid.cursorTemplate();
		cursor.Visible = false;
		cursor.Parent = this.grid.x;
		this.pool.cursors.push(cursor);
		this.usedCursors++;
		return cursor;
	}

	/** Logical index of the sample nearest `time`, or undefined when the visible range holds none. */
	private static nearestIndex(output: RecordedOutput, first: number, time: number): number | undefined {
		if (output.count <= first) return undefined;

		let lo = first;
		let hi = output.count - 1;
		while (lo < hi) {
			const mid = math.floor((lo + hi) / 2);
			if (output.times[GraphData.slotOf(output, mid)] < time) lo = mid + 1;
			else hi = mid;
		}

		// `lo` is the first sample at or after `time`; the one before it may be nearer.
		const prev = lo > first ? lo - 1 : lo;
		const a = math.abs(output.times[GraphData.slotOf(output, prev)] - time);
		const b = math.abs(output.times[GraphData.slotOf(output, lo)] - time);
		return a <= b ? prev : lo;
	}

	/**
	 * Pinned cursors plus the one under the pointer. Time only: against an output X the mapping is not monotonic,
	 * so a pixel column names no single sample.
	 *
	 * The pointer snaps onto a pinned cursor when it comes within {@link CURSOR_SNAP}, which is both what makes a
	 * pin hoverable and how the window knows which one a click should remove. A snapped pointer draws nothing of
	 * its own — the pin is already there.
	 */
	private drawCursors(
		group: GraphGroup,
		xSource: RecordedOutput | undefined,
		cutoff: number,
		xLo: number,
		xScale: number,
		yLo: number,
		yScale: number,
		width: number,
		height: number,
		plotX: number,
		plotY: number,
		inverseScale: number,
	) {
		this.cursorFraction = undefined;
		this.cursorPinned = undefined;
		if (xSource) return;

		// The readout can only name one value, so it follows the first drawn series' first channel.
		let series: RecordedOutput | undefined;
		for (const id of group.y) {
			series = GraphSeriesRenderer.outputById(group, id);
			if (series) break;
		}

		const place = (px: number) => {
			const cursor = this.takeCursor();
			cursor.Position = new UDim2((px + this.gridOffsetX) / this.gridSpanX, 0, 0, 0);

			// Derived from where the cursor sits rather than stored with it: a pin holds its column, so whatever
			// the trace has scrolled underneath it is what gets measured.
			const at = xLo + (px - INSET) / xScale;
			const intercept = cursor.Intercept;
			const first = series ? GraphSeriesRenderer.firstVisible(series, cutoff) : 0;
			const index = series ? GraphSeriesRenderer.nearestIndex(series, first, at) : undefined;
			if (!series || index === undefined) {
				intercept.Visible = false;
				return;
			}

			const slot = GraphData.slotOf(series, index);
			if (series.gaps[slot]) {
				intercept.Visible = false;
				return;
			}

			// The sample's own time rather than the cursor's, so both halves of the pair name the same point.
			const x = series.times[slot];
			const y = series.c0[slot];
			intercept.Visible = true;
			// Rebased like the cursor: the label rides inside a frame that spans the full plot, not the trace area.
			const py = INSET + height - (y - yLo) * yScale;
			intercept.Position = new UDim2(0.5, 0, (py + this.gridOffsetY) / this.gridSpanY, 0);
			intercept.Text = `(${Strings.prettyNumber(x, (this.xMax - this.xMin) / 100)}, ${Strings.prettyNumber(y, (this.yMax - this.yMin) / 100)})`;
		};

		for (const fraction of group.cursors) {
			place(INSET + fraction * width);
		}

		const abs = this.pointerAbs;
		if (abs === undefined) return;

		const px = (abs - this.layer.AbsolutePosition.X) * inverseScale;
		if (px < INSET || px > INSET + width) return;

		for (let i = 0; i < group.cursors.size(); i++) {
			if (math.abs(INSET + group.cursors[i] * width - px) > CURSOR_SNAP) continue;

			this.cursorPinned = i;
			this.cursorFraction = group.cursors[i];
			return;
		}

		this.cursorFraction = (px - INSET) / width;
		place(px);
	}

	private takeGridX(): GridLine {
		const existing = this.pool.gridX[this.usedGridX];
		if (existing) {
			this.usedGridX++;
			return existing;
		}

		const line = this.grid.xTemplate();
		line.Visible = false;
		line.Parent = this.grid.x;
		this.pool.gridX.push(line);
		this.usedGridX++;
		return line;
	}

	private takeGridY(): GridLine {
		const existing = this.pool.gridY[this.usedGridY];
		if (existing) {
			this.usedGridY++;
			return existing;
		}

		const line = this.grid.yTemplate();
		line.Visible = false;
		line.Parent = this.grid.y;
		this.pool.gridY.push(line);
		this.usedGridY++;
		return line;
	}

	/**
	 * Grid at round values rather than even divisions, so every line lands on a number worth reading. A label is
	 * dropped when its neighbour is too close, or when it would sit under a corner bound box, which owns that edge.
	 *
	 * Both templates anchor against the edge their label hangs off, so only the axis being stepped is positioned.
	 */
	private drawGrid(
		xLo: number,
		xHi: number,
		yLo: number,
		yHi: number,
		width: number,
		height: number,
		plotX: number,
		plotY: number,
	) {
		const xStep = niceStep(xHi - xLo, GRID_TARGET);
		const xScale = width / (xHi - xLo);
		const xLabels = xStep * xScale >= GRID_LABEL_GAP_X;
		for (let i = math.ceil(xLo / xStep); i <= math.floor(xHi / xStep); i++) {
			const value = i * xStep;
			const px = INSET + (value - xLo) * xScale;

			const line = this.takeGridX();
			line.Position = new UDim2((px + this.gridOffsetX) / this.gridSpanX, 0, 0, 0);
			line.Label.Text = Strings.prettyNumber(value, xStep);
			line.Label.Visible = xLabels && px > GRID_EDGE_X && px < plotX - GRID_EDGE_X;
		}

		const yStep = niceStep(yHi - yLo, GRID_TARGET);
		const yScale = height / (yHi - yLo);
		const yLabels = yStep * yScale >= GRID_LABEL_GAP_Y;
		for (let i = math.ceil(yLo / yStep); i <= math.floor(yHi / yStep); i++) {
			const value = i * yStep;
			const py = INSET + height - (value - yLo) * yScale;

			const line = this.takeGridY();
			line.Position = new UDim2(1, 0, (py + this.gridOffsetY) / this.gridSpanY, 0);
			line.Label.Text = Strings.prettyNumber(value, yStep);
			line.Label.Visible = yLabels && py > GRID_EDGE_Y && py < plotY - GRID_EDGE_Y;
		}
	}

	private takeSentinel(): Frame {
		const existing = this.pool.sentinels[this.usedSentinels];
		if (existing) {
			this.usedSentinels++;
			return existing;
		}

		const sentinel = this.sentinelTemplate();
		sentinel.Visible = false;
		sentinel.Parent = this.layer;
		this.pool.sentinels.push(sentinel);
		this.usedSentinels++;
		return sentinel;
	}

	/**
	 * One band across a burned span. The template anchors at (0, 0.5) and is full height, so only the horizontal
	 * placement is written — the vertical never moves.
	 */
	private drawSentinelBand(from: number, to: number, xLo: number, xScale: number, plotX: number) {
		const lo = math.max(INSET + (from - xLo) * xScale, 0);
		const hi = math.min(INSET + (to - xLo) * xScale, plotX);
		if (hi <= 0 || lo >= plotX) return;

		const sentinel = this.takeSentinel();
		sentinel.Position = UDim2.fromScale(lo / plotX, 0.5);
		sentinel.Size = new UDim2(0, math.max(hi - lo, SENTINEL_MIN_WIDTH), 1, 0);
	}

	private takePoint(): Frame {
		const existing = this.pool.points[this.usedPoints];
		if (existing) {
			this.usedPoints++;
			return existing;
		}

		const point = this.pointTemplate();
		point.Size = UDim2.fromOffset(POINT_SIZE, POINT_SIZE);
		point.AnchorPoint = new Vector2(0.5, 0.5);
		point.Visible = false;
		point.Parent = this.layer;
		this.pool.points.push(point);
		this.usedPoints++;
		return point;
	}

	private takeSegment(): Frame {
		const existing = this.pool.segments[this.usedSegments];
		if (existing) {
			this.usedSegments++;
			return existing;
		}

		const segment = this.segmentTemplate();
		// Rotation pivots about the centre and AnchorPoint cannot change that, so a segment is centred on the
		// midpoint of the pair it joins rather than pinned to the earlier point.
		segment.AnchorPoint = new Vector2(0.5, 0.5);
		segment.Visible = false;
		segment.Parent = this.layer;
		this.pool.segments.push(segment);
		this.usedSegments++;
		return segment;
	}

	/** First sample inside the rolling window. Times are chronological in the ring, so this is a prefix skip. */
	private static firstVisible(output: RecordedOutput, cutoff: number): number {
		if (cutoff === -math.huge) return 0;

		for (let i = 0; i < output.count; i++) {
			if (output.times[GraphData.slotOf(output, i)] >= cutoff) return i;
		}

		return output.count;
	}

	/**
	 * Channels drawn for one pairing. Every value is stored widened to three channels, so a scalar paired against a
	 * vector broadcasts for free and the count is simply the wider of the two.
	 */
	static channelsOf(output: RecordedOutput, xSource: RecordedOutput | undefined): number {
		return xSource ? math.max(output.arity, xSource.arity) : output.arity;
	}

	/** Whether any sample in the visible range carries a value rather than a hole. */
	private static hasValues(output: RecordedOutput, first: number): boolean {
		for (let i = first; i < output.count; i++) {
			if (!output.gaps[GraphData.slotOf(output, i)]) return true;
		}

		return false;
	}

	/**
	 * Why nothing could be drawn. A blank plot otherwise reads the same whether nothing is bound, the block is
	 * burned, or the two axes never overlap in time.
	 */
	private static statusFor(group: GraphGroup, xSource: RecordedOutput | undefined, cutoff: number): string {
		if (group.y.isEmpty()) return "No series bound";

		let samples = 0;
		for (const id of group.y) {
			const output = GraphSeriesRenderer.outputById(group, id);
			if (output) samples += output.count;
		}
		if (samples === 0) return "No data recorded";

		if (!xSource) return "No values in range";

		const first = GraphSeriesRenderer.firstVisible(xSource, cutoff);
		return GraphSeriesRenderer.hasValues(xSource, first) ? "No overlapping samples" : "X source has no values";
	}

	/** Plain loop rather than find(): a predicate closure would allocate per series per redraw. */
	private static outputById(group: GraphGroup, id: string): RecordedOutput | undefined {
		for (const output of group.outputs) {
			if (output.id === id) return output;
		}
	}

	/**
	 * Physical slot in `source` recorded on the same tick as `time`, or undefined when it holds no sample there.
	 *
	 * Pairing two outputs by logical index is wrong: one bound mid-ride, or one whose block was absent for a tick,
	 * carries fewer samples than its neighbours and the indices no longer name the same moment. Every output in a
	 * group is stamped with the same `elapsed` double in one pass, so comparing exactly is sound rather than
	 * fragile, and the search is binary because the buffers can differ in both length and start.
	 */
	private static slotAtTime(source: RecordedOutput, time: number): number | undefined {
		let lo = 0;
		let hi = source.count - 1;

		while (lo <= hi) {
			const mid = math.floor((lo + hi) / 2);
			const slot = GraphData.slotOf(source, mid);
			const at = source.times[slot];
			if (at === time) return slot;

			if (at < time) lo = mid + 1;
			else hi = mid - 1;
		}
	}

	/**
	 * Liang-Barsky: the portion of A->B lying inside the plot, as parametric bounds along the segment. Returns
	 * `t0 > t1` when the segment misses entirely, which avoids an optional tuple on a per-segment hot path.
	 *
	 * Needed because a pinned bound legitimately puts data off-scale, and rotation defeats ClipsDescendants — so
	 * a segment running off the plot has to be shortened to the edge rather than left to draw over the window.
	 * Edges are unrolled rather than looped over an array, which would allocate on every segment every redraw.
	 */
	private static clip(
		x: number,
		y: number,
		dx: number,
		dy: number,
		w: number,
		h: number,
	): LuaTuple<[number, number]> {
		let t0 = 0;
		let t1 = 1;

		// left
		if (dx === 0) {
			if (x < 0) return $tuple(1, 0);
		} else {
			const r = x / -dx;
			if (-dx < 0) {
				if (r > t1) return $tuple(1, 0);
				if (r > t0) t0 = r;
			} else {
				if (r < t0) return $tuple(1, 0);
				if (r < t1) t1 = r;
			}
		}

		// right
		if (dx === 0) {
			if (w - x < 0) return $tuple(1, 0);
		} else {
			const r = (w - x) / dx;
			if (dx < 0) {
				if (r > t1) return $tuple(1, 0);
				if (r > t0) t0 = r;
			} else {
				if (r < t0) return $tuple(1, 0);
				if (r < t1) t1 = r;
			}
		}

		// top
		if (dy === 0) {
			if (y < 0) return $tuple(1, 0);
		} else {
			const r = y / -dy;
			if (-dy < 0) {
				if (r > t1) return $tuple(1, 0);
				if (r > t0) t0 = r;
			} else {
				if (r < t0) return $tuple(1, 0);
				if (r < t1) t1 = r;
			}
		}

		// bottom
		if (dy === 0) {
			if (h - y < 0) return $tuple(1, 0);
		} else {
			const r = (h - y) / dy;
			if (dy < 0) {
				if (r > t1) return $tuple(1, 0);
				if (r > t0) t0 = r;
			} else {
				if (r < t0) return $tuple(1, 0);
				if (r < t1) t1 = r;
			}
		}

		return $tuple(t0, t1);
	}

	/**
	 * Resolve a range that cannot be drawn as it stands. A pinned bound is an instruction, so it is never adjusted:
	 * where a pin crosses the automatic bound, that side yields instead. A range still flat after all that opens
	 * into a band so a level trace draws down the middle rather than dividing by zero.
	 *
	 * Two pins that invert never reach here — that is a typo, and the caller reports it instead of drawing.
	 */
	private static spread(lo: number, hi: number, pinnedLo: boolean, pinnedHi: boolean): LuaTuple<[number, number]> {
		if (hi - lo > 1e-6) return $tuple(lo, hi);

		if (pinnedLo && !pinnedHi) return $tuple(lo, lo + DEGENERATE_SPAN);
		if (pinnedHi && !pinnedLo) return $tuple(hi - DEGENERATE_SPAN, hi);

		const low = math.min(lo, hi);
		const high = math.max(lo, hi);
		if (high - low > 1e-6) return $tuple(low, high);

		const mid = (low + high) / 2;
		return $tuple(mid - DEGENERATE_SPAN / 2, mid + DEGENERATE_SPAN / 2);
	}

	private static applyBounds(axis: GraphAxisConfig, min: number, max: number): LuaTuple<[number, number]> {
		if (axis.mode === "expanding") {
			min = math.min(min, axis.autoMin);
			max = math.max(max, axis.autoMax);
		}

		axis.autoMin = min;
		axis.autoMax = max;

		return GraphSeriesRenderer.spread(
			axis.min ?? min,
			axis.max ?? max,
			axis.min !== undefined,
			axis.max !== undefined,
		);
	}

	render(group: GraphGroup) {
		this.usedPoints = 0;
		this.usedSegments = 0;
		this.usedSentinels = 0;
		this.usedGridX = 0;
		this.usedGridY = 0;
		this.usedCursors = 0;

		// AbsoluteSize is screen pixels, with every ancestor UIScale already applied, while the offsets written to
		// Position and Size are local units that the same scale multiplies again. Mapping into screen pixels would
		// draw the trace larger than the plot by exactly that factor and push the low end out through the floor.
		const size = this.layer.AbsoluteSize;
		const [uiScale] = ancestry(this.layer);
		const inverseScale = 1 / math.max(uiScale, 0.001);
		const plotX = size.X * inverseScale;
		const plotY = size.Y * inverseScale;
		const width = plotX - INSET * 2;
		const height = plotY - INSET * 2;

		const gridPos = this.grid.x.AbsolutePosition;
		const gridSize = this.grid.x.AbsoluteSize;
		this.gridOffsetX = (this.layer.AbsolutePosition.X - gridPos.X) * inverseScale;
		this.gridOffsetY = (this.layer.AbsolutePosition.Y - gridPos.Y) * inverseScale;
		this.gridSpanX = math.max(gridSize.X * inverseScale, 1);
		this.gridSpanY = math.max(gridSize.Y * inverseScale, 1);
		if (width <= 0 || height <= 0) return this.hideUnused();

		const xSource = group.x.kind === "output" ? GraphSeriesRenderer.outputById(group, group.x.outputId) : undefined;
		if (group.x.kind === "output" && !xSource) {
			this.status = "X source unbound";
			return this.hideUnused();
		}

		// A range pinned backwards is a typo, not a request to read it backwards: say so rather than quietly
		// drawing something the numbers in the boxes disagree with.
		const inverted = isInverted(group.xAxis)
			? "X bounds inverted"
			: isInverted(group.yAxis)
				? "Y bounds inverted"
				: undefined;
		if (inverted !== undefined) {
			this.status = inverted;
			return this.hideUnused();
		}

		// The rolling window scopes both axes, not just X: fitting Y to the visible slice is the point of narrowing it.
		const cutoff = group.window !== undefined ? group.elapsed - group.window : -math.huge;

		// Pass one: the extents of everything about to be drawn, so both axes are known before mapping.
		let dataXMin = math.huge;
		let dataXMax = -math.huge;
		let dataYMin = math.huge;
		let dataYMax = -math.huge;
		let any = false;

		for (const id of group.y) {
			const output = GraphSeriesRenderer.outputById(group, id);
			if (!output) continue;

			const first = GraphSeriesRenderer.firstVisible(output, cutoff);
			const channels = GraphSeriesRenderer.channelsOf(output, xSource);
			for (let channel = 0; channel < channels; channel++) {
				const ys = GraphData.channel(output, channel as 0 | 1 | 2);
				for (let i = first; i < output.count; i++) {
					const slot = GraphData.slotOf(output, i);
					if (output.gaps[slot]) continue;

					let x: number | undefined;
					if (xSource) {
						const xslot = GraphSeriesRenderer.slotAtTime(xSource, output.times[slot]);
						if (xslot === undefined || xSource.gaps[xslot]) continue;

						x = GraphData.channel(xSource, channel as 0 | 1 | 2)[xslot];
					} else {
						x = output.times[slot];
					}

					const y = ys[slot] as number | undefined;
					// A hole in the ring reads back as nil, which the self-comparison cannot catch: nil ~= nil is false.
					if (x === undefined || y === undefined) continue;
					if (x !== x || y !== y) continue; //nan check

					dataXMin = math.min(dataXMin, x);
					dataXMax = math.max(dataXMax, x);
					dataYMin = math.min(dataYMin, y);
					dataYMax = math.max(dataYMax, y);
					any = true;
				}
			}
		}

		if (any) {
			this.hasDrawn = true;
			this.status = "";
		} else {
			this.status = GraphSeriesRenderer.statusFor(group, xSource, cutoff);

			// A fully burned series has no extent of its own but still has to place its band somewhere: reuse the
			// range last drawn with, or open a default window when nothing has ever been drawn.
			dataXMin = this.hasDrawn ? this.xMin : -FALLBACK_BOUND;
			dataXMax = this.hasDrawn ? this.xMax : FALLBACK_BOUND;
			dataYMin = this.hasDrawn ? this.yMin : -FALLBACK_BOUND;
			dataYMax = this.hasDrawn ? this.yMax : FALLBACK_BOUND;
		}

		const [xLo, xHi] = GraphSeriesRenderer.applyBounds(group.xAxis, dataXMin, dataXMax);
		const [yLo, yHi] = GraphSeriesRenderer.applyBounds(group.yAxis, dataYMin, dataYMax);
		this.xMin = xLo;
		this.xMax = xHi;
		this.yMin = yLo;
		this.yMax = yHi;

		// A range reaching back past what the ring still holds leaves a blank stretch that looks identical to
		// missing data. Only once the ring has wrapped: before that its first sample is the start of the run.
		if (!xSource && this.status === "") {
			let oldest = math.huge;
			for (const id of group.y) {
				const output = GraphSeriesRenderer.outputById(group, id);
				if (!output || output.count === 0 || !GraphData.isFull(output)) continue;

				oldest = math.min(oldest, output.times[GraphData.slotOf(output, 0)]);
			}

			if (oldest !== math.huge && xLo < oldest) {
				this.status = `History starts at ${Strings.prettyNumber(oldest, 0.1)}s`;
			}
		}

		const xScale = width / (xHi - xLo);
		const yScale = height / (yHi - yLo);

		// Ahead of the trace so the grid sits behind it, and drawn even with no data — an empty plot still reads
		// as a scale rather than a blank box.
		if (group.grid) this.drawGrid(xLo, xHi, yLo, yHi, width, height, plotX, plotY);
		this.drawCursors(group, xSource, cutoff, xLo, xScale, yLo, yScale, width, height, plotX, plotY, inverseScale);

		// Pass two: draw. Never more points than horizontal pixels — a full buffer would otherwise stack several
		// samples on the same column for no visible gain. The budget is screen pixels rather than local units,
		// since that is the resolution the trace is actually resolved at.
		for (const id of group.y) {
			const output = GraphSeriesRenderer.outputById(group, id);
			if (!output || output.count === 0) continue;

			const first = GraphSeriesRenderer.firstVisible(output, cutoff);

			// Burned spans belong to the output, not to a channel, and every sample is walked rather than stepped
			// so a band's edges land on the real transition. Time only: against an output X there is no coordinate
			// to place the band at, since the source producing the X is itself producing nothing.
			if (!xSource) {
				let runStart: number | undefined;
				for (let i = first; i < output.count; i++) {
					const slot = GraphData.slotOf(output, i);
					if (output.garbage[slot]) {
						runStart ??= output.times[slot];
						continue;
					}

					if (runStart !== undefined) {
						this.drawSentinelBand(runStart, output.times[slot], xLo, xScale, plotX);
						runStart = undefined;
					}
				}

				if (runStart !== undefined) {
					const last = GraphData.slotOf(output, output.count - 1);
					this.drawSentinelBand(runStart, output.times[last], xLo, xScale, plotX);
				}
			}

			const step = math.max(1, math.ceil((output.count - first) / math.max(1, size.X)));

			const channels = GraphSeriesRenderer.channelsOf(output, xSource);
			for (let channel = 0; channel < channels; channel++) {
				const color = output.colors[channel] ?? CHANNEL_COLORS[channel];
				const ys = GraphData.channel(output, channel as 0 | 1 | 2);

				let prevX: number | undefined;
				let prevY: number | undefined;

				for (let i = first; i < output.count; i += step) {
					const slot = GraphData.slotOf(output, i);
					const value = ys[slot] as number | undefined;

					let at: number | undefined;
					if (!output.gaps[slot]) {
						if (xSource) {
							const xslot = GraphSeriesRenderer.slotAtTime(xSource, output.times[slot]);
							if (xslot !== undefined && !xSource.gaps[xslot]) {
								at = GraphData.channel(xSource, channel as 0 | 1 | 2)[xslot];
							}
						} else {
							at = output.times[slot];
						}
					}

					if (at === undefined || value === undefined || at !== at || value !== value) {
						// Break the line rather than bridging missing data.
						prevX = undefined;
						prevY = undefined;
						continue;
					}

					const px = INSET + (at - xLo) * xScale;
					const py = INSET + height - (value - yLo) * yScale;

					// A point outside the plot is simply not drawn; rotation defeats ClipsDescendants so nothing
					// can be left for the Plot to contain. Only reachable with a pinned bound.
					if (px >= 0 && px <= plotX && py >= 0 && py <= plotY) {
						const point = this.takePoint();
						// Scale rather than offset: an offset may quantize to whole units, which would shift a
						// segment sideways from the two dots it joins.
						point.Position = UDim2.fromScale(px / plotX, py / plotY);
						point.BackgroundColor3 = color;
					}

					if (group.lines && prevX !== undefined && prevY !== undefined) {
						const dx = px - prevX;
						const dy = py - prevY;
						// Shortened to the edge rather than skipped, so a trace running off-scale reads as
						// leaving the plot instead of as missing data.
						const [t0, t1] = GraphSeriesRenderer.clip(prevX, prevY, dx, dy, plotX, plotY);
						if (t0 <= t1) {
							const ax = prevX + dx * t0;
							const ay = prevY + dy * t0;
							const bx = prevX + dx * t1;
							const by = prevY + dy * t1;
							const cx = bx - ax;
							const cy = by - ay;

							const segment = this.takeSegment();
							segment.Position = UDim2.fromScale((ax + bx) / 2 / plotX, (ay + by) / 2 / plotY);
							segment.Size = UDim2.fromOffset(math.sqrt(cx * cx + cy * cy), SEGMENT_THICKNESS);
							segment.Rotation = math.deg(math.atan2(cy, cx));
							segment.BackgroundColor3 = color;
						}
					}

					// Raw rather than clipped, so a trace that leaves the plot and returns is clipped correctly
					// on the way back in.
					prevX = px;
					prevY = py;
				}
			}
		}

		this.hideUnused();
	}

	/**
	 * Reconcile which pool entries are on screen. Used entries always form a prefix, so only the difference from
	 * last frame is written — an Instance property write crosses into the engine and is worth avoiding.
	 */
	private hideUnused() {
		for (let i = this.prevPoints; i < this.usedPoints; i++) this.pool.points[i].Visible = true;
		for (let i = this.usedPoints; i < this.prevPoints; i++) this.pool.points[i].Visible = false;
		this.prevPoints = this.usedPoints;

		for (let i = this.prevSegments; i < this.usedSegments; i++) this.pool.segments[i].Visible = true;
		for (let i = this.usedSegments; i < this.prevSegments; i++) this.pool.segments[i].Visible = false;
		this.prevSegments = this.usedSegments;

		for (let i = this.prevSentinels; i < this.usedSentinels; i++) this.pool.sentinels[i].Visible = true;
		for (let i = this.usedSentinels; i < this.prevSentinels; i++) this.pool.sentinels[i].Visible = false;
		this.prevSentinels = this.usedSentinels;

		for (let i = this.prevGridX; i < this.usedGridX; i++) this.pool.gridX[i].Visible = true;
		for (let i = this.usedGridX; i < this.prevGridX; i++) this.pool.gridX[i].Visible = false;
		this.prevGridX = this.usedGridX;

		for (let i = this.prevGridY; i < this.usedGridY; i++) this.pool.gridY[i].Visible = true;
		for (let i = this.usedGridY; i < this.prevGridY; i++) this.pool.gridY[i].Visible = false;
		this.prevGridY = this.usedGridY;

		for (let i = this.prevCursors; i < this.usedCursors; i++) this.pool.cursors[i].Visible = true;
		for (let i = this.usedCursors; i < this.prevCursors; i++) this.pool.cursors[i].Visible = false;
		this.prevCursors = this.usedCursors;
	}
}
