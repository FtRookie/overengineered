import { TerrainBounds } from "client/terrain/TerrainBounds";
import { TerrainNoise } from "client/terrain/TerrainNoise";
import type { ChunkGenerator } from "client/terrain/ChunkLoader";

/**
 * Terrain built from control fields rather than from a plain stack of octaves.
 *
 * Summing octaves makes every point independent of every other, so the result is the same everywhere: you
 * get bumps and puddles at every scale and never a mountain RANGE or a coastline. Here three low-frequency
 * fields decide what kind of place this is — how far inland, how worn down, where the ridges run — and
 * splines turn that into a base height and a detail amplitude BEFORE any detail is drawn. That is what
 * gives genuinely flat plains next to genuinely sharp mountains.
 *
 * Everything is a pure function of (x, z): the world is infinite, chunks are generated on demand and out of
 * order, and the Classic renderer evaluates this inside separate Actor VMs.
 */

/**
 * Everything below is authored with 0 as the waterline, and the whole result is shifted onto the game's
 * scale at the very end. The game floods to `TerrainDataInfo.waterHeight`, so terrain built around a sea
 * level of 0 would sit entirely ABOVE the water and the world would have no ocean at all.
 */
const SEA_LEVEL = 0;
const WATER_HEIGHT = -2;

/** What the ground reads inside the build area, matching DefaultChunkGenerator's carve-out. */
const BUILD_AREA_LEVEL = -150;

/**
 * Where the world origin lands in the noise field, in voxels.
 *
 * The origin is where players spawn and build, and untouched it fell in open ocean — the first thing anyone
 * saw was water to the horizon. Picked by searching for shore: buildable ground a little above the
 * waterline, roughly 60% land in view, and high country within flying distance.
 */
const ORIGIN_X = -39000;
const ORIGIN_Z = -15000;

// Coordinates are displaced by a noise field before anything is sampled, so coastlines and ranges meander
// instead of coming out as circular blobs.
//
// NOTE: x and z arrive in VOXELS — one unit is 4 studs — while the height returned is in studs. Every
// frequency and distance below is therefore per-voxel; multiply by 4 to reason about them in studs.
const WARP_FREQ = 0.0014;
const WARP_STRENGTH = 105;

// How far inland: ocean -> shelf -> coast -> plain -> highland. One wavelength is roughly 13k studs.
const CONTINENT_FREQ = 0.0003;
const CONTINENT_OCTAVES = 3;

// How worn down the land is: low means jagged, high means smoothed flat. Deliberately not much coarser
// than the hills: a player crossing this at flying speed has to meet new country often, and an accurate
// 5km plain is just a long green corridor.
const EROSION_FREQ = 0.0016;
const EROSION_OCTAVES = 2;

// Where the ridgelines run.
const PV_FREQ = 0.003;
const PV_OCTAVES = 3;
const PV_STRENGTH = 560;

// Rolling hills, present on any land. Without these the plains came out as a flat wash: the control fields
// work in kilometres and the detail works in tens of studs, and nothing filled the gap between them.
const HILL_FREQ = 0.0042;
const HILL_OCTAVES = 3;
const HILL_STRENGTH = 100;

const DETAIL_FREQ = 0.0088;
const DETAIL_OCTAVES = 5;

// A little roughness that survives the slope damping, so no surface is ever glassy up close.
const GRAIN_FREQ = 0.036;
const GRAIN_OCTAVES = 3;
const GRAIN_STRENGTH = 13;

/**
 * Continentalness to base height. The gentle run through the middle is the coastal shelf, and it is what
 * makes a beach read as a beach instead of as "wherever the slope happens to cross sea level".
 */
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

/**
 * Erosion to detail amplitude. The floor is 34 rather than ~0 on purpose: "eroded" has to mean gentle, not
 * featureless, or the plains turn back into a flat wash with nothing to look at.
 */
const EROSION_SPLINE: readonly (readonly [number, number])[] = [
	[-1, 230],
	[-0.55, 175],
	[-0.2, 120],
	[0.15, 88],
	[0.5, 68],
	[1, 58],
];

/** Gradient magnitude of the low-frequency field. Two extra samples in total, not two per octave. */
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

		// Displace the sampling position first; every field below reads the warped coordinates.
		const wx = x + math.noise(x * WARP_FREQ, 1301.7, z * WARP_FREQ) * WARP_STRENGTH;
		const wz = z + math.noise(x * WARP_FREQ, 2707.3, z * WARP_FREQ) * WARP_STRENGTH;

		const continent = TerrainNoise.fbm(wx, wz, 101.5, CONTINENT_FREQ, CONTINENT_OCTAVES) * 2.2;
		const erosionRaw = TerrainNoise.fbm(wx, wz, 503.9, EROSION_FREQ, EROSION_OCTAVES) * 2.4;
		// fbm is bell-shaped, so without this the extremes are so rare that mountains never form.
		const erosion = math.clamp(erosionRaw, -1, 1);
		const pv = TerrainNoise.ridged(wx, wz, 907.1, PV_FREQ, PV_OCTAVES);

		const base = TerrainNoise.spline(math.clamp(continent, -1, 1), CONTINENT_SPLINE);
		const amp = TerrainNoise.spline(erosion, EROSION_SPLINE);

		// Masks, smoothed rather than clamped: a hard clamp creases the ground wherever it saturates.
		//
		// Both were once tuned so tight that mountains needed deep-inland AND barely-eroded at the same
		// time — the product of two rare events, which measured out at 1% of the world. Land now counts as
		// land well before the continental interior, and moderate erosion already earns real relief.
		// Coastal ranges are the common case in the real world anyway.
		const land = TerrainNoise.smoothClamp01((continent + 0.05) * 3);
		const relief = TerrainNoise.smoothClamp01(-erosion * 0.9 + 0.45);

		// Ridges belong to mountain country, not to the plains — but `relief` comes from a bell-shaped
		// field, so squaring the mask made real mountains vanish entirely: a survey of the world found 0%.
		// A gentler curve keeps them off the lowland while letting them actually occur.
		const ridge = pv * PV_STRENGTH * land * relief * (0.35 + 0.65 * relief);
		const hills = TerrainNoise.fbm(wx, wz, 2003.3, HILL_FREQ, HILL_OCTAVES) * HILL_STRENGTH * land;

		// Surf flattens a shoreline. Without this the fine layers shred the waterline into a scatter of
		// one-stud sand specks. `base` is the pre-detail height, so reading it here is not circular.
		const coast = 0.4 + 0.6 * TerrainNoise.smoothClamp01((math.abs(base - SEA_LEVEL) - 6) / 26);

		// Detail thins out on ground that is already steep — a cheap stand-in for erosion, which really
		// needs neighbours and iteration and so cannot exist in an infinite getHeight(x, z).
		const damp = 0.45 + 0.55 / (1 + slopeAt(wx, wz) * 2.2);
		const detail = TerrainNoise.fbm(wx, wz, 1607.7, DETAIL_FREQ, DETAIL_OCTAVES, 0.58) * amp * damp * coast;
		const grain = TerrainNoise.fbm(wx, wz, 3301.1, GRAIN_FREQ, GRAIN_OCTAVES) * GRAIN_STRENGTH * land * coast;

		const height = base + ridge + hills + detail + grain + WATER_HEIGHT;

		// Flatten the build area away rather than generate under it.
		// The RAW coordinates: the build area sits at a fixed place in the world, while x/z above have been
		// displaced by ORIGIN to pick which part of the noise field the world opens on.
		const outside = TerrainBounds.outsideBuildArea(rawX, rawZ);
		return height * outside + BUILD_AREA_LEVEL * (1 - outside);
	},
};
