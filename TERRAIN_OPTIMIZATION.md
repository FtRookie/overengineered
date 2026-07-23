# Terrain Optimization — Findings & Decision

Design/theory doc for a team decision on terrain performance. **A decision must be made before most of
the optimization work is worth starting**, because the two candidate terrain paths have opposite cost
shapes and share almost no optimizations. §4 states the fork; §5–§7 are the per-path work that follows
from it.

> **Constraint:** output must not change (bit-exact) unless a change is explicitly opted into as a
> quality setting. Trading memory for CPU is acceptable and generally favourable on Roblox — see §6.4.

---

## Contents

1. [What was measured](#1-what-was-measured)
2. [The two cost shapes](#2-the-two-cost-shapes)
3. [Why the current default exists — and why that verdict is stale](#3-why-the-current-default-exists--and-why-that-verdict-is-stale)
4. [**The decision to be made**](#4-the-decision-to-be-made)
5. [If Triangle stays the default — the work](#5-if-triangle-stays-the-default--the-work)
6. [If Classic becomes the default — the work](#6-if-classic-becomes-the-default--the-work)
7. [Cross-cutting work (applies either way)](#7-cross-cutting-work-applies-either-way)
8. [Changes already applied](#8-changes-already-applied)
9. [How to verify & benchmark](#9-how-to-verify--benchmark)
10. [Appendix — key files & background](#10-appendix--key-files--background)

---

## 1. What was measured

Three MicroProfiler captures, all on the same machine (12 cores, discrete GPU via Sober; reports as
Android). **GPU is idle in all three** — every finding here is CPU.

| # | Configuration | Frames | Median | Mean | Max | stddev | Classified |
|---|---|---|---|---|---|---|---|
| **A** | Classic + Realistic, dist 96, max quality | 438 | **10.55 ms** | 10.60 | **14.37** | **1.24** | jobs-heavy 438/438 |
| **B** | Triangle + Default, dist 24, res 8 | 64 | **4.17 ms** | 4.17 | 4.22 | **0.0149** | rendering-heavy 62/64 |
| **C** | Triangle + Default, dist 96, res 8 | 64 | **22.70 ms** | **35.10** | **418.43** | **64.48** | rendering 48, jobs 16 |

All three were captured while flying into unexplored terrain. Capture B contains **no generation at
all** — no `Generating height`/`Generating triangles` markers, and `Script::$Script` at 0.37 ms/frame.
That is a window-length artifact, not evidence flight is free: Triangle chunks are 512 studs (8× wider
than Classic's 64), and B spans only ~0.27 s versus A's ~4.6 s, so it was ~140× less likely to catch a
boundary crossing. **Read B as the continuous cost of flight with generation bursts excluded** — which
is what makes its culling number meaningful.

### A — Classic, stage breakdown

Totals are summed across worker threads. `resumeVMThreads` (2117 ms) ≈ `Generate chunk` (2107 ms), so
essentially all script execution is terrain generation.

| Stage | Total (ms) | Share of chunk-gen | Phase |
|---|---|---|---|
| **Generate heights** (noise) | 1238.8 | **58.8%** | parallel |
| Build voxel grid | 544.9 | 25.9% | parallel |
| Read voxels (`ReadVoxels`) | 309.9 | 14.7% | parallel |
| Write voxels (`WriteVoxels`) | 120.1 | *serial* | serial |
| Place foliage | 8.1 | *serial* | serial |

### B → C — what changes when load distance goes 24 → 96 (~16× the parts)

| Marker | B (d24) | **C (d96)** | × |
|---|---|---|---|
| `Render::VisibleQuery` | 2.11 | **19.95** | 9.5× |
| `Render::queryOcclusion` | 1.98 | **17.46** | 8.8× |
| `Physics::physicsSteppedTotal` | 0.193 | **10.44** | 54× |
| `Render::Id_Opaque` | 0.111 | **6.75** | 61× |
| `Render::uploadBufferData` | 0.084 | **5.54** | 66× |
| `Script::$Script` (all Luau) | 0.368 | **8.57** | 23× |

**And the generation markers in C are negligible:**

| Marker | Total (ms) | Per frame | Share of 35.10 ms mean frame |
|---|---|---|---|
| `Generating triangles` | 42.75 | 0.668 | 1.9% |
| `Generating height` | 5.77 | 0.090 | 0.3% |
| **Combined** | 48.5 | **0.76** | **2.2%** |

### The 418 ms freeze is the unload path

`cpu_by_max_time` for the worst frame: `Script::$Script` **353.89 ms**, and `Render::CullJob` /
`VisibleQuery` **absent entirely**. So the freeze is ~354 ms of Luau in one frame — not culling. It
also cannot be generation (48.5 ms across the *whole* capture).

Cause: `ChunkLoader` budgeted loading but **not** unloading. `unloadChunks` was a bare loop over every
loaded chunk with no yield, firing on each boundary crossing; at d96 the trailing crescent is
plausibly 24–50 chunks × 256 wedges = **6,000–13,000 Instances destroyed synchronously**. It was
invisible because Triangle's `destroyChunk` had no profile marker. Both are now fixed — see §8.

Corroborating contrast — which renderers yield while unloading:

| Renderer | `renderChunk` throttle | `destroyChunk` throttle | Objects destroyed |
|---|---|---|---|
| Water | `random() > 0.9 → task.wait()` | ✅ yes | — (voxel write) |
| Flat | `random() > 0.95 → task.wait()` | ❌ none | 1 |
| **Triangle** | `random() > 0.8 → task.wait()` | ❌ **none** | **256** |

---

## 2. The two cost shapes

Per-configuration bottlenecks. **Optimizations are not portable between kinds.**

| Kind | Renderer | Uses generator? | Per-chunk work | Object model | Dominant cost |
|---|---|---|---|---|---|
| **Classic** | `InfiniteTerrainActor`, 16 Actors | ✅ **324 `getHeight` / 64-stud chunk** | noise → voxel build → Read/Write | Roblox Terrain = **1 object** | **generation CPU** (parallel) |
| **Triangle** | `TriangleChunkRenderer`, main thread | ✅ `4 × resolution²` / **512**-stud chunk (~80× lower density) | 256 Instance creations @ res 8 | **~460k parts** @ d96 | **object count** (cull 57%, physics 30%) |
| **Flat / Lava** | `FlatTerrainRenderer`, main thread | ❌ never called | **1 Part** / 2048-stud chunk | ~452 parts @ d96 | negligible |
| **Water** | `WaterTerrainChunkRenderer`, main thread | ❌ never called | 1 `WriteVoxels`, **precomputed** arrays | Roblox Terrain = 1 object | negligible |
| **Void** | none created | ❌ | none | none | zero |

Three consequences:

**2.1 — Generator work reaches only 2 of 6 kinds.** Flat, Lava, Water and Void never call `getHeight`.
Within the two that do, the ~80× sample-density gap makes generator work worth far more on Classic.

**2.2 — Fidelity scales in opposite directions.**
- **Triangle** — more detail ⇒ finer squares ⇒ more parts ⇒ a **permanent per-frame tax** on culling,
  physics and draw submission. Fidelity and performance are in direct opposition.
- **Classic** — more detail ⇒ finer voxels ⇒ **still one object**. Cost lands in *generation*, which is
  parallelised across 16 Actors, bursty rather than continuous, and throttleable via `frameBudget` and
  load distance. It **degrades gracefully**; Triangle does not.

**2.3 — Classic has no fidelity dial, and cannot be given one.** `TerrainController` passes
`terrain.resolution` only to `TriangleChunkRenderer`; the GUI matches
(`triangleResolution.setVisibleAndEnabled(isTriangle)`). Roblox Terrain's voxel size is **fixed at 4
studs**, so there is no resolution to turn. Coarsening the height *sampling* and interpolating (§6.3)
cuts generator cost but leaves the voxel pipeline untouched and is a detail reduction at unchanged
voxel size — not a resolution change. **Classic's only performance dial is load distance.**

### Head-to-head at max load distance

| | **A — Classic + Realistic** | **C — Triangle + Default** |
|---|---|---|
| Frame median | **10.55 ms** | 22.70 ms |
| Frame max | **14.37 ms** | **418.43 ms** |
| stddev | **1.24 ms** | **64.48 ms** |
| `Render::VisibleQuery` | **0.295 ms/frame** | 19.95 (**68×**) |
| `Physics::physicsSteppedTotal` | **0.055 ms/frame** | 10.44 (**190×**) |

The higher-fidelity option is ~2× faster and ~50× smoother, with no freezes — because voxel Terrain is
one object while Triangle is ~460k Instances.

*Confound, stated:* not equal view distances. Triangle's `loadDistanceMultiplier: 2` makes "96" cover
2× the radius (4× the area). Normalised to Classic's ~6,144-stud radius (≈ Triangle d48, ~116k parts),
the observed sub-linear curve still puts Triangle near ~6.6 ms/frame of culling — **still ~20×
Classic's**. The gap is structural.

---

## 3. Why the current default exists — and why that verdict is stale

The default is `Triangle / Default / 24 / 8` (`PlayerConfig.ts`). It is a **performance retreat, not a
preference** — the goal is to make **Realistic** the default for its much stronger visual fidelity.

Critically, the retreat **predates the Realistic generator entirely**: it was **Classic + Default**
that was judged too laggy.

| Date | Commit | |
|---|---|---|
| 2024-04-12 | `14f15dd3` "Implement more terrain" | terrain system created (Classic + Triangle together) |
| **2025-06-28** | `94efdcf2` **"set triangle terrain by default (less lagging)"** | ← the verdict |
| **2026-06-13** | `4d73cb0c` **"Fix classic terrain generation"** | ← ~12 months **later** |

**Team history (not derived from git):** Classic's parallelism worked — barely — until a **Roblox
update broke it**. It remained broken through the period the verdict was made, and `4d73cb0c` (which
deleted `InfiniteTerrainActor.ts` and created `InfiniteTerrainActor.client.ts`, i.e. ModuleScript →
LocalScript) restored it.

**So Classic was judged while externally broken.** Reinforcing that: capture A is Classic +
**Realistic** — the *more expensive* generator — at 10.55 ms median with no freezes. Classic +
**Default**, the configuration actually judged laggy, would be cheaper still.

**The verdict does not describe current code. Classic has not been re-evaluated since it was fixed.**

---

## 4. The decision to be made

**Classic is still not the default, and this fork determines which body of work is worth doing.** The
two paths share almost no optimizations, so committing effort before deciding wastes most of it.

### Step 0 — the cheap experiment that informs the decision

Re-measure **Classic + Default** and **Classic + Realistic** on *current* code, at the load distances
players actually use, and compare against captures B and C. Two setting changes and two captures. The
2025 verdict was made against broken parallelism; nothing since has retested it.

Also worth resolving in the same pass: whether the **main thread or the worker pool** is the limiter,
by reading `RBX Main` specifically. All cross-thread totals in §1 are summed across threads.

### The options

| | Path | Implies | Risk |
|---|---|---|---|
| **A** | **Return Classic to default**, pursue §6 | Best fidelity ceiling; cost is generation, which is parallel + throttleable | Needs cores for parallel Luau; **no fidelity dial** (§2.3), so load distance is the only lever on weak devices |
| **B** | **Keep Triangle**, pursue §5 | Known-safe on current hardware at low distance | Fidelity is capped by part count; high load distance may be unreachable; Realistic buys little here (§2.1) |
| **C** | **Both** — Classic default on capable devices, Triangle as the low-end fallback | Best of each | Two paths to maintain; needs a device-capability signal |

### What the data already says about the fork

- **Realistic on Triangle is nearly free but nearly pointless.** `Generating height` is 0.090 ms/frame
  (0.26%); even at 10× cost Realistic adds ~0.9 ms. But at 64-stud squares most of its fine detail is
  aliased away — so it costs little and delivers little.
- **Realistic on Classic is the fidelity win**, and Classic's per-frame steady cost is ~0.35 ms
  combined versus Triangle's ~30 ms at d96.
- **Triangle cannot reach high load distance** without the object-count work in §5 — generation is 2.2%
  of its frame, so no amount of generator optimization moves it.

**Unresolved and material:** none of this is measured on low-end hardware. Classic's generation needs
cores; Triangle's part-count tax is unavoidable. A single low-end capture would de-risk the choice.

---

## 5. If Triangle stays the default — the work

Ordered by measured share of the frame. **None of this is generator work.**

1. **Cut object count.** One mesh per chunk instead of 4 wedges per square is ~256× fewer objects to
   cull, submit, and register with physics. Highest-value change for average frame time. Cheaper
   interim lever: lower `chunkResolution` (fewer, larger squares) — parts scale as `4 × resolution²`.
2. **Take terrain parts out of the physics broadphase** where possible; physics is ~30% of the frame
   at d96.
3. **Investigate `ChunkLoader` bookkeeping at high ring counts.** Of the 8.57 ms/frame of script in C,
   only 0.76 ms is generation; `Script::delayedThreads` is **6.84 ms/frame**. Plausibly `unloadChunks`
   scanning ~1,810 chunks and `loadChunksNextSingleRadius` re-walking 24 rings per boundary crossing —
   **attribution unconfirmed** without the flamegraph.
4. Generator work (§6.3) — worth ~2% here.

**Caveats on the C numbers:** culling scaled 9.5× for 16× parts (sub-linear — spatial acceleration
helps, not enough). The 54× physics jump may be partly confounded by gameplay state (a vehicle in
contact) rather than purely part count; `ContactManagerOnAssemblyAdded` (57 ms) does show parts
entering the physics world, but the two can't be separated from this data.

---

## 6. If Classic becomes the default — the work

Classic's only significant cost is generation: **~26 `math.noise` per sample × 324 samples per chunk ≈
8,400 noise calls/chunk** for Realistic (warp 2, continent 3, erosion 2, ridged 3, hills 3, slope 3,
detail 5, grain 3, mesa 2, + up to 4 in mesa country). `DefaultChunkGenerator` is far cheaper.

### 6.1 Applied — bit-exact micro-cuts

**Land-gating.** `ridge`, `hills`, `grain` and the whole `mesa` block are each multiplied by `land`,
and `smoothClamp01` returns **exactly 0** past the shelf — so over open water those terms are exactly
zero regardless of their noise. Gating them behind `if (land > 0)` skips **11 of 26 noise calls**;
bit-exact (`0 × finite = 0`). Saves ~42% of per-sample noise on ocean, 0% over land — data-dependent,
and its real-world value is unmeasured, so don't count it in projections. Plus **warp CSE**
(`x * WARP_FREQ` was computed twice).

### 6.2 Bit-exact structural cuts

**Flatten the `heights` grid.** Currently a nested table keyed by *world voxel coordinates*
(`heights[12344][7301]`) — hash-part lookups, read ~2,300×/chunk in the neighbour loop plus 324 writes.
A dense 0-based flat array (`heights[(x - baseX) * 18 + (z - baseZ)]`) uses the array part. Universal,
low-risk.

**Drop the `ReadVoxels` allocator (~15%).** The read-back data is **never used** — `materials`/
`occupancy` are consumed only via `.Size`, then overwritten, then passed to `WriteVoxels`. `ReadVoxels`
is functioning purely as an allocator; for a fresh chunk it reads all-Air and discards it.

- **Viability verified:** the official `WriteVoxels` sample constructs the arrays manually as nested
  Lua tables (1-based `[x][y][z]`), so they need not come from `ReadVoxels`.
- **Precedent in this codebase:** `WaterTerrainChunkRenderer` calls `ReadVoxels` twice **at
  construction** purely to obtain sized arrays, then reuses them for every write forever.
  `InfiniteTerrainActor` can't copy it verbatim because its region **Y-extent varies per chunk** (Water
  uses a fixed `-400..0`) — suggesting a variant: **fix the Y-extent and preallocate once**, trading
  wasted air voxels for zero per-chunk allocation.
- **Bit-exact under one assumption:** a chunk's region is always Air before generation (unload does
  `FillBlock(region, Air)`; first load starts empty).
- **Still assumptions (docs silent):** whether `nil` cells are permitted (so fill every cell), and
  error behaviour on mis-sized arrays. Note `ReadVoxels`' return exposes `.Size`, which the code uses —
  hand-built tables won't, so derive dimensions from region/resolution.
- **Must be benchmarked**, not assumed: `table.create` fills natively, but `ReadVoxels` on a sparse Air
  region may already be fast.

### 6.3 Coarse-grid interpolation (~3×) — changes output

Sample the low-frequency control fields (`continent`, `erosion`, `pv`, `warp`, `mesa`, `slope`) on a
coarse lattice and interpolate, sampling only high-frequency `detail`/`grain` per voxel. Cuts ~26
noise/sample toward ~8, and it **helps first-time generation** — the case caching cannot touch.

**Cost:** interpolation ≠ exact sampling, so the art-directed terrain shape shifts subtly. That, and
only that, is the objection — **cross-client divergence is not a concern**, since
`PlayerSettingsEnvironment.ts` already lets each player independently pick Type (including **Void** —
no terrain at all), Shape, load distance and resolution. Terrain divergence between clients is already
total by design.

Note this is **also the closest thing to a Classic fidelity dial** (§2.3), though it reduces detail at
unchanged voxel size rather than changing resolution.

### 6.4 Caching — trade memory for CPU (bit-exact)

`getHeight` is a pure function of `(x, z)`, so a cached value equals a recomputed one bit-for-bit.

| Variant | Stores | Skips on hit | Memory/chunk | Complexity |
|---|---|---|---|---|
| **1A** shared height cache | one height per world voxel | shared skirts + revisits | ~8 B × voxels visited | high (`SharedTable`) |
| **1B** chunk heights-grid cache | the 18×18 grid | `Generate heights` (59%) | ~2.6 KB | medium |
| **1C** full voxel cache | `materials` + `occupancy` | *all* generation | few 100 KB – ~1 MB | medium |

**When caching helps — the pivotal caveat.** It helps **revisits**, and (1A only) the ~21% skirt
neighbours resample. It does **nothing** for first-time exploration — there is no prior value to reuse.
Since a larger load radius is dominated by first-time generation, **caching does not unlock load
distance**; it's a separate, movement-pattern-shaped bet.

**Where a cache can live** (Actor VMs are isolated — a per-VM cache serves only its own chunks and is
duplicated up to 16×, which is why the commented-out cache in `DefaultChunkGenerator` was disabled):

- **Design A — main-thread round-trip.** A plain `Map` on the main thread; the Actor returns its grid
  via `Loaded`, and a revisit passes the cached grid in the load message. Uses only well-understood
  mechanisms. Cost: the cache lives on the main VM, so its GC scans hit the main frame; plus a
  per-chunk message payload. **Lower-risk default.**
- **Design B — `SharedTable`.** No round-trip; memory is engine-managed, off any single VM's GC. But
  **it is the only design here that introduces shared mutable state across Actors, and therefore the
  only one with a real race surface** (lost updates on concurrent read-modify-write). Everything else
  in this system is race-free because Actors share nothing (§10.2). Its concurrency/memory/perf
  characteristics are under-documented — treat as a spike. **Never do a `SharedTable` access per voxel**
  (1A ≈ 8,400/chunk); `math.noise` is a fast native call. Keep to one access per chunk.

**Eviction & GC — what "manage memory" means in Luau.** GC is automatic incremental mark-and-sweep;
there is no manual free. You evict by dropping the reference (`map.delete(key)` → `t[k] = nil`),
reclaimed on a later pass. **You cannot force a collection** — Roblox's `collectgarbage` is deprecated
and restricted. So bound the cache **deterministically** by chunk count or player distance and delete
on the way out. Weak tables (`__mode`) exist but are nondeterministic — entries vanish on any GC pass —
so a "revisit is free" cache built on them would silently lose hits.

**Memory budget in practice.** Trading memory for CPU is generally a good deal on Roblox: script
execution is effectively single-threaded per VM, so CPU is scarce and RAM comparatively free. The cheap
caches (1A ≈ tens of MB; 1B ≈ a few KB/chunk) are a non-issue on any modern device — **bias toward
caching**. Two limits keep it from being unconditionally "always a win", and both argue for *bounding*
rather than avoiding:
- **The client's memory ceiling is well below device RAM.** The OS takes its share, Roblox's own
  baseline spends heavily, and mobile OSes terminate rather than swap. A crash is worse than a frame
  hit, so size eviction against the *client ceiling*, not physical RAM. (An explicit player setting is
  the player's risk to take; an invisible cache is not — bound it because it isn't a choice.)
- **Luau GC scales with live heap.** A large persistent cache lengthens every incremental pass — CPU —
  so an unbounded cache pays part of its saving back. Where the cache lives decides *which thread* pays
  that scan: a main-thread `Map` lengthens the main-frame GC; a `SharedTable` sits on the engine heap.

**1C also duplicates memory Roblox already spends** — the generated terrain already lives in the
engine's voxel store, so a Lua copy is a second one. That, plus its GC weight, is why 1B is preferred
even though 1C saves more per hit.

### 6.5 How these combine

Largely orthogonal: **6.1 + 6.2** are independent bit-exact cuts to different parts of the pipeline —
apply all. **Caching (6.4) sits on top**: a hit skips the generation the cuts optimize, a miss pays the
now-cheaper generation. The cuts reduce *miss cost*; caching reduces *miss frequency*. **6.3** is
mutually exclusive with bit-exactness but composes with caching.

---

## 7. Cross-cutting work (applies either way)

**Load distance and generation rate.** `ChunkLoader.frameBudget` (4 ms) and load radius set how much
generation competes for the frame. Already player-configurable.

**Chunk size is already tuned on Classic** — 16 was measured optimal; larger chunks cost *more* than
proportionally because voxel work scales with bounding **volume**. Don't raise it.

### Rejected: parallel `WriteVoxels`

*Proposal:* chunk regions are X/Z-disjoint by definition, so no two Actors write the same voxel — if
the parallel-phase write restriction could be bypassed, the serial phase would disappear.

**The premise is correct**; it is rejected for three other reasons:

1. **The restriction guards the engine's state, not yours.** `WriteVoxels` mutates the terrain store's
   internal bookkeeping — region allocation, spatial index, mesher dirty-marking, physics collision —
   all shared regardless of which voxels are targeted. *(Model of the internals, **not** documented.)*
2. **There is no override.** No sanctioned API bypasses `task.synchronize()`.
3. **The payoff is ~5%, on the wrong 6% of the work** — decisive. The serial phase is `WriteVoxels`
   (120.1 ms) + foliage (8.1 ms) against a 2107.7 ms parallel phase, i.e. **5.7%** total. Deleting it
   entirely caps there; §6.3 is worth ~37% of terrain time by comparison.

**Worth measuring anyway:** if the serial phase creates a *queuing* bottleneck (16 Actors funnelling
through one serial slot per frame), its effective cost could exceed its CPU time. If real, the fix is
reducing or batching serial-phase work, not parallel writes.

---

## 8. Changes already applied

All compile clean; **none are playtested**.

| Change | File(s) | Rationale |
|---|---|---|
| **Land-gating + warp CSE** (bit-exact) | `RealisticChunkGenerator.ts` | §6.1 — skips 11 of 26 noise calls where `land === 0` |
| **Unload frame budget (2 ms) + floor of ≥8 chunks/frame** | `ChunkLoader.ts` | Fixes the 418 ms freeze. The floor prevents a time-boxed sweep being outpaced by the fill loop, which would accumulate Instances without bound — the worse failure, since Instances dominate memory |
| **`Destroying triangles` profile marker** | `TriangleChunkRenderer.ts` | Makes unload cost measurable; the attribution was previously inference from unattributed script time |
| **Flat chunk 1024 → 2048** | `FlatTerrainRenderer.ts`, `TerrainController.ts` | `(96/2048) × 64 × 4 = 12` rings × 2048 = **same 24,576-stud radius, ~4× fewer parts** (~1,810 → ~452). 2048 is Roblox's max part size |
| **Shape switch hidden for Flat/Lava/Water/Void** | `PlayerSettingsEnvironment.ts` | Those kinds never call a generator (§2.1); the control was a silent no-op that still persisted a value |

**Open caveat on the unload floor:** `8` is a starting value, not derived, and the correct floor is
renderer-dependent in a way one constant can't express — 8 Classic chunks is a cheap voxel `FillBlock`;
8 Triangle chunks is 2,048 part destructions. If a capture shows residual hitching **or** part count
growing during sustained flight, promote it to a per-renderer property alongside
`loadDistanceMultiplier`.

---

## 9. How to verify & benchmark

**The harness already exists.** `ChunkLoader` prints, in Studio, `[terrain] filled in X.XXs: N chunks
across R rings (M/s)` at the end of each fill. A/B every change against that `M chunks/s` over the same
route. Per-stage attribution comes from the MicroProfiler markers and `Export → Summary to JSON`.

**Capture length matters.** Triangle needs several seconds (300–500 frames, 3–4 chunk boundaries,
~2,000+ studs) to catch generation bursts — capture B missed them entirely at 64 frames.

**Immediate verification of §8:** re-run Triangle / d96 flying. Expect `cpu_time_max` to fall sharply
from 418 ms and stddev from 64 ms, with `Destroying triangles` a bounded per-frame line. If max does
*not* drop, the `unloadChunks` attribution was wrong and the marker will say so.

**Proving a "bit-exact" change really is exact** (before shipping §6.2 or any cache):
- `getHeight`: sample old vs new over a fixed grid (a few thousand points spanning ocean, coast,
  mountain, mesa, build-area) and assert every value identical.
- Actor pipeline: generate chunks both ways, read back the written region, diff `materials` +
  `occupancy` cell-by-cell.
- Caching: assert a hit equals a fresh regeneration for the same coords — guaranteed by purity, but
  worth a test to catch key-collision bugs.

**Measure cache hit rate before investing further.** A low rate means movement is exploration-dominated
and caching is the wrong bet (§6.4).

---

## 10. Appendix — key files & background

### 10.1 Key files

- `src/client/terrain/InfiniteTerrainActor.client.ts` — Classic worker: height pass, voxel build, write
- `src/client/terrain/TerrainChunkRenderer.ts` — Classic Actor pool, dispatch, measured fill rates
- `src/client/terrain/TriangleChunkRenderer.ts` — Triangle renderer (main thread, wedge parts)
- `src/client/terrain/RealisticChunkGenerator.ts` — the expensive `getHeight` (noise stack)
- `src/client/terrain/DefaultChunkGenerator.ts` — the cheap generator (+ disabled per-Actor cache)
- `src/client/terrain/TerrainNoise.ts` — `fbm` / `ridged` / `spline`
- `src/client/terrain/ChunkLoader.ts` — load radius, frame budgets, fill/unload loops, fill-time print
- `src/client/gui/playerSettings/PlayerSettingsEnvironment.ts` — the player-facing terrain settings

### 10.2 Classic's parallelism is correct — don't "fix" it

- 16 pooled Actors, round-robin with a semaphore. `BindToMessageParallel` runs the heavy compute off the
  main thread; `task.synchronize()` sits **after** all compute, so only `WriteVoxels` + foliage Instance
  creation run serial — exactly the two operations that must. **94% of terrain work is parallel.**
- The ceiling is **worker-thread count (cores), not Actor count**: 8 actors → 463 chunks/s, 16 → 856,
  32 → 951. Doubling 16→32 buys +11%; already core-bound. More Actors will not help.

**Parallel Luau is a narrow tool.** Its restrictions — no Instance writes in the parallel phase,
read-only DataModel, isolated VMs — are simultaneously what makes it safe and what makes it applicable
to almost nothing, which is why most games ignore it. Terrain generation is one of the rare genuine
fits. Two consequences: **this lever is already pulled and there isn't another** (the remaining levers
are per-chunk cost, not more concurrency); and **don't reduce Actor usage** — the failure mode of
misusing parallel Luau is a *refused* operation, not silent corruption, and this system has no race
surface at all (chunks are X/Z-disjoint, `heights` is local per message, shared module state is
read-only after init).

### 10.3 Unverified inference, flagged deliberately

An earlier draft claimed "frame time tracks the synchronize barrier; the main thread waits for the
slowest worker's chunk." The multithreading docs do **not** describe frame-level barrier timing, and
the parallel phase is time-sliced across frames. Treat as hypothesis. Resolving it is part of Step 0
(§4) — read `RBX Main` specifically, since all totals here are summed across threads.
