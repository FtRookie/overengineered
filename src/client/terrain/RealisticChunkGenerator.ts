import { TerrainBiome } from "client/terrain/TerrainBiome";
import { TerrainBounds } from "client/terrain/TerrainBounds";
import { TerrainNoise } from "client/terrain/TerrainNoise";
import type { ChunkGenerator } from "client/terrain/ChunkLoader";

/**
 * Terrain from control fields, not a plain octave stack. Summed octaves are self-similar everywhere (bumps at
 * every scale, never a RANGE or a coastline); here low-freq fields (inland-ness, erosion, ridgelines) drive
 * splines into a base height and a detail amplitude BEFORE any detail is drawn, giving flat plains beside
 * sharp peaks. Pure function of (x, z): infinite world, chunks on demand out of order, run in the Actor VMs.
 */

// Authored with 0 as the waterline, shifted onto the game scale at the very end. The game floods to
// TerrainDataInfo.waterHeight, so terrain around a sea level of 0 would sit entirely above water (no ocean).
const SEA_LEVEL = 0;
const WATER_HEIGHT = -2;

// what the ground reads inside the build area, matching DefaultChunkGenerator's carve-out
const BUILD_AREA_LEVEL = -150;

// world origin in the noise field (voxels). Chosen for a shore spawn: buildable ground just above the
// waterline, ~60% land in view, high country within flying distance (the default fell in open ocean).
const ORIGIN_X = -39000;
const ORIGIN_Z = -15000;

// coords displaced by a noise field before sampling, so coastlines and ranges meander instead of blobbing.
// x, z arrive in VOXELS (1 unit = 4 studs), height is in studs; every freq/distance below is per-voxel.
const WARP_FREQ = 0.0014;
const WARP_STRENGTH = 105;

// how far inland: ocean -> shelf -> coast -> plain -> highland. ~13k studs per wavelength
const CONTINENT_FREQ = 0.0003;
const CONTINENT_OCTAVES = 3;

// how worn down: low jagged, high smoothed flat. Kept near the hill scale so flying meets new country often
const EROSION_FREQ = 0.0016;
const EROSION_OCTAVES = 2;

// where the ridgelines run
const PV = { FREQ: 0.003, OCTAVES: 3, STRENGTH: 560 } as const;

// rolling hills on any land; fill the gap between the km-scale control fields and tens-of-studs detail
const HILL = { FREQ: 0.0042, OCTAVES: 3, STRENGTH: 100 } as const;

const DETAIL_FREQ = 0.0088;
const DETAIL_OCTAVES = 5;

// roughness that survives the slope damping, so no surface is ever glassy up close
const GRAIN = { FREQ: 0.036, OCTAVES: 3, STRENGTH: 13 } as const;

// dune crests, scaled by biome duneStrength (desert only). Ridged not fbm (sharp crest, long flanks); ~400 studs/wavelength
const DUNE_FREQ = 0.01;
const DUNE_OCTAVES = 2;

// continentalness -> base height. The gentle middle run is the coastal shelf, what makes a beach read as a beach
const CONTINENT_SPLINE: readonly (readonly [number, number])[] = [
	[-1, -260],
	[-0.45, -150],
	[-0.2, -35],
	[-0.08, -6],
	[0, 8],
	[0.12, 26],
	[0.35, 90],
	[0.65, 240],
	[1, 430],
];

// erosion -> detail amplitude. Floor stays well above 0 on purpose: "eroded" means gentle, not featureless
const EROSION_SPLINE: readonly (readonly [number, number])[] = [
	[-1, 230],
	[-0.55, 175],
	[-0.2, 120],
	[0.15, 88],
	[0.5, 68],
	[1, 58],
];

// mesa country: flat tops, sheer sides, in a few regions not everywhere. Gated twice (rare low-freq mask +
// height floor) so plateaus belong to particular country and never terrace the lowland into a wedding cake.
// A flat top is the one useful landform here: somewhere to land, take off, or build.
const MESA = {
	FREQ: 0.00022, // which regions have mesas: low freq, high gate = a rare country, not a texture
	OCTAVES: 2,
	GATE: 0.34,
	SHAPE_FREQ: 0.0018, // footprint of one mesa
	WALL: 0.16, // wall abruptness; small is sheer, the whole point of the landform
	TOP_FREQ: 0.0009, // roofs vary in height so a group doesn't read as one slab with gaps cut in it
	RELIEF: 220,
	FLOOR: 120, // no mesas below this; the lowland is left alone
} as const;

// table height for a patch of mesa country. NOT a quantisation of existing height (that rules every hillside
// into contour bands); a mesa is an OBJECT with its own footprint and field, and the ground is lifted onto it.
function mesaTop(x: number, z: number): number {
	const level = TerrainNoise.fbm(x, z, 6101.9, MESA.TOP_FREQ, 2) * 2;
	return MESA.FLOOR + 90 + TerrainNoise.smoothClamp01(level * 0.5 + 0.5) * MESA.RELIEF;
}

// gradient magnitude of the low-freq field; two extra samples total, not two per octave
function slopeAt(x: number, z: number): number {
	const e = 15;
	const f = CONTINENT_FREQ * 4;
	const h0 = math.noise(x * f, 101.5, z * f);
	const hx = math.noise((x + e) * f, 101.5, z * f);
	const hz = math.noise(x * f, 101.5, (z + e) * f);

	const dx = hx - h0;
	const dz = hz - h0;
	return math.sqrt(dx * dx + dz * dz) * 40;
}

export const RealisticChunkGenerator: ChunkGenerator = {
	getHeight(rawX: number, rawZ: number): number {
		const x = rawX + ORIGIN_X;
		const z = rawZ + ORIGIN_Z;

		// displace the sample position first; every field below reads the warped coords
		const warpX = x * WARP_FREQ;
		const warpZ = z * WARP_FREQ;
		const wx = x + math.noise(warpX, 1301.7, warpZ) * WARP_STRENGTH;
		const wz = z + math.noise(warpX, 2707.3, warpZ) * WARP_STRENGTH;

		const continent = TerrainNoise.fbm(wx, wz, 101.5, CONTINENT_FREQ, CONTINENT_OCTAVES) * 2.2;
		const erosionRaw = TerrainNoise.fbm(wx, wz, 503.9, EROSION_FREQ, EROSION_OCTAVES) * 2.4;
		// fbm is bell-shaped; without the clamp the extremes are too rare and mountains never form
		const erosion = math.clamp(erosionRaw, -1, 1);

		const base = TerrainNoise.spline(math.clamp(continent, -1, 1), CONTINENT_SPLINE);
		const amp = TerrainNoise.spline(erosion, EROSION_SPLINE);

		// smoothed not clamped (a hard clamp creases where it saturates). Land counts as land well before the
		// continental interior, so coastal ranges (the common real-world case) actually form.
		const land = TerrainNoise.smoothClamp01((continent + 0.05) * 3);

		// climate shaping (flatter desert/steppe, rougher forest, dunes on sand). RAW coords, matching what the
		// renderers pass to TerrainBiome.surface, so each place is shaped like the biome painted on it. Land only.
		let reliefMul = 1;
		let duneStrength = 0;
		let baseBias = 0;
		if (land > 0) {
			const [relief, dune, bias] = TerrainBiome.shape(rawX, rawZ);
			reliefMul = relief;
			duneStrength = dune;
			baseBias = bias;
		}

		// surf flattens the shoreline, else the fine layers shred the waterline into one-stud sand specks.
		// base is the pre-detail height, so reading it here is not circular.
		const coast = 0.4 + 0.6 * TerrainNoise.smoothClamp01((math.abs(base - SEA_LEVEL) - 6) / 26);

		// detail thins on already-steep ground, a cheap stand-in for real (neighbour + iteration) erosion
		const damp = 0.45 + 0.55 / (1 + slopeAt(wx, wz) * 2.2);
		const detail =
			TerrainNoise.fbm(wx, wz, 1607.7, DETAIL_FREQ, DETAIL_OCTAVES, 0.58) * amp * damp * coast * reliefMul;

		// ridge/hills/grain/mesa below are all * land (exactly 0 past the shelf), so skip their noise over open
		// water instead of sampling it and multiplying by zero
		let bulk = base + WATER_HEIGHT;
		let grain = 0;
		let mesaStrength = 0;

		if (land > 0) {
			const relief = TerrainNoise.smoothClamp01(-erosion * 0.9 + 0.45);
			const pv = TerrainNoise.ridged(wx, wz, 907.1, PV.FREQ, PV.OCTAVES);

			// ridges belong to mountains not plains; relief is bell-shaped so squaring the mask erased real
			// mountains (0% survey), a gentler curve keeps them off the lowland while still letting them occur
			const ridge = pv * PV.STRENGTH * land * relief * (0.35 + 0.65 * relief) * reliefMul;
			const hills = TerrainNoise.fbm(wx, wz, 2003.3, HILL.FREQ, HILL.OCTAVES) * HILL.STRENGTH * land * reliefMul;
			// grain left unscaled: the floor that keeps any surface from going glassy; even a flat biome wants grit
			grain = TerrainNoise.fbm(wx, wz, 3301.1, GRAIN.FREQ, GRAIN.OCTAVES) * GRAIN.STRENGTH * land * coast;

			// the large form without the fine layers. Terracing must happen here: detail crosses step boundaries
			// constantly and stepping the finished height would rule every hillside into contour bands.
			bulk = base + ridge + hills + WATER_HEIGHT + baseBias * land;

			// dunes go in the bulk not the detail, so the mesa pass can flatten them onto a table instead of
			// leaving them rippling over its roof
			if (duneStrength > 0.01) {
				bulk += TerrainNoise.ridged(wx, wz, 6421.7, DUNE_FREQ, DUNE_OCTAVES) * duneStrength * land * coast;
			}

			// mesa country, gated on its own field so it doesn't track the mountains exactly; partial overlap is
			// what makes a plateau feel like a place rather than a setting
			const mesa = TerrainNoise.fbm(wx, wz, 4507.3, MESA.FREQ, MESA.OCTAVES) * 2.2;
			const mesaMask = TerrainNoise.smoothClamp01((mesa - MESA.GATE) * 3.5) * land;

			if (mesaMask > 0.01) {
				// footprint of one table, sharpened hard: the outside->inside transition IS the cliff, a wide
				// blend would give a hill with a flat patch instead of a wall
				const shape = TerrainNoise.fbm(wx, wz, 7717.1, MESA.SHAPE_FREQ, 2) * 2;
				const inside = TerrainNoise.smoothClamp01((shape - 0.18) / MESA.WALL);

				// only where the land already stands high enough to carry one
				mesaStrength = inside * mesaMask * TerrainNoise.smoothClamp01((bulk - MESA.FLOOR) / 70);

				// lift the ground ONTO the table rather than reshape it; max() stops a mesa cutting into a
				// mountain that already stands taller than its roof
				if (mesaStrength > 0.01) {
					bulk += (math.max(mesaTop(wx, wz), bulk) - bulk) * mesaStrength;
				}
			}
		}

		// on a plateau the detail is nearly all removed (even a quarter left runs of level ground only ~84 studs,
		// unlandable). Grain stays so it's not glassy; the walls keep roughness as mesaStrength falls off across them.
		const flat = 1 - mesaStrength;
		const height = bulk + detail * flat + grain * (0.25 + 0.75 * flat);

		// flatten the build area rather than generate under it. RAW coords: the build area is fixed in the world,
		// while x/z above are ORIGIN-shifted to pick which part of the noise field the world opens on.
		const outside = TerrainBounds.outsideBuildArea(rawX, rawZ);
		return height * outside + BUILD_AREA_LEVEL * (1 - outside);
	},
};
