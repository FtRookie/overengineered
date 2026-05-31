import { RunService } from "@rbxts/services";

type Target = {
	readonly part: BasePart;
	/** Seconds after the pulse starts before this part lights up. */
	readonly delay: number;
	/** Original look, restored once the pulse passes. */
	readonly color: Color3;
	readonly transparency: number;
	/** Last applied intensity — lets us skip writes for parts already at rest. */
	lastIntensity: number;
};

type Wave = {
	readonly startTime: number;
	readonly endTime: number;
	readonly targets: Target[];
	readonly color: Color3;
	readonly duration: number;
	readonly peakTransparency: number;
};

/** A part to light up and when (relative to the pulse start). */
export interface PulseEntry {
	readonly part: BasePart;
	readonly delay: number;
}

export interface PulseOptions {
	readonly color?: Color3;
	/** How long one part stays lit as the front passes it. */
	readonly duration?: number;
	/** Transparency at the peak of the pulse (parts at 1 are invisible at rest). */
	readonly peakTransparency?: number;
}

export interface WaveOptions extends PulseOptions {
	/** How fast the front travels outward (studs/sec). */
	readonly speed?: number;
	/** Parts further than this from the origin are skipped. */
	readonly maxRadius?: number;
	/** Hard cap on animated parts (closest kept) to bound a dense set. */
	readonly maxBlocks?: number;
}

const DEFAULTS = {
	color: Color3.fromRGB(95, 205, 255),
	duration: 0.4,
	peakTransparency: 0.3,
	speed: 70,
	maxRadius: 64,
	maxBlocks: 400,
};

/**
 * Reusable "ripple through a structure" animation: recolours each part's surface and fades it in
 * as a wave front sweeps through, then restores it. Drives all of it from a single lazily-connected
 * Heartbeat and skips parts that are currently at rest.
 *
 * {@link pulse} takes explicit per-part delays (e.g. a graph/BFS ripple); {@link wave} derives them
 * from distance to an origin. Purely visual and client-only (Color/Transparency don't replicate); a
 * new call supersedes any pulse still in flight.
 */
export namespace BlockPulse {
	let current: Wave | undefined;
	let connection: RBXScriptConnection | undefined;

	/** Light up each entry's part after its `delay`. */
	export function pulse(entries: readonly PulseEntry[], options?: PulseOptions): void {
		const color = options?.color ?? DEFAULTS.color;
		const duration = options?.duration ?? DEFAULTS.duration;
		const peakTransparency = options?.peakTransparency ?? DEFAULTS.peakTransparency;

		// A new pulse supersedes the old one — restore the old parts before re-capturing originals.
		clearCurrent();
		if (entries.isEmpty()) return;

		const targets: Target[] = [];
		let maxDelay = 0;
		for (const e of entries) {
			targets.push({
				part: e.part,
				delay: e.delay,
				color: e.part.Color,
				transparency: e.part.Transparency,
				lastIntensity: 0,
			});
			if (e.delay > maxDelay) maxDelay = e.delay;
		}

		const now = time();
		current = { startTime: now, endTime: now + maxDelay + duration, targets, color, duration, peakTransparency };

		if (!connection) connection = RunService.Heartbeat.Connect(step);
	}

	/** Ripple a coloured pulse outward from `origin` across `parts`, delays derived from distance. */
	export function wave(parts: readonly BasePart[], origin: Vector3, options?: WaveOptions): void {
		const speed = options?.speed ?? DEFAULTS.speed;
		const maxRadius = options?.maxRadius ?? DEFAULTS.maxRadius;
		const maxBlocks = options?.maxBlocks ?? DEFAULTS.maxBlocks;

		const entries: PulseEntry[] = [];
		for (const part of parts) {
			const distance = part.Position.sub(origin).Magnitude;
			if (distance > maxRadius) continue;
			entries.push({ part, delay: distance / speed });
		}

		// Keep the closest parts if the set blew past the cap.
		if (entries.size() > maxBlocks) {
			entries.sort((a, b) => a.delay < b.delay);
			while (entries.size() > maxBlocks) entries.pop();
		}

		pulse(entries, options);
	}

	/** Cancel any in-flight pulse and restore affected parts immediately. */
	export function cancel(): void {
		clearCurrent();
		stopDriver();
	}

	function step() {
		const wave = current;
		if (!wave) {
			stopDriver();
			return;
		}

		const now = time();
		for (const t of wave.targets) {
			const elapsed = now - wave.startTime - t.delay;
			// Smooth 0 → 1 → 0 over the pulse window; flat 0 outside it.
			const intensity =
				elapsed >= 0 && elapsed <= wave.duration ? math.sin((elapsed / wave.duration) * math.pi) : 0;

			// Skip parts that were already at rest and still are — no redundant writes.
			if (intensity === 0 && t.lastIntensity === 0) continue;

			t.part.Color = t.color.Lerp(wave.color, intensity);
			t.part.Transparency = t.transparency + (wave.peakTransparency - t.transparency) * intensity;
			t.lastIntensity = intensity;
		}

		if (now >= wave.endTime) {
			clearCurrent();
			stopDriver();
		}
	}

	function clearCurrent() {
		if (!current) return;
		for (const t of current.targets) {
			t.part.Color = t.color;
			t.part.Transparency = t.transparency;
		}
		current = undefined;
	}

	function stopDriver() {
		if (!connection) return;
		connection.Disconnect();
		connection = undefined;
	}
}
