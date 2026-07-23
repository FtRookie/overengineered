import { Workspace } from "@rbxts/services";
import { initLavaKillPlane } from "client/controller/KillPlane";
import { Element } from "engine/shared/Element";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { ChunkRenderer } from "client/terrain/ChunkLoader";

const obstaclesFolder = Workspace.WaitForChild("Obstacles");

type config = {
	readonly snowOnly: boolean;
	readonly isLava: boolean;
	readonly override: TerrainConfiguration["override"];
};
// 2048 is the largest part Roblox allows. The load radius is chunkSize-relative, so doubling this
// covers the same distance with a quarter of the parts.
export const FlatTerrainRenderer = (
	height: number,
	chunkSize: number = 2048,
	config?: config,
): ChunkRenderer<Instance> => {
	const parent = Element.create("Folder", { Name: "Flaterra", Parent: obstaclesFolder });

	return {
		chunkSize,
		loadDistanceMultiplier: 4,

		renderChunk(chunkX, chunkZ) {
			if (math.random() > 0.95) {
				task.wait();
			}

			const part = new Instance("Part");
			part.Anchored = true;
			part.CastShadow = false;

			part.Position = new Vector3(
				chunkX * this.chunkSize,
				height + GameDefinitions.HEIGHT_OFFSET,
				chunkZ * this.chunkSize,
			);
			part.Size = new Vector3(this.chunkSize, 2, this.chunkSize);

			if (config?.override?.enabled) {
				part.Material = Enum.Material[config.override.material];
				part.Color = config.override.color.color;
			} else if (config?.isLava) {
				part.Material = Enum.Material.CrackedLava;
				part.Color = Color3.fromRGB(255, 42, 0);
			} else if (config?.snowOnly) {
				part.Material = Enum.Material.Snow;
				part.Color = math.random() > 0.9999 ? new Color3(0.8, 0.8, 0.4) : new Color3(0.8, 0.8, 0.8);
			} else {
				part.Material = Enum.Material.Sand;
				part.Color = Color3.fromRGB(246, 215, 176);
			}

			if (part.Material === Enum.Material.CrackedLava) {
				initLavaKillPlane(part);
			}

			part.Parent = parent;
			return part;
		},
		destroyChunk(chunkX, chunkZ, chunk) {
			chunk.Destroy();
		},
		unloadAll(chunks) {
			for (const chunk of chunks) {
				chunk.Destroy();
			}
		},
		destroy() {
			parent.Destroy();
		},
	};
};
