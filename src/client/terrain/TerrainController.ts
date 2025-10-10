import { ChunkLoader } from "client/terrain/ChunkLoader";
import { DefaultChunkGenerator } from "client/terrain/DefaultChunkGenerator";
import { FlatTerrainRenderer } from "client/terrain/FlatTerrainRenderer";
import { TerrainChunkRenderer } from "client/terrain/TerrainChunkRenderer";
import { TriangleChunkRenderer } from "client/terrain/TriangleChunkRenderer";
import { WaterTerrainChunkRenderer } from "client/terrain/WaterTerrainChunkRenderer";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { HostedService } from "engine/shared/di/HostedService";
import { Objects } from "engine/shared/fixes/Objects";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

@injectable
export class TerrainController extends HostedService {
	constructor(@inject playerData: PlayerDataStorage) {
		super();

		const loaders = this.parent(new ComponentChildren<ChunkLoader>(true));

		const update = (terrain: TerrainConfiguration) => {
			loaders.clear();

			const config = {
				snowOnly: terrain.snowOnly,
				addSandBelowSeaLevel: terrain.triangleAddSandBelowSeaLevel,
				isLava: terrain.kind === "Lava",
				override: terrain.override,
			};

			switch (terrain.kind) {
				case "Triangle":
					loaders.add(
						new ChunkLoader(
							TriangleChunkRenderer(DefaultChunkGenerator, terrain.resolution, config),
							terrain.loadDistance,
						),
					);

					if (terrain.water) {
						loaders.add(new ChunkLoader(WaterTerrainChunkRenderer(), terrain.loadDistance * 2));
					}

					break;
				case "Classic":
					loaders.add(
						new ChunkLoader(
							TerrainChunkRenderer(DefaultChunkGenerator, terrain.foliage, config),
							terrain.loadDistance,
						),
					);
					break;
				case "Flat":
				case "Lava":
					loaders.add(
						new ChunkLoader(
							FlatTerrainRenderer(0.5 - 0.01 + (terrain.kind === "Lava" ? -1.5 : 0), 1024, config),
							terrain.loadDistance,
						),
					);
					break;
				case "Water":
					loaders.add(new ChunkLoader(WaterTerrainChunkRenderer(), terrain.loadDistance));
					break;
				case "Void":
					break;
			}
		};

		const terrain = this.event.addObservable(playerData.config.fReadonlyCreateBased((c) => c.terrain));
		this.event.subscribeRegistration(() => terrain.subscribeWithCustomEquality(update, Objects.deepEquals, true));
	}
}
