# Terrain Generation — CPU Optimization Options

Living design / theory doc for a team decision on cutting the CPU cost of Classic (voxel) terrain
generation. It covers what was measured, why it matters even at max settings, the full option space
(bit-exact and not), how the options combine, caching implementation mechanics (where a cache can
live given Actor-VM isolation, plus eviction/GC), a comparison matrix, and the open questions whose
answers pick the path.

> **Bold constraint from the outset:** output must not change (bit-exact) unless a change is
> explicitly opted into as a *quality setting*. Trading memory for CPU is acceptable and generally
> favourable on Roblox — see [Memory budget in practice](#memory-budget-in-practice).

> ## ⚠️ SCOPE — measured on Classic/Realistic at max settings; read this before generalising
>
> The capture behind this doc is **Classic voxel terrain** (`InfiniteTerrainActor`) + the **Realistic**
> generator at max load distance and max quality — deliberately a ceiling-finding stress test. The
> shipped defaults are **`kind: "Triangle"`, `generator: "Default"`, `loadDistance: 24`,
> `resolution: 8`** (`PlayerConfig.ts`).
>
> **The generators are shared between renderers.** `TerrainController` passes the same
> `ChunkGenerator` into either renderer, and `TriangleChunkRenderer` calls the same
> `generator.getHeight`. So generator-level findings **do** transfer; pipeline-level ones do not:
>
> | Finding | Transfers to Triangle? |
> |---|---|
> | Option 0 — land-gating (in `RealisticChunkGenerator`) | ✅ shared generator |
> | **Option 4 — coarse interpolation (~3×, generator-level)** | ✅ **pays on both renderers** |
> | Option 2 — flatten `heights` | ❌ Classic-only (`InfiniteTerrainActor`) |
> | Option 5 — drop `ReadVoxels` | ❌ Classic-only |
> | Actor parallelism / serial phase (§3) | ❌ Classic-only — **Triangle has no Actors at all** |
>
> **But sample density differs by ~80×.** Classic samples 324 heights per 64-stud chunk
> (0.079/sq stud); Triangle samples 4 per square × `resolution²` squares per 512-stud chunk — 256 at
> the default resolution 8 (0.00098/sq stud). `getHeight` is therefore a far smaller share of
> Triangle's cost.
>
> **What Triangle's cost probably *is*, and this doc does not cover it:**
> `TriangleChunkRenderer.renderChunk` has no Actor, `SendMessage`, or `task.synchronize` — it creates
> 4 wedges per square **inline on the main thread**, throttled only by `if (chunkResolution > 1 &&
> math.random() > 0.8) task.wait()`. At defaults that is **256 parts/chunk**; with `chunkSize 512` and
> `loadDistanceMultiplier 2`, the load formula `(24/512) × 64 × 2` ≈ **6 rings ≈ 113 chunks ≈ 29,000
> parts**, and at `loadDistance 96` ≈ 24 rings ≈ 1,810 chunks ≈ **~460,000 parts**. *(Derived from the
> code, not measured.)*
>
> **Implication:** "players avoid high load distance because it's CPU-heavy" is more plausibly
> explained on the default path by **part count**, not generation. **This has now been measured —
> see [§1b](#1b-the-triangle-default-path--measured). The cost is culling, not noise, and it changes
> the recommendation for most players.**

---

## Contents

1. [The measurement](#1-the-measurement)
2. [Why it matters even at max settings](#2-why-it-matters-even-at-max-settings)
3. [Parallelism is already correct](#3-parallelism-is-already-correct)
4. [Options](#4-options)
5. [How the options combine](#5-how-the-options-combine)
6. [Caching — implementation mechanics](#6-caching--implementation-mechanics)
7. [Memory budget in practice](#memory-budget-in-practice)
8. [Comparison matrix](#8-comparison-matrix)
9. [Decision framework](#9-decision-framework)
10. [Recommendation](#10-recommendation)
11. [How to verify & benchmark](#11-how-to-verify--benchmark)
12. [Appendix — key files](#appendix--key-files)

---

## 1. The measurement

Capture: 438 frames, Classic voxel terrain (`InfiniteTerrainActor`), taken while streaming (camera
moving into terrain), on strong hardware (12 cores, discrete GPU via Sober), **max quality / max
render**.

| Metric | Value |
|---|---|
| Frames captured | 438 |
| CPU frame time (median / mean / max) | 10.55 / 10.60 / 14.4 ms |
| Frames jobs-heavy | **438 / 438** |
| Frames rendering-heavy / GPU-heavy | 0 / 0 |
| GPU time | ~3.1 ms (idle) |

### Where the time goes

Totals are **summed across worker threads over the whole capture** (aggregate worker-time, not
main-thread frame cost). `resumeVMThreads` (2117 ms) ≈ `Generate chunk` (2107 ms) → essentially all
script execution during the capture is terrain generation.

| Stage | Total (ms) | Share of chunk-gen | Phase |
|---|---|---|---|
| **Generate heights** (noise sampling) | 1238.8 | **58.8%** | parallel |
| Build voxel grid (material/slope classify) | 544.9 | 25.9% | parallel |
| Read voxels (`Terrain:ReadVoxels`) | 309.9 | 14.7% | parallel |
| Compute region | 1.1 | — | parallel |
| Write voxels (`Terrain:WriteVoxels`) | 120.1 | *serial* | serial |
| Place foliage (Instance creation) | 8.1 | *serial* | serial |

### Cost model for one chunk

- Chunk is 16×16 voxels; the height pass samples an **18×18 grid** (a 2-wide skirt feeds slope), so
  **324 `getHeight()` calls per chunk**.
- `RealisticChunkGenerator.getHeight` is **~26 `math.noise` calls per sample**: warp 2, continent 3,
  erosion 2, ridged/pv 3, hills 3, slope 3, detail 5, grain 3, mesa 2 (+ up to 4 more in mesa country).
- **≈ 8,400 `math.noise` calls per chunk.** That is the hotspot mechanism.
- `DefaultChunkGenerator` is far cheaper (`terrainData.noises` octaves + `TerrainMask`, no fbm stack).

---

## 1b. The Triangle (default) path — measured

Capture: **Triangle / Default / loadDistance 24 / resolution 8 / no water**, 64 frames, **flying into
unexplored terrain**.

**Despite that, this capture contains no terrain generation.** No `Generating height` /
`Generating triangles` markers appear at all; `Script::$Script` totals 23.6 ms over 64 frames =
**0.37 ms/frame** of all Luau, versus 5.19 ms/frame in the Classic capture; and frame time is locked
(median 4.167 ms, max 4.220 ms, **stddev 0.0149 ms**).

**Why — the window is too short for Triangle's chunk size, not evidence that flight is free:**

| | Classic capture | This Triangle capture |
|---|---|---|
| Frames / wall time | 438 ≈ **4.6 s** | 64 ≈ **0.27 s** |
| Chunk size | 64 studs | **512 studs** |

Generation only fires when the camera crosses a chunk boundary (`ChunkLoader` triggers
`unloadChunks` + `beginFill` on `prevPosX !== chunkX`). Triangle chunks are **8× wider**, so crossings
are 8× rarer per distance flown, and this window is **~17× shorter** — roughly 140× less likely to
catch a burst. A quarter-second between two 512-stud boundaries plausibly contains none.

**So read this capture as the *continuous* cost of flight, with generation bursts excluded** — which
is precisely what makes the culling number below meaningful.

| Metric | Value |
|---|---|
| Frames rendering-heavy | **62 / 64** (Classic was jobs-heavy 438/438) |
| CPU frame time (median) | 4.167 ms |
| GPU time | 1.27 ms (idle) |

### Half the frame is culling

| Marker | Total (ms) | Per frame | Share of frame |
|---|---|---|---|
| `Render::VisibleQuery` | 134.8 | 2.11 | **50.6%** |
| `Render::CullJob` | 133.5 | 2.09 | 50.1% |
| `Render::queryOcclusion` | 126.9 | 1.98 | **47.6%** |

These are one nested stack, not additive: **~2.1 ms of a 4.17 ms frame is visibility/occlusion
culling.** Nothing is moving (`SceneUpdater::updateDynamicParts` 0.70 ms *total*), so this is static-
scene culling, whose cost scales with **object count** — i.e. the ~29,000 wedge parts left behind by
Triangle terrain, culled every frame regardless of whether anything is generating.

Framed correctly: **even while flying through unexplored terrain, half the frame is culling.** That is
the *continuous* cost players pay for having terrain; generation is an *intermittent burst* on top of
it. The continuous cost is the one that never goes away and the one that scales with load distance.

### Consequences — this changes the target for most players

1. **On the default path, generation is not the problem; the parts it leaves behind are.** Generator
   optimizations (Option 0, Option 4) reduce the one-time cost of *making* a chunk. This is the
   permanent per-frame cost of *having* it, and they do not touch it.
2. **Scaling is the real alarm.** Distance 24 ≈ 113 chunks ≈ 29k parts ≈ 2.1 ms culling. Distance 96 ≈
   1,810 chunks ≈ **~463k parts (~16× the objects)** — landing in tens of ms/frame of culling alone.
   *(Indicative projection, not measured; culling uses spatial structures so it will not be perfectly
   linear.)* This explains "players avoid high load distance" far better than noise cost does.
3. **The lever is part count**, which nothing else in this doc addresses: fewer/larger squares (lower
   `chunkResolution`), or consolidating the 4-wedges-per-square into **one mesh per chunk** (~256×
   fewer objects to cull). That is a different workstream from everything in §4.

### Distance 96 — the scaling test, and the decisive result

Same settings, same 64-frame window, flying — only `loadDistance` changed 24 → 96 (~16× the parts).
This capture *does* contain generation (`Generating triangles` / `Generating height` both present).

| Metric | d24 | **d96** | × |
|---|---|---|---|
| CPU frame **median** | 4.167 ms | **22.70 ms** | 5.4× |
| CPU frame **mean** | 4.166 ms | **35.10 ms** | 8.4× |
| CPU frame **max** | 4.220 ms | **418.43 ms** | 99× |
| **stddev** | 0.0149 ms | **64.48 ms** | — |
| `Render::VisibleQuery` | 2.11 | **19.95** | 9.5× |
| `Render::queryOcclusion` | 1.98 | **17.46** | 8.8× |
| `Physics::physicsSteppedTotal` | 0.193 | **10.44** | 54× |
| `Render::Id_Opaque` | 0.111 | **6.75** | 61× |
| `Render::uploadBufferData` | 0.084 | **5.54** | 66× |
| `Script::$Script` (all Luau) | 0.368 | **8.57** | 23× |

A **418 ms frame** — a 0.4-second freeze — with stddev 64 ms. That is the hitching players report.

### ⚠️ Terrain generation is ~2% of the problem

The generation markers are finally present, and they are negligible:

| Marker | Total (ms) | Per frame | Share of 35.10 ms mean frame |
|---|---|---|---|
| `Script::Generating triangles` | 42.75 | 0.668 | 1.9% |
| `Script::Generating height` | 5.77 | 0.090 | 0.3% |
| **Combined generation** | 48.5 | **0.76** | **2.2%** |

Against the per-frame cost of the parts *merely existing*: culling **57%**, physics **30%**, render
submission and buffer upload a further ~12 ms/frame between them.

**Every option in §4 of this document targets that 2.2%.** For the default player path, the generator
is not the bottleneck in any meaningful sense — **object count is**. Optimising `getHeight` cannot
move a number that is 2% of the frame.

**Caveats, stated honestly:**
- Culling scaled **9.5× for 16× the parts** — sub-linear, so spatial acceleration helps, but nowhere
  near enough to rescue it.
- The **54× physics jump** may be partly confounded by gameplay state (a vehicle in contact) rather
  than purely part count. `ContactManagerOnAssemblyAdded` (57 ms) does show new parts entering the
  physics world, but the two cannot be cleanly separated from this data.
- Of the 8.57 ms/frame of script, only 0.76 ms is generation. `Script::delayedThreads` is
  **6.84 ms/frame** — plausibly `ChunkLoader` bookkeeping (`unloadChunks` scans all ~1,810 loaded
  chunks and `loadChunksNextSingleRadius` re-walks 24 rings on *every* boundary crossing), but that
  attribution is **unconfirmed** without the flamegraph.

### The 418 ms freeze is the unload path, not culling

Reported symptom: "horrible frame freezes when the game culls it." The worst frame's breakdown
(`cpu_by_max_time`) locates it:

- `Script::$Script` — **353.89 ms** in one frame
- `Render::CullJob` / `Render::VisibleQuery` — **absent from the max list entirely**

So the freeze is ~354 ms of Luau in a single frame. Culling is the steady ~20 ms/frame tax; the
freeze is separate. **It also cannot be generation** — `Generating triangles` + `Generating height`
total **48.5 ms across the whole 64-frame capture**.

**Likely cause — `unloadChunks` has no frame budget.** `ChunkLoader` budgets loading but not unloading:

| Path | Budgeted? |
|---|---|
| Fill (`loadChunksNextSingleRadius`) | ✅ `const deadline = os.clock() + ChunkLoader.frameBudget` (4 ms), `do…while` |
| **Unload (`unloadChunks`)** | ❌ **bare nested `pairs` loop over every loaded chunk, no yield** |

It fires on every chunk-boundary crossing. At distance 96 (24 rings, ~1,810 loaded chunks) the
trailing crescent falling out of radius is plausibly 24–50 chunks, and Triangle's `destroyChunk` is
`chunk.Destroy()` on a Folder of **256 wedges** — roughly **6,000–13,000 Instances destroyed
synchronously in one frame**.

**It is invisible to the profiler:** Triangle's `destroyChunk` has no `debug.profilebegin` (Classic
has `InfiniteTerrainActor - Unload`; Triangle has none). That matches the 354 ms of *unattributed*
`$Script` exactly. Note the `isTooHigh()` branch *does* `task.wait()` between columns while
unloading — the hazard was recognised there, but not on the normal path.

**Confidence:** the elimination is solid (not culling, not generation, unattributed script). The
attribution to `unloadChunks` is inference from code shape — **add a `debug.profilebegin` around
`destroyChunk` and one capture confirms or refutes it.**

**Fix:** give `unloadChunks` the same deadline treatment as the fill loop — destroy up to a budget per
frame and carry the remainder. Chunks lingering an extra frame or two outside the radius is
imperceptible; a 400 ms freeze is not.

### What actually needs doing on the default path

Ordered by measured share of the frame — none of these are in §4:

0. **Budget `unloadChunks`** (above). Smallest change here, and it targets the *freezes* specifically
   rather than average frame time. Add the `destroyChunk` profile marker at the same time so the next
   capture can confirm the attribution.
1. **Cut object count.** One mesh per chunk instead of 4 wedges per square is ~256× fewer objects to
   cull, submit, and register with physics. This is the single highest-value change for *average*
   frame time. Cheaper interim lever: lower `chunkResolution` (fewer, larger squares).
2. **Take terrain parts out of the physics broadphase** where possible, given physics is ~30% of the
   frame at distance 96.
3. **Investigate `ChunkLoader` bookkeeping at high ring counts** — confirm the `delayedThreads`
   attribution first, then consider incremental unload instead of a full re-scan per boundary crossing.
4. Only then, generator work (§4) — worth ~2% on this path (it remains worthwhile on Classic).

## 1c. Classic vs Triangle — the strategic finding

**Goal context:** the objective is to make the **Realistic** generator the new default (much stronger
visual fidelity). The retreat to `Triangle / Default / 24 / 8` was a performance compromise, not a
preference. The data says that compromise picked the wrong vehicle.

### Head-to-head at max load distance

| | **Classic + Realistic, dist 96** | **Triangle + Default, dist 96** |
|---|---|---|
| Frame median | **10.55 ms** | 22.70 ms |
| Frame **max** | **14.37 ms** | **418.43 ms** |
| **stddev** | **1.24 ms** | **64.48 ms** |
| `Render::VisibleQuery` | **0.295 ms/frame** | 19.95 ms/frame (**68×**) |
| `Physics::physicsSteppedTotal` | **0.055 ms/frame** | 10.44 ms/frame (**190×**) |

The higher-fidelity option is **~2× faster and ~50× smoother, with no freezes.** Roblox voxel Terrain
is *one object*; Triangle is ~460,000 individual parts, and culling/physics scale with Instance count,
not with visual quality.

*Confound, stated:* these are not equal view distances — Triangle's `loadDistanceMultiplier: 2` makes
"96" cover 2× the radius (4× the area). Normalised to Classic's ~6,144-stud radius (≈ Triangle dist
48, ~116k parts), the observed sub-linear curve still puts Triangle around ~6.6 ms/frame of culling —
**still ~20× Classic's**. The gap is structural, not a settings artifact.

### The generator was never Triangle's problem

On Triangle at dist 96, `Generating height` — the generator itself — is **0.090 ms/frame = 0.26%** of
a 35.10 ms frame. Even at 10× the per-sample cost, Realistic would add ~0.9 ms/frame.
**Swapping Default → Realistic on Triangle is nearly free.** What makes Triangle expensive is the 256
wedges per chunk, which are identical regardless of which noise function chose their heights.

### Fidelity scales in opposite directions on the two paths

- **Triangle** — more detail ⇒ finer squares ⇒ more parts ⇒ a **permanent per-frame tax** on culling,
  physics and draw submission. Fidelity and performance are in direct opposition, and the cost is
  unavoidable every frame.
- **Classic** — more detail ⇒ finer voxels ⇒ **still one object**. The cost lands in *generation*,
  which is parallelised across 16 Actors, bursty rather than continuous, and already throttleable via
  `frameBudget` and load distance. It **degrades gracefully**; Triangle does not.

### Consequence for the goal

If **Realistic-as-default** is the objective, **Classic is the structurally correct vehicle** — and
that makes the optimisation work in §4 directly on-target rather than a 2% sideshow: Options 0/2/4/5
all reduce Classic's *only* significant cost.

**Open question that should be answered before acting:** was the retreat to Tri-24-8 based on testing
Realistic on **Classic**, or on **Triangle**? Evaluated on Triangle, Realistic would have looked both
expensive (for reasons unrelated to it) *and* bad (its fine detail is largely aliased away at 64-stud
squares) — a misleading result in both directions.

**Still unverified:** low-end hardware. Classic's generation needs cores for parallel Luau. But its
steady-state cost is ~0.35 ms/frame combined, and generation is the throttleable part — the right
shape for weak devices, whereas Triangle's part-count tax is unavoidable.

## 1d. Per-configuration bottlenecks — each setting has its own nuance

There is no single ranking; each terrain kind has a different cost shape and therefore a different
lever. Optimisations are **not** portable between them.

| Kind | Renderer | Uses generator? | Per-chunk work | Object model | Dominant cost | Lever |
|---|---|---|---|---|---|---|
| **Classic** | `InfiniteTerrainActor` (16 Actors) | ✅ **324 `getHeight` / 64-stud chunk** | noise → voxel build → Read/Write | Roblox Terrain = **1 object** | **generation CPU** (parallel) | §4 Options 0/2/4/5, caching |
| **Triangle** | `TriangleChunkRenderer` (main thread) | ✅ 256 / **512**-stud chunk (~80× lower density) | 256 Instance creations | **~460k parts** @ d96 | **object count** (cull 57%, physics 30%) | mesh consolidation, `resolution`, unload budget |
| **Flat / Lava** | `FlatTerrainRenderer` (main thread) | ❌ **never called** | **1 Part** / 1024-stud chunk (`loadDistanceMultiplier: 4`) | ~1,810 parts @ d96 | negligible | — |
| **Water** | `WaterTerrainChunkRenderer` (main thread) | ❌ **never called** | 1 `WriteVoxels` with **precomputed** arrays | Roblox Terrain = 1 object | negligible | — |
| **Void** | none created | ❌ | none | none | zero | — |

Three consequences:

**1. Generator work reaches only 2 of 6 kinds.** Flat, Lava, Water and Void never call `getHeight`
(Flat is a constant height; Water writes a fixed slab). Options 0 and 4 have that scope ceiling — and
within it, the ~80× sample-density gap makes them worth far more on Classic than on Triangle.

**2. `WaterTerrainChunkRenderer` is a shipping precedent for Option 5.** It calls `ReadVoxels` twice
**at construction** purely to obtain correctly-sized arrays, fills them once, and reuses those same
arrays for every subsequent `WriteVoxels` — never re-reading per chunk. `InfiniteTerrainActor` cannot
copy it verbatim because its region **Y-extent varies per chunk**, whereas Water uses a fixed
`-400..0`. That suggests a cleaner Option 5 variant: **fix the Y-extent and preallocate once**,
trading wasted air voxels for zero per-chunk allocation.

**3. It confirms the freeze diagnosis by contrast.** Which renderers yield while unloading:

| Renderer | `renderChunk` throttle | `destroyChunk` throttle | Objects destroyed |
|---|---|---|---|
| Water | `random() > 0.9 → task.wait()` | ✅ `random() > 0.9 → task.wait()` | — (voxel write) |
| Flat | `random() > 0.95 → task.wait()` | ❌ none | 1 |
| **Triangle** | `random() > 0.8 → task.wait()` | ❌ **none** | **256** |

Triangle is the only renderer destroying something expensive with no yield — neither in `destroyChunk`
nor in `ChunkLoader.unloadChunks`. Water's author added the yield on both sides; Triangle's exists on
only one. That asymmetry is the 418 ms frame.

## 2. Why it matters even at max settings

The capture was max quality, max render, large load distance — **not** expected to be performant, and
10 ms frames there are unremarkable. That does not make the terrain cost uninteresting; it makes it
*measurable*. The key fact:

**Terrain generation cost is independent of graphics quality.** A chunk costs the same noise math,
voxel build, and read/write regardless of quality level. Quality settings move **GPU/render** cost
(idle here); load distance moves **how many** chunks, not the per-chunk cost. Foliage on/off moves
only the small `Sample`/`Place foliage` stages.

Therefore every per-chunk cut **trickles down to every settings level, and helps low-end the most**:

- A low-end device has **fewer, slower worker threads**, so the parallel generation phase is a
  *larger* fraction of its frame and there are no spare workers to hide the cost behind.
- The high-end capture is simply the clearest place to see and attribute the cost; the fix lands
  hardest where the device is weakest.

### The goal, stated concretely: make high load distance viable

There is direct player-behaviour evidence for this, independent of any capture: **players already
avoid high load distances because they know it is CPU-heavy.** The feature effectively isn't usable
at its upper range, which is a product problem, not just a profiling curiosity.

That reframes the target, and it is the single most important line in this doc:

- A larger load radius is dominated by **first-time generation** — the initial fill, plus the
  expanding ring as the player moves.
- **Caching only pays on revisits**, so it does *not* address the case that is actually driving
  players away from the setting.
- Therefore the levers that serve the stated goal are the **per-chunk cost cuts** (Options 0, 2, 5)
  and, if a quality setting is acceptable, **interpolation** (Option 4) — not caching.

**Implication for the decision:** prioritise the settings-independent per-chunk cuts (Options 0, 2, 5).
They scale down to the devices that need them *and* they are what makes a bigger radius affordable.
Caching (Option 1) is a separate, revisit-shaped bet — worth doing on its own merits, but it is not
what unlocks load distance.

---

## 3. Parallelism is already correct

Do not spend effort "parallelizing" this — it already is, properly:

- 16 pooled Actors, round-robin dispatch with a semaphore (`TerrainChunkRenderer.ts`).
- `BindToMessageParallel` runs the heavy compute off the main thread; `task.synchronize()` sits
  **after** all compute, so only `WriteVoxels` (120 ms) + foliage Instance creation (8 ms) run serial
  — the two operations that *must* be serial. **94% of terrain work is in the parallel phase.**
- The ceiling is **worker-thread count (cores), not Actor count.** Measured fill rate: 8 actors →
  463 chunks/s, 16 → 856, 32 → 951. Doubling 16→32 buys only +11% — already core-bound. More Actors
  will not help.

### Parallelism is a narrow tool — and terrain is one of the few things it fits

Roblox's scripting model was designed single-threaded; parallel Luau is a retrofit. Its restrictions —
no Instance writes in the parallel phase, read-only DataModel access, isolated Actor VMs with no
shared memory — are simultaneously **what makes it safe** and **what makes it applicable to almost
nothing**. Those are the same fact from either end, and the practical result is that most games ignore
parallel Luau entirely, because most game logic is exactly the mutate-the-DataModel work it forbids.

The workloads that *do* fit are pure computation over read-only data, partitioned into independent
units. **Terrain generation is one of the rare genuine fits:** each chunk is independent, `getHeight`
is a pure function of `(x, z)`, and nothing touches an Instance until the `task.synchronize()`
boundary before `WriteVoxels` and foliage creation.

Two consequences for this decision:

1. **This lever is already pulled, and there isn't another one.** The terrain system is exploiting an
   opportunity most of the codebase can't. There is no "just parallelize more" available — not here
   (already core-bound at 16 Actors) and not for the game logic elsewhere. The remaining levers are
   per-chunk **cost**, not more concurrency.
2. **Don't reduce the current Actor usage.** For the record, since the narrowness can read as fragility:
   the failure mode of misusing parallel Luau is a *refused* operation, not silent corruption (the docs
   say instance modification "cannot occur" / "is not supported" in parallel phases — whether that is a
   hard error or undefined is not stated, so rely on neither). And this system has no race surface at
   all: chunks are **X/Z-disjoint**, `heights` is local to each message handler, and the shared module
   state (`terrainData`, `generators`, `materialEnums`) is read-only after init. It produces correct
   terrain at 856 chunks/s today.

**The one way to introduce a real race here is shared mutable state** — i.e. a `SharedTable` cache
(design B in §6), where concurrent read-modify-write can lose updates. Everything else in this system
is race-free because Actors share nothing. That is an argument for **design A**, and a reason to be
conservative about adding cross-Actor mutable state at all.

Consequence: "438/438 frames jobs-heavy" is the **expected** signature of the parallel phase being
full during streaming, not a bug.

> **Unverified inference — flagged deliberately.** An earlier draft of this doc claimed "frame time
> tracks the synchronize barrier; the main thread waits for the slowest worker's chunk." The
> multithreading docs do **not** describe frame-level barrier timing, and the parallel phase is
> time-sliced across frames, so that was inference presented as fact. Treat it as a hypothesis.

### The consequence that actually matters: parallel work ≠ main-thread relief

Parallel Luau is **narrowly applicable** — pure computation with read-only DataModel access; it cannot
create Instances or write most properties. In practice the main thread still dominates a Roblox
frame, and terrain generation is one of the few workloads that fits the parallel model well.

This cuts against optimizing only the parallel side: **94% of terrain work is already off the main
thread, so shaving it makes *workers* finish sooner — it does not directly relieve the main thread.**
If the main thread is the real frame constraint, the terrain costs that matter to it are:

- the **serial phase** — `WriteVoxels` (120 ms) + foliage Instance creation (8 ms);
- the **`ChunkLoader` dispatch loop**, which holds a **4 ms/frame budget**
  (`ChunkLoader.frameBudget = 0.004`) on a ~10.5 ms frame.

How much of that 4 ms is actual main-thread CPU versus yielding on `actorSemaphore.wait()` is **not
established** — the totals quoted in this doc are summed across threads. **Action:** re-read the
capture's `RBX Main` thread specifically before assuming which side to optimize.

---

## 4. Options

Each option notes: what it cuts, whether it's bit-exact, whether it helps *first-time generation*
vs *revisits*, expected impact, and the risk / how to verify. See [§8](#8-comparison-matrix) for the
matrix and [§5](#5-how-the-options-combine) for how they stack.

### 0. Applied — bit-exact micro-cuts (in `RealisticChunkGenerator.ts`)

**Land-gating.** `ridge`, `hills`, `grain`, and the whole `mesa` block are each multiplied by
`land`, and `smoothClamp01` returns **exactly 0** past the continental shelf. Over open water those
terms are exactly zero regardless of their noise, so we were computing **11 of the 26 noise calls**
(pv 3 + hills 3 + grain 3 + mesa 2) plus their fbm arithmetic and multiplying by zero. Gating them
behind `if (land > 0)` is **bit-exact** (`0 × finite = 0`).

- Saves ~42% of per-sample noise **on ocean/shelf voxels**; **0% over land**. Data-dependent.

**Warp CSE.** `x * WARP_FREQ` / `z * WARP_FREQ` were each computed twice; hoisted. Trivial, exact.

Status: **applied, compiles.** Wants a playtest sanity check even though it is provably identical.

### 2. Flatten the `heights` grid (bit-exact, universal, small)

`heights` is a nested table keyed by **world voxel coordinates** (`heights[x][z]`, e.g.
`heights[12344][7301]`). Those keys land in Lua's hash part → two hash lookups per access, read
~2,300×/chunk in the Build-voxel-grid neighbour loop plus written 324×. Replace with a **dense
0-based flat array** (`heights[(x - baseX) * 18 + (z - baseZ)]`) → array part, one indexed access.
Output-identical, helps both hot loops, helps first-time gen. Small but free. Matches the repo's
"flat arrays over nested tables" guidance.

### 5. Drop the `ReadVoxels` allocator (bit-exact*, universal, ~15%)

`Generate chunk` calls `terrain.ReadVoxels(region, 4)` before writing, but **the read-back data is
never used** — grep confirms `materials`/`occupancy` are only consumed via `.Size`, then overwritten,
then handed to `WriteVoxels`. `ReadVoxels` is functioning purely as an **allocator**: `WriteVoxels`
needs fully-populated, correctly-sized arrays, and the read is the idiomatic way to get them pre-sized
and Air-filled. The loop overwrites solid/water cells and **skips air cells** (`if (occupancy <= 0)
continue`), leaning on the read having put Air there. For a first-time chunk this reads an all-Air
region and discards it — ~**309 ms / 14.7%** of chunk gen spent allocating.

Replace it: build the arrays with `table.create(size, Enum.Material.Air)` / `table.create(size, 0)`
and skip `ReadVoxels`.

- **Bit-exact here (\*under an assumption):** a chunk's region is always Air before generation —
  unload does `FillBlock(region, Air)` over the full column, first load starts empty — so there is no
  pre-existing terrain for the read to preserve. If regions ever carried foreign terrain the
  generator doesn't rewrite, the read would matter.
- **Viability: verified.** The official `WriteVoxels` sample constructs `materials`/`occupancy`
  **manually** as nested Lua tables (1-based `[x][y][z]`, `Enum.Material` values and numbers), so the
  arrays do **not** have to come from `ReadVoxels`. This option is possible.
- **Still assumptions (docs silent):** whether `nil` cells are permitted — so fill every cell, which
  is the plan regardless — and the error behaviour on a malformed/mis-sized array.
- **Implementation detail:** `ReadVoxels`' return exposes `.Size`, which the code currently reads
  (`materials.Size.X/Y/Z`). Hand-built tables have no `.Size`; derive dimensions from the region and
  resolution instead.
- **Must be measured, not assumed:** self-building means initializing the whole volume; `table.create`
  does that natively, but `ReadVoxels` on a sparse Air region may already be fast. Benchmark.
- Unlike caching, this **helps first-time generation** — the case the capture actually measured.

### 1. Caching — trade memory for CPU (bit-exact)

Caching reuses the **exact** previously-computed value (`getHeight` is a pure function of `(x, z)`,
so a cached value equals a recomputed one bit-for-bit), so unlike interpolation it does not change
output. Full mechanics — where it lives, eviction, GC — are in [§6](#6-caching--implementation-mechanics).
Three granularities, increasing memory for increasing CPU saved:

| Variant | What it stores | Skips on hit | Memory / chunk | Complexity |
|---|---|---|---|---|
| **1A. Shared height cache** | one height per world voxel `(x,z)` | shared skirts + revisits | ~8 B × voxels visited | high (`SharedTable`) |
| **1B. Chunk heights-grid cache** | the 18×18 height grid per chunk | `Generate heights` (the 59%) | ~2.6 KB | medium |
| **1C. Full voxel cache** | `materials` + `occupancy` per chunk | *all* generation; revisit = `WriteVoxels` only | few 100 KB – ~1 MB | medium |

#### When caching actually helps

- Helps **revisits** (fly away, come back — the chunk unloaded and would otherwise regenerate) and,
  for 1A, the **~21% skirt** neighbours resample.
- Does **nothing** for **first-time exploration** — there is no prior value to reuse. The profiled
  capture (flying *into* terrain) is largely first-time, so caching would not have moved that number.

This is the pivotal caveat: caching's value is entirely a function of the **player movement pattern**
([§9 Q1](#9-decision-framework)).

### 4. Coarse-grid interpolation — the ~3× win we are NOT taking by default (changes output)

The standard terrain optimization: the low-frequency control fields (`continent`, `erosion`, `pv`,
`warp`, `mesa`, `slope`) barely change across a 64-stud chunk, so sample them on a coarse lattice
(chunk corners / every N voxels) and bilinearly interpolate, sampling only high-frequency
`detail`/`grain` per voxel. Cuts ~26 noise/sample toward ~8 — roughly **3× fewer noise calls** — and
it **helps first-time generation**, the case caching can't touch.

**Why it's excluded by default:** interpolation ≠ exact sampling, so terrain shape shifts subtly. The
generator is heavily art-directed (mesas, coastlines, ridge masks), so this is a real visual change —
that, and only that, is the objection.

**Cross-client divergence is NOT an objection here.** An earlier draft of this doc argued a per-device
toggle would be dangerous because clients would disagree on collidable ground. That was wrong:
`PlayerSettingsEnvironment.ts` already lets each player independently pick terrain **Type**
(Classic / Triangle / Flat / Water / Lava / **Void**), **Shape** (Default / Realistic), load distance,
resolution, water, foliage, snow-only and material override — all per-player client config applied
locally. One player can be on **Void** (no terrain at all) while another has full mountains. Terrain
divergence between clients is already **total and by design**; players coordinate settings socially.
A detail toggle would be *strictly less* divergent than what Type/Shape already permit.

**Option for the team:** expose it as a **quality setting** ("Terrain detail: High/Balanced"), which
is consistent with every other terrain option already shipped. This is the only route to a *large*
cut for outward exploration — the case that matters most (see §2).

### 3. Reduce *how much* we generate (config, not per-chunk shape)

- **Load distance / generation rate.** The frame budget (`ChunkLoader.frameBudget = 4 ms`) and load
  radius set how much generation competes for workers. Already player-configurable.
- **Chunk size is already tuned** — 16 was measured optimal; larger chunks cost *more* than
  proportionally because voxel work scales with bounding **volume** (don't raise it).

### Considered and rejected: parallel `WriteVoxels`

**The proposal.** Chunk regions are X/Z-aligned and non-overlapping *by definition*, so no two Actors
ever write the same voxel. If the parallel-phase write restriction could be bypassed, all 16 Actors
could write concurrently and the serial phase would disappear.

**The premise is correct** — the disjointness argument is sound; there genuinely is no overwrite risk
between chunks. It is rejected for three other reasons:

1. **The restriction guards the engine's state, not yours.** `WriteVoxels` mutates the terrain store's
   internal bookkeeping — region allocation, spatial index, dirty-marking for the mesher, physics
   collision update — all shared across writes regardless of which voxels are targeted. Disjoint
   voxels ≠ disjoint engine state. *(This is a model of the internals, **not** documented — the docs
   state only that `WriteVoxels` must be called in the serial phase, never why.)*
2. **There is no override.** Parallel-phase write restrictions are not a toggle; no sanctioned API
   bypasses `task.synchronize()`. The proposal is hypothetical regardless of its merits.
3. **The payoff is ~5%, on the wrong 6% of the work** — decisive:

| | ms | share of terrain work |
|---|---|---|
| Parallel phase (heights + read + build) | 2107.7 | **94.3%** |
| `WriteVoxels` (serial) | 120.1 | 5.4% |
| Place foliage (serial) | 8.1 | 0.4% |

Deleting the serial phase *entirely* caps at **5.7%**; parallelizing it saves some fraction of that.
The 94% that dominates is already parallel, and Option 4 on the height stack is worth ~37% of total
terrain time. The serial write is not what limits throughput.

**Worth measuring anyway:** if the serial phase creates a *queuing* bottleneck — 16 Actors funnelling
through one serial slot per frame, blocked waiting to synchronize — its effective cost could exceed
its 120 ms of CPU. Measurable via serial-phase occupancy vs Actor throughput in a capture. If that
turns out to be real, the fix is reducing or batching serial-phase work, not parallel writes.

---

## 5. How the options combine

The cuts are largely **orthogonal and stack**:

- **0 (land-gating) + 5 (drop ReadVoxels) + 2 (flatten heights)** are independent bit-exact cuts to
  different parts of the same pipeline (noise / allocation / table layout). Apply all three.
- **Caching (1) sits on top.** A cache *hit* skips the generation the cuts optimize; a cache *miss*
  pays the (now-cheaper) generation. So the cuts reduce **miss cost**, caching reduces **miss
  frequency** — complementary, not competing.
- **Interpolation (4)** is mutually exclusive with bit-exactness, but composes with caching (you'd
  cache the interpolated result). If shipped as a quality toggle, it and the bit-exact cuts coexist:
  the bit-exact path is the default, the interpolated path is the "Balanced" mode.
- **3 (load distance/rate)** is orthogonal to all of the above — it changes chunk *count*, they change
  chunk *cost*.

Net: there is no either/or between the bit-exact cuts; the real branch points are **caching yes/no**
(movement pattern) and **quality toggle yes/no** (willingness to make terrain shape device-dependent).

---

## 6. Caching — implementation mechanics

### Where the cache can live (the Actor-VM constraint)

Generation runs in **16 isolated Actor VMs** — separate Lua states, no shared memory. So:

- A **per-VM cache** only serves that Actor's own chunks. With round-robin dispatch the hit rate is
  poor and the cache is duplicated up to 16×. This is why the commented-out per-Actor cache in
  `DefaultChunkGenerator` was disabled — it is the wrong scope.

Two viable **shared** designs:

**A) Main-thread round-trip (normal `Map`, message-passed).** The main thread (`TerrainChunkRenderer`)
holds a plain `Map<chunkKey, heightsGrid>`. The Actor sends its result back (via the `Loaded`
BindableEvent or a second message); the main thread caches it. On a revisit, the main thread passes
the cached grid in the `SendMessage("load", …)` payload and the Actor skips `getHeight`.

- Pros: uses only well-understood mechanisms (`Map`, BindableEvent messages). No new concurrency model.
- Cons: the cache lives on the **main VM**, so its GC scans hit the main-thread frame directly (see
  below); plus per-chunk message payload (~324 numbers — cheap, but real).

**B) `SharedTable` (cross-Actor shared store).** Actors read/write a shared store directly, keyed by
chunk. No round-trip.

- Pros: no message round-trip; memory is engine-managed, **outside any single VM's GC** (so it does
  not lengthen the main-thread GC).
- Cons: **it is the only design here that introduces shared mutable state across Actors, and therefore
  the only one with a real race surface** — concurrent read-modify-write on the same key can lose
  updates unless every mutation is atomic. The rest of this system is race-free precisely because
  Actors share nothing (§3). Also: per-access cross-VM overhead; `SharedTable` restricts value types
  (nested `SharedTable`s, not arbitrary Lua arrays; no functions). **Its exact concurrency, memory,
  and performance characteristics are under-documented — treat as a spike to verify before
  committing** (the datatype reference page only lists signatures). Do **not** do a `SharedTable`
  access *per voxel* (1A ≈ 8,400/chunk) — `math.noise` is a fast native call and a shared-table read
  may not beat it. Keep it to **one access per chunk** (1B/1C granularity).

> Rule of thumb: cache at **chunk granularity** (1B/1C), so whichever store you pick is touched once
> per chunk, not thousands of times. 1A's per-voxel granularity is the trap.

### Eviction & GC — what "manage memory" means in Luau

Luau's GC is automatic incremental mark-and-sweep. There is **no manual free**. You manage memory by
managing *references*:

- **Evict by dropping the reference:** `map.delete(key)` (roblox-ts) → `t[k] = nil`. The entry is
  reclaimed on a **later** GC pass, not instantly. This is the only reclaim lever.
- **You cannot force a collection.** Roblox's `collectgarbage` is deprecated/restricted (in practice
  only `"count"`, which reads current Lua memory in KB); the engine paces GC itself. So do **not**
  design around triggering a sweep — design around not holding references you don't need.
- **Bound deterministically**, by chunk **count** or player **distance**, and delete on the way out.
  A distance cap is simplest and needs no memory introspection.
- **Weak tables** (`__mode`) exist but are **nondeterministic** — an entry can vanish on any GC pass,
  so a "revisit is free" cache built on weak refs would silently lose hits. Use explicit delete;
  reserve weak tables for cases where losing an entry is harmless.
- **GC-pause coupling.** The bound keeps the *live heap* small, which keeps each collection's scan
  time low. **Where the cache lives decides which thread pays that scan:** a main-thread `Map`
  (design A) lengthens the **main-frame** GC; a `SharedTable` (design B) sits on the engine heap; a
  per-Actor cache would be paid on a worker (hidden in the parallel phase, but unshared). This is a
  real axis when choosing A vs B — a large 1C cache on the main thread is the worst spot for it.

### Notes on the granularities

- **1B is the sweet spot.** ~2.6 KB/chunk, skips the single biggest slice (59%), small enough that
  its GC footprint is negligible on either store. On a hit the chunk still runs Build voxel grid +
  Read/Write (~40% of gen), but the noise is gone.
- **1C** makes a revisited chunk nearly free (just `WriteVoxels`), but the arrays scale with chunk
  bounding **volume** (grows with terrain height) — a few 100 KB to ~1 MB — and, unlike 1B, it
  **duplicates memory Roblox already spends**: the generated terrain already lives in the engine's
  voxel store, so a Lua copy is a second one. That duplication, plus its GC weight, is why 1B is
  preferred over 1C even though 1C saves more CPU per hit.
- **1A** unifies skirt-sharing and revisits but is per-voxel — see the `SharedTable` trap above.

---

## Memory budget in practice

Trading memory for CPU is generally a **good deal on Roblox**: script execution is effectively
single-threaded per VM, so CPU is the scarce resource and RAM is comparatively free. The cheap caches
(1A ≈ tens of MB, 1B ≈ a few KB/chunk → tens of MB for a whole session) are a non-issue on any modern
device and should not be talked out of on memory grounds. **Bias toward caching.**

Two honest limits keep it from being *unconditionally* "always a win", both worth sizing eviction
against:

- **The client's memory ceiling is well below the device's RAM.** A 4 GB phone does not give the cache
  4 GB — the OS reserves its share, Roblox's own baseline (terrain voxel store, textures, meshes, the
  engine) already spends heavily, and mobile OSes terminate the app on memory pressure rather than
  swap. A crash is a worse outcome than a frame-time hit, so the **ceiling — not physical RAM — is
  the number to size against**. Worth measuring actual client memory on the lowest-end target.
- **Luau GC scales with live heap.** A large *persistent* cache lengthens every incremental GC pass,
  which is itself CPU — so an unbounded cache can partially pay its CPU saving back as GC pauses. This
  is why every variant is bounded. (1B's small grids are cheap to scan; 1C's large arrays move GC time.)

---

## 8. Comparison matrix

| # | Option | What it cuts | Bit-exact | Helps first-time | Helps revisit | Memory | Complexity | Helps low-end |
|---|---|---|---|---|---|---|---|---|
| 0 | Land-gating *(applied)* | 11/26 noise over water | ✅ | ✅ (ocean) | ✅ (ocean) | none | done | ✅ |
| 2 | Flatten `heights` | hash→array lookups | ✅ | ✅ | ✅ | none | low | ✅ |
| 5 | Drop `ReadVoxels` | ~15% (allocation) | ✅\* | ✅ | ✅ | none | low–med | ✅ |
| 1A | Shared height cache | skirt + revisit | ✅ | ~21% (skirt) | ✅ | tens of MB | high | ✅ |
| 1B | Chunk heights cache | `Generate heights` (59%) | ✅ | ❌ | ✅ | ~KB/chunk | medium | ✅ |
| 1C | Full voxel cache | *all* generation | ✅\* | ❌ | ✅ (huge) | ~100 KB–1 MB/chunk | medium | ✅ |
| 4 | Coarse interpolation | ~3× noise | ❌ | ✅ | ✅ | none | med–high | ✅ |
| 3 | Load distance / rate | fewer chunks | n/a (config) | ✅ | ✅ | none | done | ✅ |

\* bit-exact under a stated assumption (5: regions are Air before generation; 1C: same as any cache —
same coords → same voxels).

---

## 9. Decision framework

The bit-exact cuts (0, 2, 5) are unconditional — do them. The two real branch points:

**Q1 — What is the dominant player movement pattern?**
- *Outward exploration* (new terrain most of the time) → caching won't help; the only large lever is
  the interpolation quality toggle (Q2). Lean on 0/2/5.
- *Roaming / back-and-forth over a region* → caching pays. Build **1B** (chunk heights cache).

**Q2 — Is a visible change to terrain *shape* acceptable, as an opt-in quality setting?**
Note this is **not** a cross-client question — per-player terrain divergence is already total (a player
can pick Void and have no terrain at all), so a detail toggle breaks nothing that Type/Shape doesn't
already break. The only real cost is that the art-directed shape shifts for players who opt in.
- *Yes* → Option 4 becomes the "Balanced" mode — the only large cut for first-time gen, i.e. the only
  thing that meaningfully unlocks high load distance.
- *No* → first-time gen is bounded by the bit-exact cuts only; accept the residual or keep advising
  lower load distance on weak devices (Option 3).

**Q3 — What is the lowest-end target's real client memory headroom?**
- Sets the eviction bound (count/distance) for any cache. Measure client memory, not device RAM.

**Q4 — Cache location tolerance?**
- Willing to take `SharedTable` complexity (+ a verification spike) to keep cache GC **off** the main
  thread → design B.
- Prefer only well-understood mechanisms and can absorb the cache's GC on the main frame → design A
  (main-thread round-trip). Given 1B is small, A's GC cost is minor; **A is the lower-risk default.**

---

## 10. Recommendation

Ordered against the stated goal — **make high load distance viable** (§2), which is first-time-generation bound.

0. **First, read `RBX Main` in the capture** to establish whether the main thread or the worker pool is
   the actual frame constraint. Every ordering below assumes worker-side cost matters; if the main
   thread is the limiter, the dispatch loop and serial phase move up instead. Cheap to check, and it
   de-risks everything else.
1. **Keep** the applied land-gating + CSE (Option 0) — free, exact. (Its real-world saving is
   water-fraction dependent and unmeasured; don't count it in projections.)
2. **Benchmark Option 5** (drop `ReadVoxels`) — viability now verified, bit-exact, universal, and it
   targets first-time generation. ~15% of chunk gen *if* `table.create` beats the native read. Likely
   a win and cheap to test, so test it early — but it is unproven until benchmarked.
3. **Do** Option 2 (flatten `heights`) — small, exact, universal, low-risk.
4. **Take Q2 seriously — Option 4 is the only large lever for the actual goal.** Caching cannot unlock
   load distance; interpolation can (~3×). Its one cost is a visible shape change for players who opt
   in, which is consistent with the terrain options already shipped.
5. **Treat caching (Option 1) as a separate, revisit-shaped bet.** Decide on Q1. If roaming is common,
   build **1B** via **design A** (main-thread round-trip) with distance-bounded eviction; do not build
   1A / a per-voxel shared cache without the `SharedTable` spike (Q4). Worth doing on its own merits —
   just don't expect it to move the load-distance problem.

Expected stacking, bit-exact path: 0 (done) + 5 + 2 shave first-time generation universally; 1B then
removes the 59% height cost on any revisit. That is the most aggressive **behaviour-preserving**
result available — but it is incremental, and only the Option 4 toggle changes the order of magnitude.

---

## 11. How to verify & benchmark

**Benchmarking is already built in.** `ChunkLoader` prints, in Studio, `[terrain] filled in X.XXs:
N chunks across R rings (M/s)` at the end of each fill. A/B every change against that `M chunks/s`
number over the same route — it resolves changes eyeballing cannot. Per-stage attribution comes from
the MicroProfiler markers (`InfiniteTerrainActor - Generate heights`, etc.) and the `Summary to JSON`
export used to produce this doc.

**Proving a "bit-exact" change really is exact** (do this before shipping 5 and any cache):
- `getHeight`: sample both old and new over a fixed grid (e.g. a few thousand `(x, z)` including
  ocean, coast, mountain, mesa, and build-area cells) and assert every value is identical. Cheap to
  script in a `*.test.ts` under the terrain module.
- Actor pipeline (Option 5): generate a set of chunks with `ReadVoxels` vs `table.create`, read back
  the written region with `ReadVoxels`, and diff `materials` + `occupancy` cell-by-cell.
- Caching: assert a cache-hit value equals a fresh `getHeight`/regeneration for the same coords
  (guaranteed by purity, but worth a test to catch key-collision bugs).

**Benchmark specifically:**
- Option 5: fill time and `Read voxels` marker with `ReadVoxels` vs `table.create`, on tall (mountain)
  and flat (ocean) regions — the volume difference is where it could swing either way.
- Caching: measure **hit rate** on a representative route before optimizing further; a low hit rate
  means the movement pattern is exploration-dominated (Q1) and caching is the wrong investment.

---

## Appendix — key files

- `src/client/terrain/InfiniteTerrainActor.client.ts` — the worker: height pass, voxel build, write.
- `src/client/terrain/RealisticChunkGenerator.ts` — the expensive `getHeight` (noise stack).
- `src/client/terrain/DefaultChunkGenerator.ts` — the cheap generator (+ disabled per-Actor cache).
- `src/client/terrain/TerrainNoise.ts` — `fbm` / `ridged` / `spline` building blocks.
- `src/client/terrain/TerrainChunkRenderer.ts` — Actor pool, dispatch, measured fill rates.
- `src/client/terrain/ChunkLoader.ts` — load radius, frame budget, fill loop, the built-in fill-time print.
