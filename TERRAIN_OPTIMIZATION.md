# Terrain Generation — CPU Optimization Options

Working notes on cutting the CPU cost of Classic (voxel) terrain generation, based on a
client MicroProfiler capture. Written for team review before committing the larger changes.

## TL;DR

- Terrain chunk generation is **~99.5% of all Luau execution** while streaming, and the frame
  is CPU/jobs-bound on **every** frame. GPU is idle.
- The parallel-Actor setup is **already correct** — don't "fix" it (see [Parallelism](#parallelism-is-already-correct)).
- The single most expensive step is **height/noise sampling** (`Generate heights`, ~59% of chunk gen).
- The one *transformative* cut (coarse-grid interpolation, ~3×) **changes the output**, so it's out
  unless we accept it as an optional quality setting.
- Under a **bit-exact** (no behaviour change) constraint the levers are: land-gating (done),
  the `heights` table layout, and **caching** — but read [When caching helps](#when-caching-actually-helps)
  first, because caching does **nothing** for first-time exploration, which is the measured hotspot.

---

## The measurement

Capture: 438 frames, Classic voxel terrain (`InfiniteTerrainActor`), captured while streaming
(camera moving into terrain).

| Metric | Value |
|---|---|
| Frames captured | 438 |
| CPU frame time (median / mean / max) | 10.55 / 10.60 / 14.4 ms |
| Frames jobs-heavy | **438 / 438** |
| Frames rendering-heavy / GPU-heavy | 0 / 0 |
| GPU time | ~3.1 ms (idle) |

> Capture hardware was strong (12 cores, discrete GPU via Sober). On a real mobile CPU this cost
> is proportionally **worse** — the workers are fewer and slower.

### Where the time goes

All totals are **summed across worker threads over the whole capture** (i.e. aggregate worker-time,
not main-thread frame cost). `resumeVMThreads` (2117 ms) ≈ `Generate chunk` (2107 ms), so essentially
all script execution during the capture is terrain generation.

| Stage | Total (ms) | Share of chunk-gen | Phase |
|---|---|---|---|
| **Generate heights** (noise sampling) | 1238.8 | **58.8%** | parallel |
| Build voxel grid (material/slope classify) | 544.9 | 25.9% | parallel |
| Read voxels (`Terrain:ReadVoxels`) | 309.9 | 14.7% | parallel |
| Compute region | 1.1 | — | parallel |
| Write voxels (`Terrain:WriteVoxels`) | 120.1 | *serial* | serial |
| Place foliage (Instance creation) | 8.1 | *serial* | serial |

### Cost model for one chunk

- Chunk is 16×16 voxels; the height pass samples an **18×18 grid** (a 2-wide skirt feeds the slope
  calculation), so **324 `getHeight()` calls per chunk**.
- `RealisticChunkGenerator.getHeight` is **~26 `math.noise` calls per sample**:
  warp 2, continent 3, erosion 2, ridged/pv 3, hills 3, slope 3, detail 5, grain 3, mesa 2
  (+ up to 4 more inside mesa country).
- **≈ 8,400 `math.noise` calls per chunk.** That is the hotspot mechanism.
- `DefaultChunkGenerator` is much cheaper (`terrainData.noises` octaves + `TerrainMask`, no fbm stack).

---

## Parallelism is already correct

Do not spend effort "parallelizing" this — it already is, properly:

- 16 pooled Actors, round-robin dispatch with a semaphore (`TerrainChunkRenderer.ts`).
- `BindToMessageParallel` runs the heavy compute off the main thread; `task.synchronize()` is
  placed **after** all compute, so only `WriteVoxels` (120 ms) + foliage Instance creation (8 ms)
  run serial — the two operations that *must* be serial. **94% of terrain work is in the parallel phase.**
- The ceiling is **worker-thread count (cores), not Actor count.** Measured fill rate:
  8 actors → 463 chunks/s, 16 → 856, 32 → 951. Doubling 16→32 buys only +11%, i.e. we are already
  core-bound. Adding Actors will not help.

Consequence: "438/438 frames jobs-heavy" is the **expected** signature of the parallel phase being
full during streaming, not a bug. Frame time during streaming tracks the synchronize barrier — the
main thread waits for the slowest worker's current chunk. So **anything that shortens per-chunk
compute shortens the barrier wait** → higher chunks/s → less streaming hitch.

---

## Options

### 0. Applied — bit-exact micro-cuts (in `RealisticChunkGenerator.ts`)

**Land-gating.** `ridge`, `hills`, `grain`, and the entire `mesa` block are each multiplied by
`land`, and `smoothClamp01` returns **exactly 0** out past the continental shelf. Over open water
those terms are exactly zero regardless of their noise, so we were computing **11 of the 26 noise
calls** (pv 3 + hills 3 + grain 3 + mesa 2) plus their fbm arithmetic and multiplying by zero.
Gating them behind `if (land > 0)` is **bit-exact** (`0 × finite = 0`).

- Saves ~42% of per-sample noise **on ocean/shelf voxels**; **0% over land**.
- Net benefit is data-dependent (how much open water is in view).

**Warp CSE.** `x * WARP_FREQ` / `z * WARP_FREQ` were each computed twice; hoisted. Trivial, exact.

Status: **applied, compiles.** Still wants a playtest + visual sanity check even though it is
provably output-identical.

---

### 1. Caching — trade memory for CPU (bit-exact)

Caching reuses the **exact** previously-computed values, so unlike interpolation it does not change
output. Three granularities, increasing memory for increasing CPU saved:

| Variant | What it stores | Skips on hit | Memory / chunk | Complexity |
|---|---|---|---|---|
| **1A. Shared height cache** | one height per world voxel `(x,z)` | recompute of shared skirts + revisits | ~8 B × voxels visited | high (cross-Actor `SharedTable`) |
| **1B. Chunk heights-grid cache** | the 18×18 height grid per chunk | `Generate heights` (the 59%) | ~2.6 KB | medium |
| **1C. Full voxel cache** | `materials` + `occupancy` arrays per chunk | *all* generation; revisit = `WriteVoxels` only | ~100+ KB (volume-dependent) | medium |

Notes and traps:

- **1A** unifies border-sharing and revisits, but it does a `SharedTable` access **per voxel**
  (~8,400/chunk). `math.noise` is a fast native call; a `SharedTable` read with cross-Actor
  synchronization may **not** be faster. This must be measured before committing — it can easily be
  a net loss. Prefer per-chunk caching (1B/1C) so there is **one** shared-store access per chunk,
  not thousands.
- **1B** is the sweet spot on memory (a few KB/chunk) and skips the single biggest slice. On revisit
  the chunk still re-runs Build voxel grid + Read/Write voxels (~40% of gen), but the noise is gone.
- **1C** makes a revisited chunk nearly free (just the `WriteVoxels`), but the voxel arrays are
  memory-heavy (proportional to the chunk's bounding **volume**, which grows with terrain height).
  Needs tight eviction; not viable to keep thousands.
- All variants need **distance/LRU eviction** keyed off the player, or memory grows unbounded.
- The commented-out cache in `DefaultChunkGenerator` is a **per-Actor** cache — it was disabled
  because round-robin dispatch gives it a poor hit rate and it grew unbounded. A cache only pays if
  it is **shared across Actors** (or held on the main thread and handed to the Actor on the load message).

#### When caching actually helps

This is the crucial caveat for the team:

- Caching helps **revisits** (fly away, come back — the chunk unloaded and would otherwise regenerate)
  and, for 1A only, the **~21% skirt** that neighbours resample.
- Caching does **nothing** for **first-time exploration of new terrain** — there is no prior value to
  reuse. The profiled capture (flying into terrain) is largely first-time generation, so **caching
  would not have moved that number.**

So the decision hinges on the real player pattern:
- If players **roam back and forth** over the same region → 1B/1C are a big win.
- If the pain is **flying outward into unexplored terrain** → caching won't help; see Options 2–4.

---

### 2. Flatten the `heights` grid (bit-exact, universal, small)

`heights` is currently a nested table keyed by **world voxel coordinates** (`heights[x][z]`, e.g.
`heights[12344][7301]`). Those keys land in Lua's hash part, so every access is two hash lookups,
and it is read ~2,300×/chunk in the Build-voxel-grid neighbour loop plus written 324×.

Replace with a **dense 0-based flat array** (`heights[(x - baseX) * 18 + (z - baseZ)]`) → Lua array
part, one indexed access. Output-identical. Helps both hot loops. Small but free and universal
(helps first-time generation too). Aligns with the repo's "flat arrays over nested tables" guidance.

---

### 3. Reduce *how much* we generate (behaviour-adjacent, not output-of-a-chunk)

Doesn't change what a chunk looks like, changes how many we build per frame:

- **Load distance / generation rate.** The frame budget (`ChunkLoader.frameBudget = 4 ms`) and load
  radius directly set how much generation competes for workers. Already player-configurable.
- **Chunk size is already tuned** — 16 was measured as optimal; larger chunks cost more than
  proportionally because voxel work scales with bounding **volume** (don't raise it).

---

### 5. Drop the `ReadVoxels` allocator (bit-exact, universal, ~15%)

`Generate chunk` calls `terrain.ReadVoxels(region, 4)` before writing, but **the read-back data is
never used** — grep confirms the returned `materials`/`occupancy` arrays are only consumed via
`.Size`, then overwritten, then handed to `WriteVoxels`. `ReadVoxels` is functioning purely as an
**allocator**: `WriteVoxels` needs fully-populated, correctly-sized arrays, and the read is the
idiomatic way to get them pre-sized and Air-filled. The generation loop overwrites solid/water cells
and **skips air cells** (`if (occupancy <= 0) continue`), leaning on the read having put Air there.

For a first-time chunk this reads an all-Air region and discards it — ~**309 ms / 14.7%** of chunk
gen spent allocating.

Replace it: build the arrays with `table.create(size, Enum.Material.Air)` / `table.create(size, 0)`
and skip `ReadVoxels`.

- **Bit-exact here** because a chunk's region is always Air before generation — unload does
  `FillBlock(region, Air)` over the full column, and first load starts empty. There is no
  pre-existing terrain or player edit for the read to preserve. (This assumption is what makes it
  safe; if regions ever carried foreign terrain the generator doesn't rewrite, the read would matter.)
- **Must be measured, not assumed:** the loop currently skips air cells, so self-building means
  initializing the whole volume — `table.create` does that natively, but `ReadVoxels` on a sparse
  Air region may already be fast. Benchmark before committing.
- Unlike caching, this **helps first-time generation** — the case the capture actually measured.

### 4. Coarse-grid interpolation — the ~3× win we are NOT taking (changes output)

The standard terrain optimization: the low-frequency control fields (`continent`, `erosion`, `pv`,
`warp`, `mesa`, `slope`) barely change across a 64-stud chunk, so sample them on a coarse lattice
(chunk corners / every N voxels) and bilinearly interpolate, and sample only the high-frequency
`detail`/`grain` per voxel. This cuts ~26 noise/sample toward ~8, roughly **3× fewer noise calls**,
and it helps **first-time generation** — the case caching can't touch.

**Why it's excluded:** interpolation ≠ exact sampling, so the terrain shape shifts subtly. The
generator is heavily art-directed (mesas, coastlines, ridge masks), so this is a real visual change.

**Option for the team:** expose it as a **quality setting** ("Terrain detail: High/Balanced"), so
players on weak devices can opt into the faster path while the default stays bit-identical. This is
the only route to a large cut for outward exploration.

---

## Recommendation

1. **Keep** the applied land-gating + CSE (Option 0) — free, exact.
2. **Benchmark Option 5** (drop the `ReadVoxels` allocator) — bit-exact, universal, and it targets
   the *measured* case (first-time streaming). ~15% of chunk gen is on the table if `table.create`
   beats the native read. Highest expected value among the exact options; do this measurement first.
3. **Do** Option 2 (flatten `heights`) — small, exact, universal, low-risk.
4. **Decide caching (Option 1) on the real player pattern.** If roaming/revisiting is common, build
   **1B** (chunk heights-grid cache, shared or handed via the load message, with LRU eviction).
   Do **not** build 1A without measuring `SharedTable`-per-voxel cost first. Remember caching does
   nothing for first-time exploration.
5. **Discuss Option 4 as a quality toggle** — the only thing that gives a *large* cut to first-time
   exploration, at the cost of device-dependent terrain shape.

## Open questions for the team

- What is the dominant movement pattern — outward exploration (caching won't help) or back-and-forth
  roaming (caching wins)?
- Is a "terrain detail" quality setting acceptable, given it makes terrain shape device-dependent?
- Memory budget on the lowest-end target device — sets the eviction size for any cache.

## Appendix — key files

- `src/client/terrain/InfiniteTerrainActor.client.ts` — the worker: height pass, voxel build, write.
- `src/client/terrain/RealisticChunkGenerator.ts` — the expensive `getHeight` (noise stack).
- `src/client/terrain/DefaultChunkGenerator.ts` — the cheap generator (+ disabled cache).
- `src/client/terrain/TerrainNoise.ts` — `fbm` / `ridged` / `spline` building blocks.
- `src/client/terrain/TerrainChunkRenderer.ts` — Actor pool, dispatch, measured fill rates.
- `src/client/terrain/ChunkLoader.ts` — load radius, frame budget, fill loop.
