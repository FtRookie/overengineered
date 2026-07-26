import { Workspace } from "@rbxts/services";
import { TerrainBiome } from "client/terrain/TerrainBiome";
import { Materials } from "engine/shared/data/Materials";
import { Element } from "engine/shared/Element";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { TerrainDataInfo } from "shared/TerrainDataInfo";
import type { ChunkGenerator, ChunkRenderer } from "client/terrain/ChunkLoader";

/**
 * Walkable ice over frozen arctic lakes: a water body that closes within LAKE_CELL_CAP cells freezes,
 * anything larger is the sea and stays unfrozen. Ice thickness comes from temperature.
 */

const obstaclesFolder = Workspace.WaitForChild("Obstacles");

const VOXEL = 4; // studs per voxel (getHeight/temperature sample space)

const SUPER_TILE = 2048; // studs per tile (max Roblox part size; a lake fits in one)
const GRID = 32; // mask cells per axis
const CELL = SUPER_TILE / GRID; // 64 studs

const FREEZE_TEMP = 0.33; // biome temp below which lakes freeze (0..1), averaged over the whole lake
// Slack on the per-tile early-out: a qualifying lake can reach into a warmer tile, and skipping it would cut the sheet at the border.
const FREEZE_TILE_MARGIN = 0.1;
const CLIMATE_SPAN_C = 90; // a 0..1 temp step in °C

// Lake vs sea is a property of the water body, not the tile: deciding it per tile disagrees at seams and cuts sheets.
const LAKE_CELL_CAP = 3000; // cells; ~12M studs², a lake about 3.5k studs across
const VERDICT_CACHE_CAP = 200_000;
// Cell coordinates stay far inside this, so cx*KEY_SPAN + cz is a unique number for negatives too.
const KEY_SPAN = 8_388_608;

const MIN_ICE = 0.4; // studs (0.2..8)
const MAX_ICE = 4; // studs (0.2..8)
const STEFAN_K = 0.73; // Stefan √(k·ΔT) scale, studs per √°C (0.3..1.5)

const WATER_LEVEL = TerrainDataInfo.data.waterHeight;
const SURFACE_SINK = 3; // studs; drops the fixed top onto the real water surface
const ICE = {
	TRANSPARENCY: 0,
	COLOR: Color3.fromRGB(200, 225, 235),
	TOP_Y: GameDefinitions.HEIGHT_OFFSET + WATER_LEVEL - SURFACE_SINK,
} as const;

// Wedge leg dirs per wet corner (0=-x-z, 1=+x-z, 2=+x+z, 3=-x+z), ordered [vY, vZ] so fromMatrix puts the right angle on the wet corner.
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
	const isWaterCell = (cellX: number, cellZ: number) => isWater((cellX * CELL) / VOXEL, (cellZ * CELL) / VOXEL);

	// Verdict per lattice cell, kept for the renderer's life: a body is flooded once, then every cell it covers is answered from here.
	const verdicts = new Map<number, boolean>();
	const cellKey = (cellX: number, cellZ: number) => cellX * KEY_SPAN + cellZ;

	/** Whether the water body containing this (water) cell is an enclosed lake AND cold enough to freeze. */
	const isIceableCell = (cellX: number, cellZ: number): boolean => {
		const cached = verdicts.get(cellKey(cellX, cellZ));
		if (cached !== undefined) return cached;

		// Parallel arrays rather than packed keys, so nothing has to be unpacked back into coordinates.
		const stackX: number[] = [cellX];
		const stackZ: number[] = [cellZ];
		const bodyX: number[] = [];
		const bodyZ: number[] = [];
		const seen = new Set<number>();
		seen.add(cellKey(cellX, cellZ));

		let iceable = true;
		while (stackX.size() > 0) {
			const x = stackX.pop()!;
			const z = stackZ.pop()!;
			bodyX.push(x);
			bodyZ.push(z);

			// Over the cap the body is the sea; cells walked so far still cache correctly as sea even though the walk stopped early.
			if (bodyX.size() > LAKE_CELL_CAP) {
				iceable = false;
				break;
			}

			for (let d = 0; d < 4; d++) {
				const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
				const nz = z + (d === 2 ? 1 : d === 3 ? -1 : 0);
				const nkey = cellKey(nx, nz);
				if (seen.has(nkey)) continue;

				seen.add(nkey);
				if (!isWaterCell(nx, nz)) continue;

				stackX.push(nx);
				stackZ.push(nz);
			}
		}

		// A lake freezes as one sheet or not at all, so the whole body votes with its mean temperature.
		if (iceable) {
			let sum = 0;
			for (let i = 0; i < bodyX.size(); i++) {
				sum += TerrainBiome.temperature((bodyX[i] * CELL) / VOXEL, (bodyZ[i] * CELL) / VOXEL);
			}
			iceable = sum / bodyX.size() < FREEZE_TEMP;
		}

		if (verdicts.size() > VERDICT_CACHE_CAP) verdicts.clear();
		for (let i = 0; i < bodyX.size(); i++) {
			verdicts.set(cellKey(bodyX[i], bodyZ[i]), iceable);
		}
		return iceable;
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
			if (TerrainBiome.temperature(centerVX, centerVZ) >= FREEZE_TEMP + FREEZE_TILE_MARGIN) return undefined;

			// Sample water at the cell corners (a (GRID+1)² vertex grid) on the shared lattice, so the sheet reaches the shore and continues across seams.
			const V = GRID + 1; // vertices per axis (cells + 1)
			const baseCellX = originX / CELL;
			const baseCellZ = originZ / CELL;
			const lakeV: boolean[] = [];
			let anyLake = false;
			for (let vr = 0; vr < V; vr++) {
				for (let vc = 0; vc < V; vc++) {
					const cellX = baseCellX + vc;
					const cellZ = baseCellZ + vr;
					const lake = isWaterCell(cellX, cellZ) && isIceableCell(cellX, cellZ);
					lakeV[vr * V + vc] = lake;
					if (lake) anyLake = true;
				}
			}
			if (!anyLake) return undefined;

			if (math.random() > 0.9) task.wait();

			const folder = new Instance("Folder");
			const makeBox = (sx: number, sz: number, cx: number, cz: number) => {
				const th = iceThickness(cx / VOXEL, cz / VOXEL);
				const part = new Instance("Part");
				part.Anchored = true;
				part.CanCollide = true;
				part.CastShadow = false;
				part.Material = Enum.Material.Ice;
				part.Color = ICE.COLOR;
				part.Transparency = ICE.TRANSPARENCY;
				part.Size = new Vector3(sx, th, sz);
				part.Position = new Vector3(cx, ICE.TOP_Y - th / 2, cz);
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
				wedge.Color = ICE.COLOR;
				wedge.Transparency = ICE.TRANSPARENCY;
				wedge.Size = new Vector3(th, CELL, CELL);
				const [vY, vZ] = WEDGE_LEGS[corner];
				wedge.CFrame = CFrame.fromMatrix(new Vector3(cx, ICE.TOP_Y - th / 2, cz), UP, vY, vZ);
				wedge.Parent = folder;
			};

			// Full cells (≥3 corners or the diagonal saddle) merge into rectangles; two-corner edges → half box, lone corners → wedge.
			const full: boolean[] = [];
			for (let r = 0; r < GRID; r++) {
				for (let c = 0; c < GRID; c++) {
					// cell's 4 corner water flags — c<x><z> (0 = this cell, 1 = next): 00 -x-z, 10 +x-z, 01 -x+z, 11 +x+z
					const c00 = lakeV[r * V + c];
					const c10 = lakeV[r * V + c + 1];
					const c01 = lakeV[(r + 1) * V + c];
					const c11 = lakeV[(r + 1) * V + c + 1];
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
					const c00 = lakeV[r * V + c];
					const c10 = lakeV[r * V + c + 1];
					const c01 = lakeV[(r + 1) * V + c];
					const c11 = lakeV[(r + 1) * V + c + 1];
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
