import { TerrainNoise } from "client/terrain/TerrainNoise";

/**
 * Continuous biome blend on a Whittaker grid (temperature × moisture): colour/shape are a bilinear blend of the
 * four surrounding cells, so borders ramp instead of seaming. Pure function of (x, z) in VOXELS (1 unit = 4 studs),
 * so the Classic renderer can require it inside its Actor VMs.
 */
export namespace TerrainBiome {
	// Temperature is latitude belts: a low-freq noise along z, meandered along x. ~33k studs per belt.
	const LATITUDE_FREQ = 0.00006;
	const LATITUDE_MEANDER_FREQ = 0.00003;
	const LATITUDE_MEANDER = 4000;
	const LATITUDE_WEIGHT = 0.6; // belt vs. the anomaly layer; belt dominant so it reads as banded

	// Moisture: an independent broad field (single octave, warp slower than the field) so temperature and moisture
	// don't collapse onto one diagonal. At ANOMALY_WEIGHT it doubles as the anomaly that breaks up the belts.
	const CLIMATE_FREQ = 0.00006;
	const CLIMATE_WARP_FREQ = 0.00003;
	const CLIMATE_WARP = 1200;
	const ANOMALY_WEIGHT = 0.4;
	// Widen the swing so the corner biomes (desert/tundra) occur; corners() clamps the overshoot.
	const CLIMATE_SPREAD = 2.2;
	// Aridity pulls moisture down where hot / up where cold, so the hot-dry and cold-wet corners co-occur.
	const ARIDITY = 0.45;

	// Climate cools with elevation, so peaks read as snow. 0..1 climate units per stud above the waterline.
	const LAPSE_PER_STUD = 0.0016;

	const BEACH_MAX_HEIGHT = 4; // near the waterline, any biome gets sand
	// Bare rock on steep faces, as a gradient (rise/run) so the threshold means the same across renderers. ~0.6 ≈ 31°.
	const ROCK_SLOPE = 0.6;
	const SAND_COLOR = Color3.fromRGB(246, 215, 176);
	const ROCK_COLOR = Color3.fromRGB(74, 74, 78);
	// Substitute-material tints. Voxel terrain uses global colours (set in TerrainController); these are the wedge tints.
	const LIMESTONE_COLOR = Color3.fromRGB(147, 137, 119);
	const MUD_COLOR = Color3.fromRGB(84, 64, 44);
	const SLATE_COLOR = Color3.fromRGB(72, 78, 88);
	const ICE_COLOR = Color3.fromRGB(198, 220, 232);
	const GLACIER_COLOR = Color3.fromRGB(214, 232, 240);

	/** Global voxel-terrain tints for the substitute materials; applied in TerrainController to match the wedge tints. */
	export const materialTints: readonly (readonly [material: Enum.Material, tint: Color3])[] = [
		[Enum.Material.Limestone, LIMESTONE_COLOR],
		[Enum.Material.Mud, MUD_COLOR],
		[Enum.Material.Slate, SLATE_COLOR],
		[Enum.Material.Ice, ICE_COLOR],
		[Enum.Material.Glacier, GLACIER_COLOR],
	];

	// Substitute materials scattered by a small-scale mask in ~200-stud patches; higher gate = rarer.
	const SPLOTCH_FREQ = 0.02;
	const ICE_ROCK_GATE = 0.06; // icy cliffs among the rock in snow country
	const SLATE_GATE = 0.3; // slate among mountain rock — kept sparse, or whole mountainsides read as slate
	const GLACIER_GATE = 0.25; // glacier only where the mask peaks, so it doesn't sheet over arctic flats
	const MUD_GATE = 0.18; // sparse mud splotches in jungle
	const ICE_PEAK_HEIGHT = 500; // studs; glacier only above this, so it caps peaks not arctic lowland
	const MUD_TEMP = 0.6; // jungle-floor mud needs genuinely hot AND wet
	const MUD_MOIST = 0.5; // (moisture is already aridity-adjusted where this is tested)
	// Seafloor: large slate patches with occasional mud over the sand base.
	const SEAFLOOR_FREQ = 0.006; // ~700-stud patches (0.003 bigger .. 0.012 smaller)
	const SEAFLOOR_SLATE_GATE = 0.08; // higher = less slate
	const SEAFLOOR_MUD_GATE = -0.2; // lower = less mud

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

	// Whittaker grid GRID[temperature][moisture], cold/dry -> hot/wet; corners are the extremes.
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

	/** Low-frequency domain warp so moisture regions bend, not circular blobs. */
	function warp(x: number, z: number): LuaTuple<[number, number]> {
		const wf = CLIMATE_WARP_FREQ;
		const wx = x + math.noise(x * wf, 4211.3, z * wf) * CLIMATE_WARP;
		const wz = z + math.noise(x * wf, 9137.7, z * wf) * CLIMATE_WARP;
		return $tuple(wx, wz);
	}

	/** 0 (cold) .. 1 (hot). Latitude belts (a function of z) plus a light anomaly so they aren't clean stripes. */
	export function temperature(x: number, z: number): number {
		const meander = math.noise(x * LATITUDE_MEANDER_FREQ, 21.1, z * LATITUDE_MEANDER_FREQ) * LATITUDE_MEANDER;
		const belt = math.noise((z + meander) * LATITUDE_FREQ, 811.3, 0);
		const anomaly = TerrainNoise.fbm(x, z, 1487.5, CLIMATE_FREQ, 1);
		return (belt * LATITUDE_WEIGHT + anomaly * ANOMALY_WEIGHT) * CLIMATE_SPREAD + 0.5;
	}

	/** 0 (dry) .. 1 (wet). Broad, direction-free regions, independent of temperature so all biomes stay reachable. */
	export function moisture(x: number, z: number): number {
		const [wx, wz] = warp(x, z);
		return TerrainNoise.fbm(wx, wz, 2609.1, CLIMATE_FREQ, 1) * CLIMATE_SPREAD + 0.5;
	}

	/** The four grid cells around (temperature, moisture) and their bilinear weights — the one place blending happens. */
	function corners(
		temp: number,
		moist: number,
	): LuaTuple<[a: Biome, b: Biome, c: Biome, d: Biome, wa: number, wb: number, wc: number, wd: number]> {
		const tf = math.clamp(temp, 0, 1) * AXIS;
		const mf = math.clamp(moist, 0, 1) * AXIS;
		const ti = math.min(math.floor(tf), AXIS - 1);
		const mi = math.min(math.floor(mf), AXIS - 1);
		// Smoothstep the fractions so the blend is C1 (no crease at cell boundaries); weights still sum to 1.
		const tfr = TerrainNoise.smoothClamp01(tf - ti);
		const mfr = TerrainNoise.smoothClamp01(mf - mi);

		const a = GRID[ti][mi];
		const b = GRID[ti + 1][mi];
		const c = GRID[ti][mi + 1];
		const d = GRID[ti + 1][mi + 1];
		return $tuple(a, b, c, d, (1 - tfr) * (1 - mfr), tfr * (1 - mfr), (1 - tfr) * mfr, tfr * mfr);
	}

	/** Blended relief modifiers for the height generator (climate only; elevation is the generator's own field). */
	export function shape(x: number, z: number): LuaTuple<[reliefMul: number, duneStrength: number, baseBias: number]> {
		const temp = temperature(x, z);
		const [a, b, c, d, wa, wb, wc, wd] = corners(temp, moisture(x, z) - ARIDITY * (temp - 0.5));
		return $tuple(
			a.reliefMul * wa + b.reliefMul * wb + c.reliefMul * wc + d.reliefMul * wd,
			a.duneStrength * wa + b.duneStrength * wb + c.duneStrength * wc + d.duneStrength * wd,
			a.baseBias * wa + b.baseBias * wb + c.baseBias * wc + d.baseBias * wd,
		);
	}

	/** Small-scale mask for scattering a substitute material in patches. Roughly -0.5 .. 0.5. */
	function splotch(x: number, z: number, seed: number): number {
		return TerrainNoise.fbm(x, z, seed, SPLOTCH_FREQ, 2);
	}

	/** Blended colour + heaviest-cell material for a surface point, with waterline/slope/biome overrides. */
	export function surface(
		x: number,
		z: number,
		elevation: number,
		slope: number,
	): LuaTuple<[color: Color3, material: Enum.Material]> {
		// At/below the waterline: sand shore, but the submerged seafloor gets large slate patches (and some mud).
		if (elevation <= BEACH_MAX_HEIGHT) {
			if (elevation >= 0) return $tuple(SAND_COLOR, Enum.Material.Sand);
			const patch = TerrainNoise.fbm(x, z, 9203.5, SEAFLOOR_FREQ, 2);
			if (patch > SEAFLOOR_SLATE_GATE) return $tuple(SLATE_COLOR, Enum.Material.Slate);
			if (patch < SEAFLOOR_MUD_GATE) return $tuple(MUD_COLOR, Enum.Material.Mud);
			return $tuple(SAND_COLOR, Enum.Material.Sand);
		}

		// Aridity uses base temperature; the cooled temperature only drives colour (desert lowland, snowy peaks).
		const temp = temperature(x, z);
		const moist = moisture(x, z) - ARIDITY * (temp - 0.5);
		const cooled = temp - math.max(elevation, 0) * LAPSE_PER_STUD;
		const [a, b, c, d, wa, wb, wc, wd] = corners(cooled, moist);

		// Weighted blend of the four cell colours (weights sum to 1).
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
			if (material === Enum.Material.Sand) return $tuple(LIMESTONE_COLOR, Enum.Material.Limestone);
			if (material === Enum.Material.Snow && splotch(x, z, 5501.7) > ICE_ROCK_GATE) {
				return $tuple(ICE_COLOR, Enum.Material.Ice);
			}
			if (splotch(x, z, 6203.3) > SLATE_GATE) return $tuple(SLATE_COLOR, Enum.Material.Slate);
			return $tuple(ROCK_COLOR, Enum.Material.Rock);
		}

		// Glacier caps the highest cold ground.
		if (material === Enum.Material.Snow && elevation > ICE_PEAK_HEIGHT && splotch(x, z, 7107.9) > GLACIER_GATE) {
			return $tuple(GLACIER_COLOR, Enum.Material.Glacier);
		}

		// Mud on hot-wet forest floor (LeafyGrass-gated so trees grow there).
		// fixme: no salt-flat biome yet (hot, very dry, flat) — Enum.Material.Salt is still unused.
		if (
			material === Enum.Material.LeafyGrass &&
			temp > MUD_TEMP &&
			moist > MUD_MOIST &&
			splotch(x, z, 8311.1) > MUD_GATE
		) {
			return $tuple(MUD_COLOR, Enum.Material.Mud);
		}

		return $tuple(color, material);
	}
}
