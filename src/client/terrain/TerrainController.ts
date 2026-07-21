import { Workspace } from "@rbxts/services";
import { ChunkLoader } from "client/terrain/ChunkLoader";
import { DefaultChunkGenerator } from "client/terrain/DefaultChunkGenerator";
import { FlatTerrainRenderer } from "client/terrain/FlatTerrainRenderer";
import { RealisticChunkGenerator } from "client/terrain/RealisticChunkGenerator";
import { TerrainChunkRenderer } from "client/terrain/TerrainChunkRenderer";
import { TriangleChunkRenderer } from "client/terrain/TriangleChunkRenderer";
import { WaterTerrainChunkRenderer } from "client/terrain/WaterTerrainChunkRenderer";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { HostedService } from "engine/shared/di/HostedService";
import { Objects } from "engine/shared/fixes/Objects";
import { CustomRemotes } from "shared/Remotes";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

@injectable
export class TerrainController extends HostedService {
	constructor(@inject playerData: PlayerDataStorage) {
		super();

		const loaders = this.parent(new ComponentChildren<ChunkLoader>(true));

		// Cartographer: a generated chunk marks the fixed-size world cells it covers (chunk sizes vary per renderer)
		const EXPLORED_CELL = 256;
		const seenCells = new Set<string>();
		let pendingChunks = 0;
		const recordChunk = (chunkX: number, chunkZ: number, chunkSize: number) => {
			const minX = math.floor((chunkX * chunkSize) / EXPLORED_CELL);
			const maxX = math.ceil(((chunkX + 1) * chunkSize) / EXPLORED_CELL) - 1;
			const minZ = math.floor((chunkZ * chunkSize) / EXPLORED_CELL);
			const maxZ = math.ceil(((chunkZ + 1) * chunkSize) / EXPLORED_CELL) - 1;

			for (let x = minX; x <= maxX; x++) {
				for (let z = minZ; z <= maxZ; z++) {
					const key = `${x},${z}`;
					if (seenCells.has(key)) continue;
					seenCells.add(key);
					pendingChunks++;
				}
			}
		};
		this.event.loop(5, () => {
			if (pendingChunks === 0) return;
			// ≤100 per report (server clamp); bursts trickle in
			const slice = math.min(pendingChunks, 100);
			pendingChunks -= slice;
			CustomRemotes.achievements.reportChunks.send(slice);
		});

		const update = (terrain: TerrainConfiguration) => {
			loaders.clear();

			Workspace.Terrain.WaterColor = terrain.waterColor.color;
			const config = {
				snowOnly: terrain.snowOnly,
				addSandBelowSeaLevel: terrain.triangleAddSandBelowSeaLevel,
				isLava: terrain.kind === "Lava",
				override: terrain.override,
				generator: terrain.generator,
			};
			const generator = terrain.generator === "Realistic" ? RealisticChunkGenerator : DefaultChunkGenerator;

			switch (terrain.kind) {
				case "Triangle":
					loaders.add(
						new ChunkLoader(
							TriangleChunkRenderer(generator, terrain.resolution, config),
							terrain.loadDistance,
							recordChunk,
						),
					);

					if (terrain.water) {
						loaders.add(new ChunkLoader(WaterTerrainChunkRenderer(), terrain.loadDistance * 2));
					}

					break;
				case "Classic":
					loaders.add(
						new ChunkLoader(
							TerrainChunkRenderer(generator, terrain.foliage, config),
							terrain.loadDistance,
							recordChunk,
						),
					);
					break;
				case "Flat":
				case "Lava":
					loaders.add(
						new ChunkLoader(
							FlatTerrainRenderer(0.5 - 0.01 + (terrain.kind === "Lava" ? -1.5 : 0), 1024, config),
							terrain.loadDistance,
							recordChunk,
						),
					);
					break;
				case "Water":
					loaders.add(new ChunkLoader(WaterTerrainChunkRenderer(), terrain.loadDistance, recordChunk));
					break;
				case "Void":
					break;
			}
		};

		const terrain = this.event.addObservable(playerData.config.fReadonlyCreateBased((c) => c.environment.terrain));
		this.event.subscribeRegistration(() => terrain.subscribeWithCustomEquality(update, Objects.deepEquals, true));
	}
}
