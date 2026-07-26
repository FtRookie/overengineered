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

	renderChunk(chunkX: number, chunkZ: number): T | undefined;
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

	/**
	 * How long one frame may spend destroying chunks. Separate from the fill budget because the two are
	 * not symmetric: unloading a whole trailing crescent at once is thousands of Instances in a single
	 * synchronous frame, which measured as a 418ms freeze on triangle terrain at high load distance.
	 */
	private static readonly unloadFrameBudget = 0.002;
	/**
	 * Destroyed per frame before the time budget is even consulted. A purely time-boxed sweep can be
	 * outpaced by the fill loop, and a sweep that falls behind accumulates Instances without bound —
	 * the worse failure of the two, since Instances dominate memory.
	 */
	private static readonly unloadMinPerFrame = 8;

	private loadedChunks: Record<number, Record<number, { chunk?: T }>> = {};
	private radiusLoaded = 0;
	/** Chunks started since the current fill began; reported with the fill time. */
	private chunksThisFill = 0;
	/** Set when the center moves; cleared once a full out-of-range sweep completes inside its budget. */
	private unloadPending = false;

	private loadDistance;
	private loadDistancePow;
	private loadDistanceDirty = false;
	private forwardLoading = true;
	private culling = true;
	// Horizontal camera facing, refreshed each frame; forward loading keeps chunks whose offset dots non-negative.
	private frontX = 0;
	private frontZ = 0;

	// Turn-in-place recovery: chunks forward loading skipped this fill, stored as encoded offsets (not instances, so
	// cheap). A large enough facing change harvests the now-frontal ones into the reload queue instead of re-walking.
	private static readonly encodeBias = 4096; // offsets stay within +-bias; bias < stride/2 keeps the pair reversible
	private static readonly encodeStride = 8192;
	private static readonly reharvestCos = math.cos(math.rad(30)); // harvest once the facing turns past this
	private readonly deferred = new Set<number>();
	private readonly reloadX: number[] = [];
	private readonly reloadZ: number[] = [];
	private reloadCursor = 0;
	private harvestFrontX = 0;
	private harvestFrontZ = 0;

	private readonly maxVisibleHeight = 3000 + GameDefinitions.HEIGHT_OFFSET;

	constructor(
		private readonly chunkRenderer: ChunkRenderer<T>,
		loadDistance: number,
		private readonly onChunkGenerated?: (chunkX: number, chunkZ: number, chunkSize: number) => void,
	) {
		super();

		this.loadDistance = this.computeLoadDistance(loadDistance);
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

	private computeLoadDistance(loadDistance: number) {
		return (
			(loadDistance / this.chunkRenderer.chunkSize) * (16 * 4) * (this.chunkRenderer.loadDistanceMultiplier ?? 1)
		);
	}
	/** Change the load radius live: the fill loop reloads outward on an increase, or deloads on a decrease. */
	setLoadDistance(loadDistance: number) {
		const distance = this.computeLoadDistance(loadDistance);
		if (distance === this.loadDistance) return;

		this.loadDistance = distance;
		this.loadDistancePow = math.pow(distance, 2);
		// picked up by the fill loop's center-change branch: unloadChunks (drops outer) + beginFill (refills)
		this.loadDistanceDirty = true;
	}
	/** Load only the frontal 180°. A decrease is picked up on the next center move (behind chunks stop reloading). */
	setForwardLoading(forwardLoading: boolean) {
		this.forwardLoading = forwardLoading;
	}
	/** Enable/disable the distance-based unload sweep. Off leaves already-generated chunks in place. */
	setCulling(culling: boolean) {
		this.culling = culling;
	}

	private createChunkLoader() {
		if (!game.IsLoaded()) {
			game.Loaded.Wait();
		}

		let prevPosX = math.huge;
		let prevPosZ = math.huge;

		let c = os.clock() as number | undefined;

		// Everything that restarts the world also restarts the measurement of it. Keeping the two in one
		// place is the point: they drifted apart once already, and the benchmark then reported a time from
		// one fill against a chunk count summed over several.
		const beginFill = () => {
			this.radiusLoaded = 0;
			this.chunksThisFill = 0;
			// The deferred offsets are relative to the fill center, so a center move (or a fresh fill) invalidates them.
			this.deferred.clear();
			table.clear(this.reloadX);
			table.clear(this.reloadZ);
			this.reloadCursor = 0;
			this.harvestFrontX = this.frontX;
			this.harvestFrontZ = this.frontZ;
			c = os.clock();
		};
		while (true as boolean) {
			task.wait();
			if (this.isDestroyed()) return;
			if (!this.isEnabled()) continue;
			const camera = Workspace.CurrentCamera;
			if (!camera) continue;

			if (this.forwardLoading) {
				const look = camera.CFrame.LookVector;
				const horiz = math.sqrt(look.X * look.X + look.Z * look.Z);
				if (horiz > 0.0001) {
					this.frontX = look.X / horiz;
					this.frontZ = look.Z / horiz;
				}
			}

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
				beginFill();
				continue;
			}

			let pos = Workspace.CurrentCamera?.Focus?.Position ?? Vector3.zero;
			if (pos.X !== pos.X || pos.Y !== pos.Y || pos.Z !== pos.Z) {
				// nan
				pos = Vector3.zero;
			}

			const chunkX = math.floor(pos.X / this.chunkRenderer.chunkSize);
			const chunkZ = math.floor(pos.Z / this.chunkRenderer.chunkSize);

			if (prevPosX !== chunkX || prevPosZ !== chunkZ || this.loadDistanceDirty) {
				this.loadDistanceDirty = false;
				this.unloadPending = true;
				beginFill();

				prevPosX = chunkX;
				prevPosZ = chunkZ;
			} else if (
				this.forwardLoading &&
				this.deferred.size() > 0 &&
				this.frontX * this.harvestFrontX + this.frontZ * this.harvestFrontZ < ChunkLoader.reharvestCos
			) {
				// Stationary but turned: the chunks that were behind and are now in front go back onto the load queue.
				this.harvestDeferred(chunkX, chunkZ);
			}

			// Spread over as many frames as it takes. Chunks lingering a frame or two outside the radius
			// is imperceptible; destroying them all at once is not.
			if (this.unloadPending) {
				this.unloadPending = this.culling ? !this.unloadChunks(chunkX, chunkZ) : false;
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
			}

			// Fill complete: drain any turn-in-place recoveries under the same budget so a hard turn doesn't freeze.
			if (this.reloadCursor < this.reloadX.size()) {
				const deadline = os.clock() + ChunkLoader.frameBudget;
				do {
					this.loadChunk(this.reloadX[this.reloadCursor], this.reloadZ[this.reloadCursor]);
					this.reloadCursor++;
					if (this.isDestroyed()) return;
				} while (this.reloadCursor < this.reloadX.size() && os.clock() < deadline);

				if (this.reloadCursor >= this.reloadX.size()) {
					table.clear(this.reloadX);
					table.clear(this.reloadZ);
					this.reloadCursor = 0;
				}
				continue;
			}

			if (c !== undefined) {
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
		const dx = chunkX - centerX;
		const dz = chunkZ - centerZ;
		const distPow = dx * dx + dz * dz;
		if (distPow > this.loadDistancePow) {
			return false;
		}

		// Behind the camera: drop chunks whose offset points away from the facing. Keep the immediate 3x3 (distPow<=2)
		// so the ground underfoot never culls when looking sideways along a plane's own axis.
		if (this.forwardLoading && distPow > 2 && this.frontX * dx + this.frontZ * dz < 0) {
			return false;
		}

		return true;
	}
	private isTooHigh() {
		return Workspace.CurrentCamera && Workspace.CurrentCamera.Focus.Position.Y >= this.maxVisibleHeight;
	}

	/** Returns whether the sweep finished; a partial sweep resumes next frame against the current center. */
	private unloadChunks(centerX: number, centerZ: number) {
		const deadline = os.clock() + ChunkLoader.unloadFrameBudget;
		let destroyed = 0;

		for (const [chunkX, data] of pairs(this.loadedChunks)) {
			for (const [chunkZ, _] of pairs(data)) {
				if (this.loadedChunks[chunkX]?.[chunkZ] && this.loadedChunks[chunkX][chunkZ].chunk === undefined) {
					continue;
				}
				if (this.shouldBeLoaded(chunkX, chunkZ, centerX, centerZ)) {
					continue;
				}

				this.unloadChunk(chunkX, chunkZ);
				destroyed++;
				if (destroyed >= ChunkLoader.unloadMinPerFrame && os.clock() >= deadline) return false;
			}
		}

		return true;
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

				const distPow = x * x + z * z;
				if (distPow > this.loadDistancePow) continue;
				if (this.forwardLoading && distPow > 2 && this.frontX * x + this.frontZ * z < 0) {
					// Behind the camera: remember the offset so a later turn can recover it without re-walking rings.
					// The ceiling is the behind half of the disc (pi*r^2/2, every behind chunk inside the load radius),
					// so nothing in range is dropped; it only guards unbounded growth, and since rings fill near->far
					// anything it would ever reject is the farthest, which reloads anyway once the center moves.
					if (this.deferred.size() < (this.loadDistancePow * math.pi) / 2) {
						this.deferred.add(
							(x + ChunkLoader.encodeBias) * ChunkLoader.encodeStride + (z + ChunkLoader.encodeBias),
						);
					}
					continue;
				}

				this.loadChunk(chunkX, chunkZ);
			}
		}
	}

	private harvestDeferred(centerX: number, centerZ: number) {
		this.harvestFrontX = this.frontX;
		this.harvestFrontZ = this.frontZ;

		for (const key of this.deferred) {
			const dx = math.floor(key / ChunkLoader.encodeStride) - ChunkLoader.encodeBias;
			const dz = (key % ChunkLoader.encodeStride) - ChunkLoader.encodeBias;
			// Now in the frontal half — queue it; chunks still behind stay stored for a later turn.
			if (this.frontX * dx + this.frontZ * dz >= 0) {
				this.reloadX.push(centerX + dx);
				this.reloadZ.push(centerZ + dz);
				this.deferred.delete(key);
			}
		}
	}
}
