import { TerrainNoise } from "client/terrain/TerrainNoise";

/**
 * Biomes as a continuous blend, not a bucket lookup.
 *
 * The Minecraft failure mode is a hard classify: temperature and moisture are quantised into cells, so a
 * hot-dry cell can sit one voxel from a cold-wet one and desert meets taiga along a seam. This avoids it two
 * ways. The climate fields are smooth (low-frequency fbm), so neighbours are nearly equal and the climate
 * never jumps; and biomes live on a Whittaker grid — temperature across, moisture down — so the dry-hot and
 * wet-cold biomes are at OPPOSITE corners. A smooth walk between them is forced through the middle (grassland,
 * forest), which is exactly the gradient a player should see. Nothing is ever classified to a single biome:
 * colour and shape are a bilinear blend of the four surrounding cells, so every border is a ramp.
 *
 * Everything here is a pure function of (x, z) — same contract as TerrainNoise, so the Classic renderer can
 * require it inside its Actor VMs. x and z arrive in VOXELS (one unit is four studs), matching the generator.
 */
export namespace TerrainBiome {
	// Climate is far coarser than terrain: a biome is a region you fly across, not a texture. One wavelength
	// of temperature is on the order of 22k studs — big, but small enough that a flight actually crosses from
	// one climate into another. Warp so the borders meander instead of running as bands.
	const CLIMATE_FREQ = 0.00018;
	const CLIMATE_OCTAVES = 2;
	const CLIMATE_WARP_FREQ = 0.0006;
	const CLIMATE_WARP = 260;
	// fbm is bell-shaped, so raw it barely reaches the corners and desert/tundra are vanishingly rare. Widen
	// the swing before centring on 0.5 so the extreme biomes actually occur; the corners() clamp caps it.
	const CLIMATE_SPREAD = 2.07;
	// Hot air is dry air: aridity pulls moisture down where it's hot (deserts, savanna) and up where it's cold
	// (taiga, snow). Temperature and moisture are independent fields, so without this the hot-AND-dry corner
	// almost never co-occurs and the whole map settles into temperate green. Kept moderate so the wettest hot
	// spots still reach jungle and the driest cold ones still reach tundra.
	const ARIDITY = 0.45;

	// Temperature falls with height, so a peak in any biome drifts toward the cold column and reads as snow
	// without a single special case. In 0..1 climate units per stud of elevation above the waterline.
	const LAPSE_PER_STUD = 0.0016;

	// Elevation/slope overrides that sit on top of whatever the climate picked.
	const BEACH_MAX_HEIGHT = 4; // near the waterline, any biome gets sand
	// Bare rock on steep faces. A gradient (rise over run), NOT a raw height difference: each renderer measures
	// slope over a different horizontal span (the triangle square vs a few voxels), so it divides by that span
	// and this threshold then means the same everywhere. ~0.6 ≈ 31°.
	const ROCK_SLOPE = 0.6;
	const SAND_COLOR = Color3.fromRGB(246, 215, 176);
	const ROCK_COLOR = Color3.fromRGB(74, 74, 78);
	// Desert cliffs are pale limestone rather than the dark rock of temperate mountains. The voxel renderer
	// uses the global terrain colour (dimmed in TerrainController to match); this is the triangle-wedge tint.
	const LIMESTONE_COLOR = Color3.fromRGB(98, 91, 75);

	interface Biome {
		readonly color: Color3;
		readonly material: Enum.Material;
		/** Scales the generator's hills/detail/ridge contribution. <1 flatter, >1 rougher. */
		readonly reliefMul: number;
		/** Amplitude (studs) of dune ridges added on top — desert only, 0 elsewhere. */
		readonly duneStrength: number;
		/** Base-height shift (studs), e.g. a basin sits a little lower. */
		readonly baseBias: number;
	}
	function biome(color: Color3, mat: Enum.Material, reliefMul: number, dune: number, bias: number): Biome {
		return { color, material: mat, reliefMul, duneStrength: dune, baseBias: bias };
	}

	// Whittaker grid, GRID[temperature][moisture], each axis cold/dry -> hot/wet. The corners are the
	// extremes, so a smooth climate path between any two passes through the cells between them. Fields per
	// cell: colour, material, reliefMul, duneStrength, baseBias — every number a starting point to be tuned.
	const GRID: readonly (readonly Biome[])[] = [
		[
			biome(Color3.fromRGB(206, 212, 214), Enum.Material.Snow, 0.6, 0, 0), // cold+dry   tundra
			biome(Color3.fromRGB(228, 234, 238), Enum.Material.Snow, 0.8, 0, 0), // cold+mid   snowfield
			biome(Color3.fromRGB(212, 224, 216), Enum.Material.Snow, 1.0, 0, 0), // cold+wet   taiga
		],
		[
			biome(Color3.fromRGB(156, 162, 96), Enum.Material.Grass, 0.7, 0, 0), // temp+dry   steppe
			biome(Color3.fromRGB(102, 130, 84), Enum.Material.LeafyGrass, 0.9, 0, 0), // temp+mid   plains
			biome(Color3.fromRGB(74, 110, 64), Enum.Material.LeafyGrass, 1.1, 0, 0), // temp+wet   forest
		],
		[
			biome(Color3.fromRGB(222, 196, 150), Enum.Material.Sand, 0.45, 60, -8), // hot+dry    desert
			biome(Color3.fromRGB(184, 168, 104), Enum.Material.Grass, 0.6, 0, 0), // hot+mid    savanna
			biome(Color3.fromRGB(58, 98, 52), Enum.Material.LeafyGrass, 1.05, 0, 4), // hot+wet    jungle
		],
	];

	const AXIS = GRID.size() - 1; // last index on each axis (grid is square)

	function warp(x: number, z: number): LuaTuple<[number, number]> {
		const wf = CLIMATE_WARP_FREQ;
		const wx = x + math.noise(x * wf, 4211.3, z * wf) * CLIMATE_WARP;
		const wz = z + math.noise(x * wf, 9137.7, z * wf) * CLIMATE_WARP;
		return $tuple(wx, wz);
	}

	/** 0 (cold) .. 1 (hot). */
	export function temperature(x: number, z: number): number {
		const [wx, wz] = warp(x, z);
		return TerrainNoise.fbm(wx, wz, 811.3, CLIMATE_FREQ, CLIMATE_OCTAVES) * CLIMATE_SPREAD + 0.5;
	}

	/** 0 (dry) .. 1 (wet). */
	export function moisture(x: number, z: number): number {
		const [wx, wz] = warp(x, z);
		return TerrainNoise.fbm(wx, wz, 2609.1, CLIMATE_FREQ, CLIMATE_OCTAVES) * CLIMATE_SPREAD + 0.5;
	}

	/**
	 * The four grid cells around a (temperature, moisture) point and their bilinear weights. This is the one
	 * place blending happens; both the surface and the shape read it so they always agree on the mix.
	 */
	function corners(
		temp: number,
		moist: number,
	): LuaTuple<[a: Biome, b: Biome, c: Biome, d: Biome, wa: number, wb: number, wc: number, wd: number]> {
		const tf = math.clamp(temp, 0, 1) * AXIS;
		const mf = math.clamp(moist, 0, 1) * AXIS;
		const ti = math.min(math.floor(tf), AXIS - 1);
		const mi = math.min(math.floor(mf), AXIS - 1);
		// Smoothstep the blend fractions. Plain bilinear is only C0: the gradient jumps as the sample crosses
		// a cell boundary, leaving a faint crease down the middle of every transition. Easing to zero slope at
		// each boundary makes it C1, so neighbouring biomes melt together with no seam. Weights still sum to 1.
		const tfr = TerrainNoise.smoothClamp01(tf - ti);
		const mfr = TerrainNoise.smoothClamp01(mf - mi);

		const a = GRID[ti][mi];
		const b = GRID[ti + 1][mi];
		const c = GRID[ti][mi + 1];
		const d = GRID[ti + 1][mi + 1];
		return $tuple(a, b, c, d, (1 - tfr) * (1 - mfr), tfr * (1 - mfr), (1 - tfr) * mfr, tfr * mfr);
	}

	/**
	 * Blended relief modifiers for the height generator. No elevation feedback here: shape is a function of
	 * climate alone, and elevation is the generator's own continental field.
	 */
	export function shape(x: number, z: number): LuaTuple<[reliefMul: number, duneStrength: number, baseBias: number]> {
		const temp = temperature(x, z);
		const [a, b, c, d, wa, wb, wc, wd] = corners(temp, moisture(x, z) - ARIDITY * (temp - 0.5));
		return $tuple(
			a.reliefMul * wa + b.reliefMul * wb + c.reliefMul * wc + d.reliefMul * wd,
			a.duneStrength * wa + b.duneStrength * wb + c.duneStrength * wc + d.duneStrength * wd,
			a.baseBias * wa + b.baseBias * wb + c.baseBias * wc + d.baseBias * wd,
		);
	}

	/**
	 * Blended colour and material for a surface point. Colour is the weighted mix (so borders ramp); material
	 * is the heaviest cell, since a material can't be interpolated. Elevation cools the climate first (snowy
	 * peaks fall out for free), then slope and waterline overrides win where they apply.
	 */
	export function surface(
		x: number,
		z: number,
		elevation: number,
		slope: number,
	): LuaTuple<[color: Color3, material: Enum.Material]> {
		if (elevation <= BEACH_MAX_HEIGHT) return $tuple(SAND_COLOR, Enum.Material.Sand);

		// Aridity keys off the base (climate) temperature; the elevation-cooled temperature only drives colour,
		// so a hot-dry lowland reads as desert while its peaks still cap with snow.
		const temp = temperature(x, z);
		const moist = moisture(x, z) - ARIDITY * (temp - 0.5);
		const cooled = temp - math.max(elevation, 0) * LAPSE_PER_STUD;
		const [a, b, c, d, wa, wb, wc, wd] = corners(cooled, moist);

		// Weighted average of the four cell colours. The bilinear weights already sum to 1, so this is a
		// straight component blend — no chained Lerp, which would not average four colours correctly.
		const color = new Color3(
			a.color.R * wa + b.color.R * wb + c.color.R * wc + d.color.R * wd,
			a.color.G * wa + b.color.G * wb + c.color.G * wc + d.color.G * wd,
			a.color.B * wa + b.color.B * wb + c.color.B * wc + d.color.B * wd,
		);

		let material = a.material;
		let best = wa;
		if (wb > best) [material, best] = [b.material, wb];
		if (wc > best) [material, best] = [c.material, wc];
		if (wd > best) [material, best] = [d.material, wd];

		if (slope >= ROCK_SLOPE) {
			// Desert cliffs read as pale limestone; everywhere else, dark rock.
			if (material === Enum.Material.Sand) return $tuple(LIMESTONE_COLOR, Enum.Material.Limestone);
			return $tuple(ROCK_COLOR, Enum.Material.Rock);
		}

		return $tuple(color, material);
	}
}
