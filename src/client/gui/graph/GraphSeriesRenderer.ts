import { GraphData } from "client/gui/graph/GraphSessionStore";
import { ancestry } from "engine/client/gui/WindowGeometry";
import { Component } from "engine/shared/component/Component";
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

type Pooled = { readonly points: Frame[]; readonly segments: Frame[]; readonly sentinels: Frame[] };

/**
 * Draws a group's samples as pooled Frames: one dot per plotted sample, plus an optional rotated bar between
 * consecutive dots.
 *
 * Both pools are allocated once and reused. Nothing is created or destroyed per redraw, and the sample count is
 * capped at the plot's pixel width, so a full buffer costs the same as a nearly empty one.
 */
export class GraphSeriesRenderer extends Component {
	private readonly pool: Pooled = { points: [], segments: [], sentinels: [] };
	private usedPoints = 0;
	private usedSegments = 0;
	private usedSentinels = 0;
	private prevPoints = 0;
	private prevSegments = 0;
	private prevSentinels = 0;
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
	) {
		super();

		this.onDestroy(() => {
			for (const p of this.pool.points) p.Destroy();
			for (const s of this.pool.segments) s.Destroy();
			for (const s of this.pool.sentinels) s.Destroy();
		});
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

		const xScale = width / (xHi - xLo);
		const yScale = height / (yHi - yLo);

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
	}
}
