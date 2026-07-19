import { RunService, Workspace } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { Objects } from "engine/shared/fixes/Objects";
import { GameDefinitions } from "shared/data/GameDefinitions";

/** Generates terrain height */
export interface ChunkGenerator {
	getHeight(x: number, z: number): number;
}

/** Generates terrain height */
export interface ChunkRenderer<T = defined> {
	readonly chunkSize: number;
	readonly loadDistanceMultiplier?: number;

	renderChunk(chunkX: number, chunkZ: number): T;
	destroyChunk(chunkX: number, chunkZ: number, chunk: T): void;
	unloadAll(chunks: readonly T[]): void;
	destroy(): void;
}

/** Controls chunk loading and unloading in relation to the player position */
export class ChunkLoader<T = defined> extends Component {
	/**
	 * How long one frame may spend starting chunks. Small on purpose: the terrain has to fill in without
	 * the world hitching while it does, and a player flying is the whole reason chunks are streamed at all.
	 */
	private static readonly frameBudget = 0.004;

	private loadedChunks: Record<number, Record<number, { chunk?: T }>> = {};
	private radiusLoaded = 0;
	/** Chunks started since the current fill began; reported with the fill time. */
	private chunksThisFill = 0;

	private readonly loadDistance;
	private readonly loadDistancePow;
	private readonly maxVisibleHeight = 3000 + GameDefinitions.HEIGHT_OFFSET;

	constructor(
		private readonly chunkRenderer: ChunkRenderer<T>,
		loadDistance: number,
		private readonly onChunkGenerated?: (chunkX: number, chunkZ: number, chunkSize: number) => void,
	) {
		super();

		this.loadDistance =
			(loadDistance / chunkRenderer.chunkSize) * (16 * 4) * (chunkRenderer.loadDistanceMultiplier ?? 1);
		this.loadDistancePow = math.pow(this.loadDistance, 2);

		task.spawn(() => this.createChunkLoader());
		this.onDisable(() => {
			chunkRenderer.unloadAll(
				asMap(this.loadedChunks).flatmap((k, v) =>
					asMap(v)
						.filter((k, c) => c.chunk !== undefined)
						.map((k, c) => c.chunk!),
				),
			);

			this.loadedChunks = {};
		});
		this.onDestroy(() => chunkRenderer.destroy());
	}

	private createChunkLoader() {
		if (!game.IsLoaded()) {
			game.Loaded.Wait();
		}

		let prevPosX = math.huge;
		let prevPosZ = math.huge;

		let c = os.clock() as number | undefined;
		while (true as boolean) {
			task.wait();
			if (this.isDestroyed()) return;
			if (!this.isEnabled()) continue;
			if (!Workspace.CurrentCamera) continue;

			if (this.isTooHigh()) {
				for (const [x, c] of pairs(this.loadedChunks)) {
					for (const [y] of pairs(c)) {
						this.unloadChunk(x, y);
					}

					task.wait();
				}

				do {
					task.wait();
				} while (this.isTooHigh());

				// Everything above was just unloaded, so the world has to be rebuilt from ring 0. Without
				// this the radius still reads "filled" and nothing reloads: come back down inside the same
				// chunk and the ground is simply gone until you fly a whole chunk sideways. Rising partway
				// through a fill was worse — loading resumed at whatever ring it reached and the rings below
				// it were never re-emitted, leaving a permanent hole underneath the player.
				this.radiusLoaded = 0;
				continue;
			}

			let pos = Workspace.CurrentCamera?.Focus?.Position ?? Vector3.zero;
			if (pos.X !== pos.X || pos.Y !== pos.Y || pos.Z !== pos.Z) {
				// nan
				pos = Vector3.zero;
			}

			const chunkX = math.floor(pos.X / this.chunkRenderer.chunkSize);
			const chunkZ = math.floor(pos.Z / this.chunkRenderer.chunkSize);

			if (prevPosX !== chunkX || prevPosZ !== chunkZ) {
				this.unloadChunks(chunkX, chunkZ);
				this.radiusLoaded = 0;

				prevPosX = chunkX;
				prevPosZ = chunkZ;

				// Restart the measurement with the fill it measures. Keying it off `c === undefined` instead
				// meant a fill abandoned part-way — every time the camera crosses a chunk boundary, i.e.
				// whenever anyone is flying — kept the old start time and kept counting into the old total,
				// scoring re-loaded chunks twice. The figure was only ever honest standing still, which is
				// the one case nobody needed it for.
				c = os.clock();
				this.chunksThisFill = 0;
			}

			if (this.radiusLoaded < this.loadDistance) {
				// Keep going while this frame still has room, instead of always stopping after one ring.
				// A fixed one-ring-per-frame pace is the worst of both worlds: it idles on a machine that
				// could do ten, and still stutters on one that cannot finish a single ring in time. The
				// budget is what actually protects the frame, so spend it rather than guess at it.
				const deadline = os.clock() + ChunkLoader.frameBudget;
				do {
					this.loadChunksNextSingleRadius(chunkX, chunkZ);

					// renderChunk yields, and the loader can be destroyed while it is parked in there —
					// changing any terrain setting rebuilds every loader. Carrying on afterwards writes
					// chunks into an orphaned table and counts them toward the exploration achievement.
					if (this.isDestroyed()) return;
				} while (this.radiusLoaded < this.loadDistance && os.clock() < deadline);

				continue;
			} else if (c !== undefined) {
				// How long the terrain took to fill in. Eyeballing "did that feel faster" cannot resolve a
				// 20% change, so anything tuned here — the frame budget, the actor count, the chunk size —
				// gets compared against this number instead of against an impression. Studio only.
				if (RunService.IsStudio()) {
					const seconds = os.clock() - c;
					print(
						`[terrain] filled in ${string.format("%.2f", seconds)}s: ` +
							`${this.chunksThisFill} chunks across ${this.loadDistance} rings ` +
							`(${string.format("%.0f", this.chunksThisFill / math.max(seconds, 0.001))}/s)`,
					);
				}

				c = undefined;
			}
		}
	}

	private generateChunk(chunkX: number, chunkZ: number) {
		return this.chunkRenderer.renderChunk(chunkX, chunkZ);
	}

	private loadChunk(chunkX: number, chunkZ: number) {
		if (this.loadedChunks[chunkX]?.[chunkZ]) {
			return;
		}

		(this.loadedChunks[chunkX] ??= {})[chunkZ] = {};
		this.chunksThisFill++;
		this.loadedChunks[chunkX][chunkZ].chunk = this.generateChunk(chunkX, chunkZ);
		this.onChunkGenerated?.(chunkX, chunkZ, this.chunkRenderer.chunkSize);
	}
	private unloadChunk(chunkX: number, chunkZ: number) {
		if (!this.loadedChunks[chunkX]?.[chunkZ]) {
			return;
		}

		const chunk = this.loadedChunks[chunkX][chunkZ].chunk;

		delete this.loadedChunks[chunkX][chunkZ];
		if (Objects.size(this.loadedChunks[chunkX]) === 0) {
			delete this.loadedChunks[chunkX];
		}

		if (chunk !== undefined) {
			this.chunkRenderer.destroyChunk(chunkX, chunkZ, chunk);
		}
	}

	private shouldBeLoaded(chunkX: number, chunkZ: number, centerX: number, centerZ: number) {
		if (math.pow(chunkX - centerX, 2) + math.pow(chunkZ - centerZ, 2) > this.loadDistancePow) {
			return false;
		}

		return true;
	}
	private isTooHigh() {
		return Workspace.CurrentCamera && Workspace.CurrentCamera.Focus.Position.Y >= this.maxVisibleHeight;
	}

	private unloadChunks(centerX: number, centerZ: number) {
		for (const [chunkX, data] of pairs(this.loadedChunks)) {
			for (const [chunkZ, _] of pairs(data)) {
				if (this.loadedChunks[chunkX]?.[chunkZ] && this.loadedChunks[chunkX][chunkZ].chunk === undefined) {
					continue;
				}
				if (this.shouldBeLoaded(chunkX, chunkZ, centerX, centerZ)) {
					continue;
				}

				this.unloadChunk(chunkX, chunkZ);
			}
		}
	}

	private loadChunksNextSingleRadius(centerX: number, centerZ: number) {
		const size = this.radiusLoaded++;

		for (let num = -size; num <= size; num++) {
			for (const [x, z] of [
				[num, -size],
				[-size, num],
				[num, size],
				[size, num],
			]) {
				const chunkX = centerX + x;
				const chunkZ = centerZ + z;

				if (this.loadedChunks[chunkX]?.[chunkZ]) continue;
				if (!this.shouldBeLoaded(chunkX, chunkZ, centerX, centerZ)) continue;

				this.loadChunk(chunkX, chunkZ);
			}
		}
	}
}
