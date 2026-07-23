import { ReplicatedFirst, Workspace } from "@rbxts/services";
import { ServiceIntegrityChecker } from "client/integrity/ServiceIntegrityChecker";
import type { ChunkGenerator, ChunkRenderer } from "client/terrain/ChunkLoader";

type config = {
	readonly snowOnly: boolean;
	readonly generator?: string;
};
export const TerrainChunkRenderer = (
	// Each Actor VM requires its own copy of the generator, so the instance itself cannot be handed over —
	// only its NAME travels, on the load message. This param is kept for factory-signature parity.
	_generator: ChunkGenerator,
	foliage: boolean,
	config?: config,
): ChunkRenderer<true> => {
	// Do not raise this hoping to cut the number of WriteVoxels calls — 32 was measured and it is MUCH
	// slower. The voxel work is proportional to a chunk's bounding VOLUME, and a wider chunk spans more
	// terrain, so its box grows in height as well as in area. Four times fewer chunks each cost far more
	// than four times as much.
	const chunkSize = 16;

	// Measured fill rates: 8 actors 463 chunks/s, 16 at 856, 32 at 951. The pool was the bottleneck up to
	// 16; past that it flattens and the extra VMs only cost memory.
	const actorAmount = 16;

	const folder = new Instance("Folder", ReplicatedFirst);
	folder.Name = "TerrainActors";
	ServiceIntegrityChecker.whitelistInstance(folder);
	const actors: Actor[] = [];
	let selectedActor = 0;
	let readyCount = 0;

	const clearActors = () => {
		// Free the waiters BEFORE the actors go: their release only ever arrives from an actor's Loaded
		// event, so anything still queued afterwards would wait for a message that can no longer be sent.
		//
		// Undefined on the very first call — recreateActors() runs during setup, before the semaphore is
		// constructed, and nothing can be queued that early anyway.
		actorSemaphore?.abandon();

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
		let abandoned = false;

		const q = {
			wait: () => {
				if (abandoned) return;
				if (currentCount > 0) {
					currentCount--;
					return;
				}

				let completed = false;
				const resolver = () => (completed = true);
				queue.push(resolver);

				while (!completed && !abandoned) {
					task.wait();
				}
			},

			/**
			 * Wake everybody and stop blocking, for when the actors are going away.
			 *
			 * A waiter is only ever released by an actor firing `Loaded`. Destroy the actors while a chunk is
			 * queued and that event can never arrive, so the waiting coroutine spins `task.wait()` for the
			 * rest of the session, holding its dead ChunkLoader alive — one leaked thread every time a
			 * terrain setting changes.
			 */
			abandon: () => {
				abandoned = true;
				while (queue.size() > 0) queue.remove(0)?.();
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
	// undefined once the pool has been cleared; callers may be resuming from an abandoned semaphore
	const findAvailableActor = (): Actor | undefined => {
		const actor = actors[++selectedActor];
		if (actor) return actor;

		return actors[(selectedActor = 0)];
	};

	return {
		chunkSize: chunkSize * 4,

		renderChunk(chunkX: number, chunkZ: number): true {
			actorSemaphore.wait();

			// `wait` yields, and `abandon` wakes it precisely BECAUSE the actors are going away — so by
			// the time it returns there may be no pool left to send to. Changing any terrain setting
			// while a chunk is queued lands here.
			const actor = findAvailableActor();
			if (!actor) return true;

			actor.SendMessage(
				"load",
				chunkX,
				chunkZ,
				foliage,
				config?.snowOnly ?? false,
				config?.generator ?? "Default",
			);

			return true;
		},
		destroyChunk(chunkX: number, chunkZ: number): void {
			findAvailableActor()?.SendMessage("unload", chunkX, chunkZ);
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
