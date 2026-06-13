import { ReplicatedFirst, Workspace } from "@rbxts/services";
import { ServiceIntegrityChecker } from "client/integrity/ServiceIntegrityChecker";
import type { ChunkGenerator, ChunkRenderer } from "client/terrain/ChunkLoader";

type config = {
	readonly snowOnly: boolean;
};
export const TerrainChunkRenderer = (
	// each Actor VM builds its own DefaultChunkGenerator; this param is kept only for factory-signature parity
	_generator: ChunkGenerator,
	foliage: boolean,
	config?: config,
): ChunkRenderer<true> => {
	const chunkSize = 16;
	const actorAmount = 8;

	const folder = new Instance("Folder", ReplicatedFirst);
	folder.Name = "TerrainActors";
	ServiceIntegrityChecker.whitelistInstance(folder);
	const actors: Actor[] = [];
	let selectedActor = 0;
	let readyCount = 0;

	const clearActors = () => {
		for (const actor of folder.GetChildren()) {
			if (actor.IsA("Actor")) {
				actor.Destroy();
			}
		}
		actors.clear();
	};
	const recreateActors = () => {
		clearActors();
		readyCount = 0;

		const workerTemplate = script.Parent!.WaitForChild("InfiniteTerrainActor");

		for (let i = 0; i < actorAmount; i++) {
			const actor = new Instance("Actor");

			const ready = new Instance("BindableEvent");
			ready.Name = "Ready";
			ready.Parent = actor;
			ready.Event.Connect(() => readyCount++);

			const loaded = new Instance("BindableEvent");
			loaded.Name = "Loaded";
			loaded.Parent = actor;
			loaded.Event.Connect(() => actorSemaphore.release());

			const worker = workerTemplate.Clone();
			worker.Parent = actor;

			// parent last so the worker LocalScript starts with its Ready/Loaded children present
			actor.Parent = folder;
			actors.push(actor);
		}

		// block until every worker VM is bound, so round-robin dispatch never targets an unbound actor
		while (readyCount < actorAmount) {
			task.wait();
		}
	};
	recreateActors();

	const createSemaphore = (maxCount: number) => {
		const queue: Callback[] = [];
		let currentCount = maxCount;

		const q = {
			wait: () => {
				if (currentCount > 0) {
					currentCount--;
					return;
				}

				let completed = false;
				const resolver = () => (completed = true);
				queue.push(resolver);

				while (!completed) {
					task.wait();
				}
			},
			release: () => {
				if (queue.size() === 0) {
					if (currentCount > maxCount) throw "Trying to release beyond the maximum.";
					currentCount++;
					return;
				}

				queue.remove(0)?.();
			},
		};

		return q;
	};

	const actorSemaphore = createSemaphore(actorAmount);
	const findAvailableActor = () => {
		const actor = actors[++selectedActor];
		if (actor) return actor;

		return actors[(selectedActor = 0)];
	};

	return {
		chunkSize: chunkSize * 4,

		renderChunk(chunkX: number, chunkZ: number): true {
			actorSemaphore.wait();
			findAvailableActor().SendMessage("load", chunkX, chunkZ, foliage, config?.snowOnly ?? false);

			return true;
		},
		destroyChunk(chunkX: number, chunkZ: number): void {
			findAvailableActor().SendMessage("unload", chunkX, chunkZ);
		},
		unloadAll() {
			clearActors();
			Workspace.Terrain.Clear();
			Workspace.Terrain.FindFirstChild("Foliage")?.ClearAllChildren();
		},
		destroy() {
			clearActors();
			folder.Destroy();
		},
	};
};
