/**
 * Noise building blocks shared by the chunk generators.
 *
 * Everything here is a pure function of its arguments: the Classic renderer runs each chunk inside its own
 * Actor VM, which `require`s the generator module separately, so nothing may depend on module state.
 */
export namespace TerrainNoise {
	/**
	 * Perlin's lattice is axis-aligned, so stacked octaves line up with it and the terrain reads as a grid
	 * of similar blobs. Turning each octave by an irrational angle decorrelates them and the regularity
	 * disappears. Precomputed — `math.cos` per octave per sample is not free at this call volume.
	 */
	const ROTATIONS = 8;
	const rotCos: number[] = [];
	const rotSin: number[] = [];
	for (let i = 0; i < ROTATIONS; i++) {
		rotCos.push(math.cos(i * 0.6180339887));
		rotSin.push(math.sin(i * 0.6180339887));
	}

	/** `math.noise` takes the seed in its second axis. */
	const at = (x: number, z: number, seed: number) => math.noise(x, seed, z);

	/** Octaves of noise at doubling frequency and halving amplitude. Returns roughly -0.5 .. 0.5. */
	export function fbm(x: number, z: number, seed: number, freq: number, octaves: number, gain: number = 0.5): number {
		let sum = 0;
		let amp = 1;
		let norm = 0;
		let f = freq;

		for (let i = 0; i < octaves; i++) {
			const c = rotCos[i % ROTATIONS];
			const s = rotSin[i % ROTATIONS];
			sum += amp * at((x * c - z * s) * f, (x * s + z * c) * f, seed + i * 17.13);

			norm += amp;
			amp *= gain;
			f *= 2;
		}

		return sum / norm;
	}

	/** `1 - |n|` turns rolling blobs into sharp ridgelines. Returns 0 .. 1. */
	export function ridged(x: number, z: number, seed: number, freq: number, octaves: number): number {
		let sum = 0;
		let amp = 1;
		let norm = 0;
		let f = freq;

		for (let i = 0; i < octaves; i++) {
			const c = rotCos[i % ROTATIONS];
			const s = rotSin[i % ROTATIONS];
			const v = 1 - math.abs(at((x * c - z * s) * f, (x * s + z * c) * f, seed + i * 23.71) * 2);

			sum += amp * v * v;
			norm += amp;
			amp *= 0.5;
			f *= 2;
		}

		return sum / norm;
	}

	/**
	 * Monotone cubic Hermite through the given points.
	 *
	 * Interpolation choice matters more than it looks. Smoothstep per segment forces the derivative to zero
	 * at every control point, which terraces the terrain into visible flat facets; plain linear leaves a
	 * derivative jump that shows up as a contour crease running across hillsides. This is C1 with non-zero
	 * tangents, so neither artifact appears.
	 */
	export function spline(t: number, points: readonly (readonly [number, number])[]): number {
		const size = points.size();
		if (t <= points[0][0]) return points[0][1];
		if (t >= points[size - 1][0]) return points[size - 1][1];

		for (let i = 0; i < size - 1; i++) {
			const [x0, y0] = points[i];
			const [x1, y1] = points[i + 1];
			if (t > x1) continue;

			const h = x1 - x0;
			const d = (y1 - y0) / h;

			// Tangents from the neighbouring slopes, flattened at a local extremum so the curve cannot
			// overshoot and invent a hill the control points never asked for.
			const dPrev = i > 0 ? (y0 - points[i - 1][1]) / (x0 - points[i - 1][0]) : d;
			const dNext = i + 2 < size ? (points[i + 2][1] - y1) / (points[i + 2][0] - x1) : d;
			const m0 = dPrev * d <= 0 ? 0 : (dPrev + d) / 2;
			const m1 = d * dNext <= 0 ? 0 : (d + dNext) / 2;

			const s = (t - x0) / h;
			const s2 = s * s;
			const s3 = s2 * s;

			return (
				(2 * s3 - 3 * s2 + 1) * y0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * y1 + (s3 - s2) * h * m1
			);
		}

		return points[size - 1][1];
	}

	/** Clamp to 0..1 with soft shoulders. A hard clamp creases the terrain wherever the mask saturates. */
	export function smoothClamp01(v: number): number {
		const k = math.clamp(v, 0, 1);
		return k * k * (3 - 2 * k);
	}
}
