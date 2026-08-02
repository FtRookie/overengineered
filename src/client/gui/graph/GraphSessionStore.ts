import { ObservableCollectionArr } from "engine/shared/event/ObservableCollection";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { DebugInfo } from "shared/blockLogic/BlockLogic";

/** Samples kept per recorded output. At 60 ticks/s this is a little over two minutes of history. */
export const CAPACITY = 8192;

/** How an unset bound is derived: track the visible window, or only ever grow. */
export type GraphAxisMode = "autofit" | "expanding";
export type GraphAxisConfig = {
	mode: GraphAxisMode;
	/** Typed override. Unset means the bound follows `mode`, and the box shows `autoMin`/`autoMax` as placeholder. */
	min?: number;
	max?: number;
	/** Last derived bounds. Written by the renderer, read back for the placeholder text. */
	autoMin: number;
	autoMax: number;
};

/** Which recorded output an axis reads, or elapsed logic time. */
export type GraphAxisSource = { readonly kind: "time" } | { readonly kind: "output"; readonly outputId: string };

/**
 * One block output being recorded. Every value is widened to three channels at capture — a scalar becomes
 * `(n, n, n)` — so an axis pairing is always channel-wise and needs no per-type branching downstream.
 *
 * Storage is a ring of parallel flat arrays rather than an array of sample objects: a per-sample table would be
 * one Lua allocation per output per tick.
 */
export type RecordedOutput = {
	readonly id: string;
	readonly uuid: BlockUuid;
	readonly outputKey: string;
	/** Display name from the block definition, resolved when the series is bound. */
	name: string;
	unit?: string;
	/** 1 for scalars, 3 for vector3/color. Drives how many channels are actually drawn. */
	arity: 1 | 3;
	/** True once the block backing this output could not be found on the current ride. */
	unbound: boolean;
	/** Per-channel override. A hole means that channel keeps the default hue for its index. */
	readonly colors: (Color3 | undefined)[];

	readonly times: number[];
	readonly c0: number[];
	readonly c1: number[];
	readonly c2: number[];
	/** A sentinel tick — the value was GARBAGE/AVAILABLELATER/disabled. Never drawn, never connected across. */
	readonly gaps: boolean[];
	/** Of those, the ticks that were specifically GARBAGE, which draw a band rather than just breaking the line. */
	readonly garbage: boolean[];

	/** Physical index of the oldest live sample. */
	start: number;
	count: number;
};

export type GraphGroup = {
	readonly id: string;
	name: string;
	readonly outputs: RecordedOutput[];
	x: GraphAxisSource;
	/** Recorded output ids drawn against `x`. */
	readonly y: string[];
	readonly xAxis: GraphAxisConfig;
	readonly yAxis: GraphAxisConfig;
	/**
	 * Rolling scope in seconds: only samples from the last `window` of logic time are drawn, and both axes fit to
	 * that slice. Unset means the whole buffer. Distinct from pinning X — this follows live data, a pinned X does not.
	 */
	window?: number;
	/** Draw connecting segments between consecutive points. */
	lines: boolean;
	/** Draw the reference grid and its step labels. */
	grid: boolean;
	/**
	 * Pinned cursors, each a fraction across the plot rather than a data value: a pin holds its column and
	 * measures whatever the trace has scrolled underneath it, so it stays put as the axis moves.
	 */
	readonly cursors: number[];
	/** Observable so the manager row and the window's own eye stay in step whichever one is clicked. */
	readonly visible: ObservableValue<boolean>;
	/** Monotonic, so each new window cascades instead of landing exactly on the last one. */
	readonly spawnIndex: number;
	/** Elapsed logic time, accumulated from tick dt while recording. */
	elapsed: number;
};

const AUTO_MIN = 0;
const AUTO_MAX = 1;
const defaultAxis = (): GraphAxisConfig => ({ mode: "autofit", autoMin: AUTO_MIN, autoMax: AUTO_MAX });

export namespace GraphData {
	/**
	 * Widen a debug entry to three channels. An arity of 0 means the entry cannot be plotted — a sentinel, or a
	 * type with no numeric form.
	 *
	 * The unplottable case rides in the tuple rather than being `undefined`: a LuaTuple assigned to a variable
	 * packs into a table, which is always truthy, so a `=== undefined` check on it is dead code.
	 */
	export function widen(info: DebugInfo): LuaTuple<[number, number, number, 0 | 1 | 3]> {
		const value = info.value;
		if (value === undefined) return $tuple(0, 0, 0, 0);

		const scalar: 1 | 3 = 1;
		const triple: 1 | 3 = 3;

		switch (info.type) {
			case "number":
			case "byte": {
				const n = value as number;
				return $tuple(n, n, n, scalar);
			}
			case "bool": {
				const n = value === true ? 1 : 0;
				return $tuple(n, n, n, scalar);
			}
			case "vector3": {
				const v = value as Vector3;
				return $tuple(v.X, v.Y, v.Z, triple);
			}
			case "color": {
				const c = value as Color3;
				return $tuple(c.R, c.G, c.B, triple);
			}
		}

		return $tuple(0, 0, 0, 0);
	}

	/**
	 * Channels an output declares, read from its definition so a series has the right shape before it has ever
	 * been sampled. An output declaring both widths cannot be resolved until a value arrives, so it starts at 1
	 * and `push` corrects it.
	 */
	export function arityOf(types: readonly string[]): 1 | 3 {
		let seen: 1 | 3 | undefined;
		for (const t of types) {
			if (t !== "vector3" && t !== "color" && t !== "number" && t !== "byte" && t !== "bool") continue;

			const channels: 1 | 3 = t === "vector3" || t === "color" ? 3 : 1;
			if (seen !== undefined && seen !== channels) return 1;

			seen = channels;
		}

		return seen ?? 1;
	}

	/** Whether an output declaring these types can be plotted at all. */
	export function isGraphable(types: readonly string[]): boolean {
		for (const t of types) {
			if (t === "number" || t === "byte" || t === "bool" || t === "vector3" || t === "color") {
				return true;
			}
		}

		return false;
	}

	export function newOutput(
		id: string,
		uuid: BlockUuid,
		outputKey: string,
		name: string,
		arity: 1 | 3,
	): RecordedOutput {
		return {
			id,
			uuid,
			outputKey,
			name,
			arity,
			unbound: false,
			colors: [],
			times: [],
			c0: [],
			c1: [],
			c2: [],
			gaps: [],
			garbage: [],
			start: 0,
			count: 0,
		};
	}

	/** Physical slot for logical sample `index`, oldest first. */
	export function slotOf(output: RecordedOutput, index: number): number {
		return (output.start + index) % CAPACITY;
	}

	/** True once the ring is full, so anything older than its first sample has already been overwritten. */
	export function isFull(output: RecordedOutput): boolean {
		return output.count >= CAPACITY;
	}

	function nextSlot(output: RecordedOutput): number {
		if (output.count < CAPACITY) {
			const slot = (output.start + output.count) % CAPACITY;
			output.count++;
			return slot;
		}

		// Full: overwrite the oldest and walk the window forward.
		const slot = output.start;
		output.start = (output.start + 1) % CAPACITY;
		return slot;
	}

	export function push(output: RecordedOutput, time: number, x: number, y: number, z: number, arity: 1 | 3) {
		const slot = nextSlot(output);
		output.times[slot] = time;
		output.c0[slot] = x;
		output.c1[slot] = y;
		output.c2[slot] = z;
		output.gaps[slot] = false;
		output.garbage[slot] = false;
		output.arity = arity;
	}

	/**
	 * Record that this tick produced no value, so the renderer breaks the line rather than interpolating over it.
	 * `garbage` separates a burned block, which is drawn as a band, from a value that merely was not ready.
	 */
	export function pushGap(output: RecordedOutput, time: number, garbage: boolean) {
		const slot = nextSlot(output);
		output.times[slot] = time;
		output.c0[slot] = 0;
		output.c1[slot] = 0;
		output.c2[slot] = 0;
		output.gaps[slot] = true;
		output.garbage[slot] = garbage;
	}

	export function clear(output: RecordedOutput) {
		table.clear(output.times);
		table.clear(output.c0);
		table.clear(output.c1);
		table.clear(output.c2);
		table.clear(output.gaps);
		table.clear(output.garbage);
		output.start = 0;
		output.count = 0;
	}

	export function channel(output: RecordedOutput, index: 0 | 1 | 2): number[] {
		return index === 0 ? output.c0 : index === 1 ? output.c1 : output.c2;
	}
}

/**
 * Groups and every sample they have captured, for the session. Deliberately owns no GUI and no machine reference:
 * the sampler writes into these buffers and the machine is destroyed on every ride exit, but the data outlives it
 * so a graph stays readable back in build mode.
 */
export class GraphSessionStore {
	readonly groups = new ObservableCollectionArr<GraphGroup>();
	private nextId = 0;
	private spawned = 0;

	private id(prefix: string): string {
		this.nextId++;
		return `${prefix}${this.nextId}`;
	}

	addGroup(name: string): GraphGroup {
		const group: GraphGroup = {
			id: this.id("g"),
			name,
			outputs: [],
			x: { kind: "time" },
			y: [],
			xAxis: defaultAxis(),
			yAxis: defaultAxis(),
			lines: true,
			grid: true,
			cursors: [],
			visible: new ObservableValue(true),
			spawnIndex: this.spawned++,
			elapsed: 0,
		};

		this.groups.add(group);
		return group;
	}

	removeGroup(group: GraphGroup) {
		this.groups.remove(group);
	}

	getGroup(id: string): GraphGroup | undefined {
		return this.groups.get().find((g) => g.id === id);
	}

	/** Bind an output to a group, reusing the existing recording when the same output is already there. */
	bindOutput(group: GraphGroup, uuid: BlockUuid, outputKey: string, name: string, arity: 1 | 3): RecordedOutput {
		const existing = group.outputs.find((o) => o.uuid === uuid && o.outputKey === outputKey);
		if (existing) return existing;

		const output = GraphData.newOutput(this.id("o"), uuid, outputKey, name, arity);
		group.outputs.push(output);
		return output;
	}

	unbindOutput(group: GraphGroup, output: RecordedOutput) {
		const index = group.outputs.indexOf(output);
		if (index >= 0) group.outputs.remove(index);

		const y = group.y.indexOf(output.id);
		if (y >= 0) group.y.remove(y);

		if (group.x.kind === "output" && group.x.outputId === output.id) {
			group.x = { kind: "time" };
		}
	}

	/**
	 * Re-check every bound output against the world. A deleted block leaves its samples readable — that is the
	 * point of the buffers outliving the machine — but nothing may still point at it as though it were live, and
	 * X in particular has no series row to clear it from.
	 */
	refreshBindings(exists: (uuid: BlockUuid) => boolean) {
		for (const group of this.groups.get()) {
			for (const output of group.outputs) {
				output.unbound = !exists(output.uuid);
			}

			const x = group.x;
			if (x.kind !== "output") continue;

			const bound = group.outputs.find((o) => o.id === x.outputId);
			if (!bound || bound.unbound) group.x = { kind: "time" };
		}
	}

	/**
	 * Drop every sample in a group and restart its clock — one run per ride. An unbound output is left alone: no
	 * ride will ever sample it again, so its buffer is the only remaining copy of what that block did.
	 */
	resetGroup(group: GraphGroup) {
		group.elapsed = 0;
		for (const output of group.outputs) {
			if (output.unbound) continue;

			GraphData.clear(output);
		}
	}

	resetAll() {
		for (const group of this.groups.get()) {
			this.resetGroup(group);
		}
	}

	/**
	 * Put a group back to an empty plot on demand: every buffer, the pins and the clock. Unlike the per-ride reset
	 * an unbound output is dropped rather than spared — with its samples gone the row can never fill again.
	 *
	 * What the player configured stays: the axis modes, their pinned bounds, the window and the series still bound.
	 */
	clearGroup(group: GraphGroup) {
		group.elapsed = 0;
		table.clear(group.cursors);

		for (const output of [...group.outputs]) {
			if (output.unbound) {
				this.unbindOutput(group, output);
				continue;
			}

			GraphData.clear(output);
		}

		// An expanding axis only ever grows, so a range kept from the old data would never fit the new.
		group.xAxis.autoMin = AUTO_MIN;
		group.xAxis.autoMax = AUTO_MAX;
		group.yAxis.autoMin = AUTO_MIN;
		group.yAxis.autoMax = AUTO_MAX;
	}
}
