import { Workspace } from "@rbxts/services";
import { TerrainBiome } from "client/terrain/TerrainBiome";
import { Materials } from "engine/shared/data/Materials";
import { Element } from "engine/shared/Element";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { TerrainDataInfo } from "shared/TerrainDataInfo";
import type { ChunkGenerator, ChunkRenderer } from "client/terrain/ChunkLoader";

/**
 * Walkable ice over frozen arctic lakes. A lake is water enclosed within 2048 studs (the sea is not); cold tiles
 * get Ice parts covering the water surface — thickness from temperature — and the water is left underneath.
 */

const obstaclesFolder = Workspace.WaitForChild("Obstacles");

const VOXEL = 4; // studs per voxel (getHeight/temperature sample space)

const SUPER_TILE = 2048; // studs per tile (max Roblox part size; a lake fits in one)
const GRID = 32; // mask cells per axis
const CELL = SUPER_TILE / GRID; // 64 studs

const FREEZE_TEMP = 0.33; // biome temp below which lakes freeze (0..1)
const CLIMATE_SPAN_C = 90; // a 0..1 temp step in °C

// Lake vs sea: water reaching shore within this in every direction is a lake; still open at 2048 is the sea.
const ENCLOSURE_R = 2048;
const ENCLOSURE_STEP = 64;
const ENCLOSURE_DIRS: readonly (readonly [number, number])[] = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
	[0.7071, 0.7071],
	[0.7071, -0.7071],
	[-0.7071, 0.7071],
	[-0.7071, -0.7071],
];

const MIN_ICE = 0.4; // studs (0.2..8)
const MAX_ICE = 4; // studs (0.2..8)
const STEFAN_K = 0.73; // Stefan √(k·ΔT) scale, studs per √°C (0.3..1.5)
const ICE_TRANSPARENCY = 0;
const ICE_COLOR = Color3.fromRGB(200, 225, 235);

const WATER_LEVEL = TerrainDataInfo.data.waterHeight;
const SURFACE_SINK = 3; // studs; drops the fixed top onto the real water surface
const ICE_TOP_Y = GameDefinitions.HEIGHT_OFFSET + WATER_LEVEL - SURFACE_SINK;

// Wedge leg directions per wet corner (0=-x-z, 1=+x-z, 2=+x+z, 3=-x+z), ordered [vY, vZ] so
// fromMatrix(pos, up, vY, vZ) is right-handed and puts the WedgePart's right angle on the wet corner.
const UP = new Vector3(0, 1, 0);
const WEDGE_LEGS: readonly (readonly [Vector3, Vector3])[] = [
	[new Vector3(1, 0, 0), new Vector3(0, 0, -1)],
	[new Vector3(0, 0, 1), new Vector3(1, 0, 0)],
	[new Vector3(-1, 0, 0), new Vector3(0, 0, 1)],
	[new Vector3(0, 0, -1), new Vector3(-1, 0, 0)],
];

// Ice conductivity relative to the default material, read once; retuning Ice in the table thickens every sheet.
const defaultThermal = Materials.Properties.Default.thermalProperties!;
const CONDUCTIVITY_FACTOR =
	(Materials.Properties["Ice"]?.thermalProperties?.conductivity ?? defaultThermal.conductivity!) /
	defaultThermal.conductivity!;

export const IceChunkRenderer = (generator: ChunkGenerator): ChunkRenderer<Folder> => {
	const parent = Element.create("Folder", { Name: "Iceterra", Parent: obstaclesFolder });

	const isWater = (voxelX: number, voxelZ: number) => generator.getHeight(voxelX, voxelZ) < WATER_LEVEL;

	const isEnclosedLake = (voxelX: number, voxelZ: number) => {
		for (const [dx, dz] of ENCLOSURE_DIRS) {
			let reachedShore = false;
			for (let d = ENCLOSURE_STEP; d <= ENCLOSURE_R; d += ENCLOSURE_STEP) {
				const dv = d / VOXEL;
				if (!isWater(voxelX + dx * dv, voxelZ + dz * dv)) {
					reachedShore = true;
					break;
				}
			}
			if (!reachedShore) return false;
		}
		return true;
	};

	const iceThickness = (voxelX: number, voxelZ: number) => {
		const belowFreezing = (FREEZE_TEMP - TerrainBiome.temperature(voxelX, voxelZ)) * CLIMATE_SPAN_C;
		return math.clamp(STEFAN_K * math.sqrt(math.max(belowFreezing, 0) * CONDUCTIVITY_FACTOR), MIN_ICE, MAX_ICE);
	};

	return {
		chunkSize: SUPER_TILE,
		loadDistanceMultiplier: 4,

		renderChunk(chunkX: number, chunkZ: number): Folder | undefined {
			const originX = chunkX * SUPER_TILE;
			const originZ = chunkZ * SUPER_TILE;

			const centerVX = (originX + SUPER_TILE / 2) / VOXEL;
			const centerVZ = (originZ + SUPER_TILE / 2) / VOXEL;
			if (TerrainBiome.temperature(centerVX, centerVZ) >= FREEZE_TEMP) return undefined;

			// Water sampled at cell corners (a (GRID+1)² vertex grid), so the sheet reaches the shore and bevels.
			const V = GRID + 1; // vertices per axis (cells + 1)
			const waterV: boolean[] = [];
			let anyWater = false;
			let seedVX = 0;
			let seedVZ = 0;
			for (let vr = 0; vr < V; vr++) {
				for (let vc = 0; vc < V; vc++) {
					const vx = (originX + vc * CELL) / VOXEL;
					const vz = (originZ + vr * CELL) / VOXEL;
					const water = isWater(vx, vz);
					waterV[vr * V + vc] = water;
					if (water) {
						anyWater = true;
						seedVX = vx;
						seedVZ = vz;
					}
				}
			}
			if (!anyWater) return undefined;
			if (!isEnclosedLake(seedVX, seedVZ)) return undefined; // sea, not a lake

			if (math.random() > 0.9) task.wait();

			const folder = new Instance("Folder");
			const makeBox = (sx: number, sz: number, cx: number, cz: number) => {
				const th = iceThickness(cx / VOXEL, cz / VOXEL);
				const part = new Instance("Part");
				part.Anchored = true;
				part.CanCollide = true;
				part.CastShadow = false;
				part.Material = Enum.Material.Ice;
				part.Color = ICE_COLOR;
				part.Transparency = ICE_TRANSPARENCY;
				part.Size = new Vector3(sx, th, sz);
				part.Position = new Vector3(cx, ICE_TOP_Y - th / 2, cz);
				part.Parent = folder;
			};
			// Flat right-triangle over one corner (0=-x-z, 1=+x-z, 2=+x+z, 3=-x+z) so a step becomes a 45° bevel.
			const makeWedge = (cx: number, cz: number, corner: number) => {
				const th = iceThickness(cx / VOXEL, cz / VOXEL);
				const wedge = new Instance("WedgePart");
				wedge.Anchored = true;
				wedge.CanCollide = true;
				wedge.CastShadow = false;
				wedge.Material = Enum.Material.Ice;
				wedge.Color = ICE_COLOR;
				wedge.Transparency = ICE_TRANSPARENCY;
				wedge.Size = new Vector3(th, CELL, CELL);
				const [vY, vZ] = WEDGE_LEGS[corner];
				wedge.CFrame = CFrame.fromMatrix(new Vector3(cx, ICE_TOP_Y - th / 2, cz), UP, vY, vZ);
				wedge.Parent = folder;
			};

			// Full cells (≥3 corners or the diagonal saddle) merge into rectangles; two-corner edges → half box, lone corners → wedge.
			const full: boolean[] = [];
			for (let r = 0; r < GRID; r++) {
				for (let c = 0; c < GRID; c++) {
					// cell's 4 corner water flags — c<x><z> (0 = this cell, 1 = next): 00 -x-z, 10 +x-z, 01 -x+z, 11 +x+z
					const c00 = waterV[r * V + c];
					const c10 = waterV[r * V + c + 1];
					const c01 = waterV[(r + 1) * V + c];
					const c11 = waterV[(r + 1) * V + c + 1];
					const count = (c00 ? 1 : 0) + (c10 ? 1 : 0) + (c01 ? 1 : 0) + (c11 ? 1 : 0);
					full[r * GRID + c] = count >= 3 || (count === 2 && ((c00 && c11) || (c10 && c01)));
				}
			}

			const covered: boolean[] = [];
			for (let r = 0; r < GRID; r++) {
				for (let c = 0; c < GRID; c++) {
					if (!full[r * GRID + c] || covered[r * GRID + c]) continue;

					// w, h: rectangle size in cells — grow right (w), then down (h) while every cell stays full
					let w = 0;
					while (c + w < GRID && full[r * GRID + c + w] && !covered[r * GRID + c + w]) w++;

					let h = 0;
					while (r + h < GRID) {
						let rowOk = true;
						for (let cc = c; cc < c + w; cc++) {
							if (!full[(r + h) * GRID + cc] || covered[(r + h) * GRID + cc]) {
								rowOk = false;
								break;
							}
						}
						if (!rowOk) break;
						h++;
					}

					for (let rr = r; rr < r + h; rr++) {
						for (let cc = c; cc < c + w; cc++) covered[rr * GRID + cc] = true;
					}

					makeBox(w * CELL, h * CELL, originX + (c + w / 2) * CELL, originZ + (r + h / 2) * CELL);
				}
			}

			for (let r = 0; r < GRID; r++) {
				for (let c = 0; c < GRID; c++) {
					if (full[r * GRID + c]) continue;
					// corner water flags, as above (c<x><z>)
					const c00 = waterV[r * V + c];
					const c10 = waterV[r * V + c + 1];
					const c01 = waterV[(r + 1) * V + c];
					const c11 = waterV[(r + 1) * V + c + 1];
					const count = (c00 ? 1 : 0) + (c10 ? 1 : 0) + (c01 ? 1 : 0) + (c11 ? 1 : 0);
					const cx = originX + (c + 0.5) * CELL;
					const cz = originZ + (r + 0.5) * CELL;

					if (count === 2) {
						if (c00 && c10) makeBox(CELL, CELL / 2, cx, cz - CELL / 4);
						else if (c01 && c11) makeBox(CELL, CELL / 2, cx, cz + CELL / 4);
						else if (c00 && c01) makeBox(CELL / 2, CELL, cx - CELL / 4, cz);
						else if (c10 && c11) makeBox(CELL / 2, CELL, cx + CELL / 4, cz);
					} else if (count === 1) {
						let corner = 3;
						if (c00) corner = 0;
						else if (c10) corner = 1;
						else if (c11) corner = 2;
						makeWedge(cx, cz, corner);
					}
				}
			}

			folder.Parent = parent;
			return folder;
		},
		destroyChunk(chunkX: number, chunkZ: number, chunk: Folder): void {
			chunk.Destroy();
		},
		unloadAll(chunks): void {
			for (const chunk of chunks) {
				chunk.Destroy();
			}
		},
		destroy(): void {
			parent.Destroy();
		},
	};
};
