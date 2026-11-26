# Asteroid fields — research and generation plan

Status: implemented as occasional random patches through space, replacing the earlier continuous belt
(`src/client/space/AsteroidFieldController.ts`, templates in `ReplicatedStorage.SpaceModels`). No rings, trails or
settings yet.

Decided: asteroids come in occasional random patches rather than a band at 100,000–110,000; they are static; the
hand-placed Space Objects stay as landmarks.

## 1. What real asteroid groupings look like

Each archetype below is a real structure, reduced to the shape and statistics a generator can reproduce.

| Archetype | Real example | Shape | Statistics worth copying |
|---|---|---|---|
| **Belt** | Main belt (2.1–3.3 AU) | Wide, flat torus | Very sparse, with density varying by distance. Kirkwood gaps (4:1, 3:1, 5:2 resonances with Jupiter) are bands that hold almost nothing, so they can serve as navigation lanes. |
| **Collisional family** | Flora (~400 members), Rampo | A tight clump around one large remnant | Fragment sizes follow a power law: cumulative N(>D) ∝ D^−q, q ≈ 2.5. Members share a material and colour. The clump is stretched along the direction the fragments were thrown. |
| **Rubble pile / contact binary** | Itokawa, Arrokoth | One body made of several touching lumps | Forms when slow fragments fall back together. Some bodies are two-lobed, and some are binary pairs orbiting each other. |
| **Resonant swarm** | Jupiter Trojans (1:1), Hildas (3:2) | Two dense clouds 60° ahead of and behind a large body | Clustered around a landmark, with empty space between the swarms. |
| **Ring** | Saturn A–F rings | A thin, flat annulus around a body | Particles from centimetres to tens of metres, with larger ones farther out. Sharp edges and gaps are cleared by embedded "shepherd" moons. Resonances with moons cause density waves: regular radial ripples in density. |
| **Debris trail** | P/2010 A2 | A long, thin tube | A fresh collision's fragments strung along the orbit (cumulative slope q ≈ 2.5). The largest surviving piece sits at the head. |
| **Sparse shell** | Kuiper belt, scattered disk, Oort cloud | A thick shell, roughly spherical at the extreme | Isolated large bodies far apart. The outer regions are inclined and eccentric. |

**Scale is the main departure from reality.** The real main belt averages 10⁵–10⁶ km between bodies larger than 1 km, so nothing would ever be in view. The game needs the science-fiction picture of a field you can see across. Copy the *structure* (gaps, families, power-law sizes, rings, trails) but compress the spacing by many orders of magnitude.

## 2. The space boundary

**Space begins at local height 20,000, where the sky turns fully black.** Local height is `world Y − GameDefinitions.HEIGHT_OFFSET`, i.e. world Y + 16,384, so the boundary is at world Y 3,616. That is the same height as `GameEnvironment.ZeroAirHeight`, so the sky goes black exactly where the air runs out. Every altitude in this plan is given relative to it.

**What the code does:** `AtmosphereService` measures altitude as `xOverSF = camera Y + 16384`, the same zero point as `Physics.LocalHeight`. Its `altitudeFade` is 1 up to 15,000, falls linearly to 0 at 20,000, and stays 0 above that ([AtmosphereService.ts:773-782](../src/client/AtmosphereService.ts#L773-L782)). It multiplies into the sky dome's opacity at line 1053.

**What the screen shows:** a Studio playtest at ClockTime 14, looking 7° above the horizon.

| Local height | Sky |
|---|---|
| 15,000 | Dark navy, with a bright blue band along the planet's edge |
| 17,500 | Near-black blue, with a thinner band |
| 19,000 | Black, with a faint blue glow left on the edge |
| **20,000** | **Pitch black, with no glow left** |

`Lighting.Brightness`, `Ambient`, `OutdoorAmbient` and `FogColor` don't change between 0 and 30,000. Only `FogEnd` drifts down slightly. So the darkening comes entirely from the sky meshes.

**Other heights to reference:**

| Local height | World Y | What happens |
|---|---|---|
| 3,000 | −13,384 | Ground terrain stops streaming (`ChunkLoader.maxVisibleHeight`) |
| 15,000 | −1,384 | The sky starts fading |
| **20,000** | **3,616** | **Space: black sky, no air** (`ZeroAirHeight`) |
| 30,000 | 13,616 | Gravity reaches 0 (`ZeroGravityHeight`); it falls linearly from 180, so it is still 60 at the space boundary |
| ~42,800 | ~26,400 | The existing hand-placed `Space Objects` asteroids |

**Suggestion:** when this is built, add `GameEnvironment.SpaceHeight = ZeroAirHeight` and express every field altitude as an offset from it, so moving the boundary moves the belts with it.

## 3. What the game already has

| Piece | Where | Use |
|---|---|---|
| 3 asteroid MeshParts (`Icosphere`, `.001`, `.002`), `Rock` material, `PreciseConvexDecomposition` collisions, sizes from ~65 to ~980 studs | `Workspace.Map.Unloadables["Space Objects"].Asteroids`, world Y ~26,400 (local height ~42,800) | Main asteroid shapes. They currently get a random rotation from three Legacy server `Script`s; the generator would replace those. |
| `Rock` mesh `rbxassetid://131949031617927`, used 199 times around the map | `Map.Unloadables.*` | Small fragments and rubble-pile lumps |
| `Boulder` / `LargeBoulder01`, mesh `15879485486`, ~38×58×38, currently unused | `ReplicatedStorage.TerrainModels` | Medium fragments |
| `UFO` and `Banana` easter eggs | `Space Objects` | Landmarks the generator must keep clear of |
| `ChunkLoader` + `ChunkRenderer<T>`: ring fill outward, 4 ms fill and 2 ms unload budgets per frame, forward loading, live distance changes | `src/client/terrain/ChunkLoader.ts` | The streaming loop to generalise. It is **2D (x/z) only**, and it **unloads everything above 3000 + HEIGHT_OFFSET** (line 52), which is far below space. |
| Actor pool + semaphore for parallel, pure generation with serial Instance placement | `TerrainChunkRenderer.ts:22-138`, `InfiniteTerrainActor.client.ts` | For computing positions in parallel, if needed |
| `TerrainNoise.fbm` / `ridged` / `spline` / `smoothClamp01` | `src/client/terrain/TerrainNoise.ts` | Density modulation. **2D only**; the third noise axis carries the seed. |
| Impact damage on any `CanCollide` contact, including client-local parts | `ImpactController.ts:200-231` | Asteroids hurt builds with no extra wiring, as Triangle terrain already does |
| Altitude bands: gravity 0 above 30,000, air 0 above 20,000 | `GameEnvironment.ts`, `Physics.ts:19-36` | Where fields live |
| `environment.*` settings, auto-defaulted two levels deep | `PlayerConfig.ts`, `PlayerSettingsEnvironment.ts` | The player toggle and density setting |

**Missing pieces:**
- No seeded RNG or hash helper anywhere in the codebase; the code only uses unseeded `math.random()`.
- No 3D chunk keying.
- No origin shifting or other floating-point precision handling.

**Engine constraints (Creator Docs):**
- `CollisionFidelity` "cannot be read or manipulated by scripts during runtime", so each collision level has to be a pre-made asset variant.
- `RenderFidelity.Automatic` lowers mesh detail by itself at 250 and 500 studs from the camera.

## 4. Generation design

### Principles
- **Deterministic and client-local, like terrain.** Every asteroid is a pure function of (world seed, cell coordinates). Every client builds the same field, so nothing is replicated or saved. Each owner's client simulates its own vehicle, so collisions agree wherever both sides see the same asteroid. This is the same model the Triangle terrain already relies on.
- **Density functions, not hand-made lists.** Each archetype is a 3D density field ρ(p) ≥ 0, with optional per-field settings: size range, slope q, palette and asset weights. A cell samples the fields that overlap it.
- **Progressive in two senses:**
  - *In space:* cells stream outward from the camera, nearest first, within a per-frame budget.
  - *In detail:* far cells keep only large bodies, and smaller ones appear as you approach.
  - Optionally *in altitude:* fields get denser and more varied the higher you fly.

### Two-level hierarchy
1. **Sectors** (large 3D cells, e.g. 8192 studs).
   - A sector's hash decides whether it hosts a field and, if so, which archetype, plus the field's anchor, orientation, extent and settings.
   - A field can reach past its own sector. So a cell checks the fields of the 3×3×3 sectors around it, the same neighbour-cell idea used to hide tiling seams in Poisson-distributed placement.
   - Belts are an exception: they're global and depend only on altitude.
2. **Cells** (small 3D cells, e.g. 512 studs, the unit the loader streams).
   - For each field overlapping a cell: expected count λ = ∫ρ over the cell volume (sampled at the cell centre, or at 8 sub-points for large cells). Draw the count from Poisson(λ) using the cell's hashed RNG.
   - Each asteroid gets:
     - a jittered position, with a rejection pass so bodies keep a minimum distance relative to their radius;
     - a size by inverse transform, `D = Dmin · (1 − u)^(−1/q)`, clamped to Dmax;
     - a uniform random rotation (a quaternion from 3 uniforms);
     - an asset picked from the field's weights;
     - a tint from the field's palette.

### Density per archetype (local coordinates of the field)

| Archetype | ρ(p) |
|---|---|
| Belt | `band(y) · lanes(r) · (0.5 + fbm(p))`: a smooth altitude band, multiplied by near-zero dips at a few fixed radii for the Kirkwood-style lanes. The band is local height 100,000–110,000, with density rising over its outer 1,500 studs. |
| Family | Anisotropic Gaussian around the anchor, stretched along a hashed ejection axis. One forced "largest remnant" at the anchor. Steeper slope (q ≈ 2.5–3). One shared palette. |
| Rubble pile | Not a field. When a large body is placed, a probability turns it into 3–8 overlapping lumps (`Rock`/`Boulder` meshes) around one core, or into a binary pair with a gap between them |
| Swarm | Two families anchored ±60° around a landmark along an arc |
| Ring | Annulus `r ∈ [r0, r1]` with `|y| < thickness`, sharp edges (`smoothClamp01` on a short ramp), 1–3 gaps, and `1 + a·cos(k·r)` density waves. Small sizes only, growing slightly with r |
| Trail | Distance to a hashed line or arc segment with a Gaussian cross-section. Size falls along the length from the head, with the largest body at the head |
| Shell | Very low uniform density at the highest altitudes. Large bodies only |

### LOD and streaming
- **A 3D loader.** Generalise `ChunkLoader`:
  - key chunks by (x, y, z);
  - fill outward by 3D distance;
  - keep forward loading as a view cone;
  - keep the existing 4 ms fill and 2 ms unload budgets.

  Its altitude gate is the reverse of terrain's: a once-a-second check connects the per-frame streaming only while the camera is within the load radius of the belt, and clears every cell when it leaves.
- **A size threshold that depends on distance.** A cell at distance d keeps only bodies with `D ≥ k·d`. As you approach, the threshold drops and the same deterministic bodies, smaller ones first, are added to the cell. No re-placement is needed, because the full list is computed once per cell and only filtered.
- **Collision variants per size.**
  - Tiny bodies use a `Box`/`Hull` template.
  - Most bodies use `Hull`.
  - Only the largest few use `PreciseConvexDecomposition`.
  - Collision variants must exist as assets because fidelity can't be set at runtime.
  - `CastShadow` is off below a size.
  - `RenderFidelity` stays Automatic.
- **Pooling.** Keep pools of cloned templates per (mesh, collision variant) and reposition them, instead of creating and destroying.
- **Hard caps** on live parts in total and per cell, checked with the MicroProfiler, as `TERRAIN_OPTIMIZATION.md` did for terrain.

### Assets
- Collect the three Icospheres, `Rock` and `Boulder` into one `ReplicatedStorage.SpaceModels` folder.
- Make one variant per collision fidelity.
- Remove the Legacy rotation scripts from the hand-placed asteroids.
- Each template keeps unit-ish proportions. Scale is applied through `Size`, which scales a MeshPart's mesh.
- Palettes per family come from `Material` (Rock, Basalt, Slate, Ice for ring particles) plus a tint.

### Settings
- Add `environment.space` (`asteroids: boolean`, `density: number`). It sits two levels deep, so `addDefaults` fills it for old saves with no version bump.
- `density` should only *thin* the list, by comparing each body's own hashed value against a cut-off. It must never move bodies. That way two players with different settings still share every body the sparser player sees.

### Precision
There's no origin shifting, and accuracy falls off far from the origin. Keep fields within a fixed horizontal radius of the map, plus the altitude band, rather than making space infinite in x/z.

## 5. Phases

1. **Foundations**
   - A seeded hash/RNG utility (none exists); check `UTILITY_APIS.md` first.
   - 3D noise (a 3D variant of `fbm`).
   - The 3D chunk loader with the space altitude gate.
   - The `SpaceModels` template folder with collision variants.
   - Unit tests for determinism: the same cell gives the same list across calls and clients.
2. **Belt with LOD:** the belt density, Poisson count, power-law sizes, the distance threshold, pooling and caps. Profile in Studio.
3. **Families, rubble piles and binaries:** sector hashing, neighbour-sector lookup and per-family palettes.
4. **Rings, trails and swarms:** around landmark bodies, whether existing ones (the Space Objects) or a large generated anchor asteroid.
5. **Settings and polish:** the toggle and density setting, an update log entry, and multiplayer checks: two clients see identical bodies, and impact damage applies.
6. **Optional, server-side:** breakable or mineable asteroids. These need server-owned state, along the lines of `ServerDestructibleController`, because client-local parts can't change for everyone.

## 6. Measured cost of moving asteroids

**Setup:** Studio playtest client in zero-g at about Y 14,500, with terrain unloaded.
- **Asteroids:** clones of the game's three asteroid meshes and the `Rock` mesh, all `PreciseConvexDecomposition`. Sizes 5–60 studs from the power law, 70 studs apart, with the camera facing the field.
- **Sampling:** `Stats` read every frame for 4 s after 1 s of warm-up.
- **FPS cap:** Studio held the client at 30 FPS, so whole-frame time doesn't separate the cases. Compare the component columns instead.

**2,000 asteroids (ms per frame):**

| Scenario | Script update | Physics step | Render CPU | Render GPU | FPS | p95 frame |
|---|---|---|---|---|---|---|
| None | – | 0.92 | 5.21 | 0.61 | 30 | 34.6 |
| Static, anchored | – | 1.00 | 6.78 | 1.07 | 30 | 34.9 |
| `BulkMoveTo` (FireCFrameChanged) | 6.02 | 1.03 | 9.44 | 1.79 | 29 | 38.4 |
| `BulkMoveTo`, CFrames kept in a table | 5.44 | 1.02 | 9.31 | 1.81 | 30 | 35.1 |
| `BulkMoveTo`, a quarter of the field per frame | 1.65 | 1.04 | 8.04 | 1.27 | 30 | 34.7 |
| `part.CFrame =` per part | 9.36 | 1.13 | 9.62 | 2.44 | 27 | 42.6 |
| Whole field welded to one anchored root, root turned | 2.05 (one write) | 1.35 | 9.93 | 0.73 | 30 | 35.4 |
| Unanchored, physics spin | – | 7.04 | 10.79 | 0.58 | 26 | 45.9 |

**500 asteroids:**

| Scenario | Script update | Physics step | Render CPU |
|---|---|---|---|
| `BulkMoveTo` | 1.48 | 1.01 | 6.52 |
| `part.CFrame =` per part | 2.31 | 1.09 | 6.82 |
| Physics spin | – | 2.30 | 6.55 |

The physics row compares against 1.01 ms physics step for static asteroids at the same count.

**Per-asteroid cost** (it scales linearly between 500 and 2,000):

| Cost | Per asteroid, per frame |
|---|---|
| Just existing (static), extra render CPU | ~0.8 µs |
| `BulkMoveTo` script | ~3 µs |
| Extra render CPU from motion | ~1.3 µs |
| `part.CFrame =` per part | ~4.7 µs, plus a worse p95 |
| Physics simulation | ~3 µs physics, ~2 µs extra render, and the worst p95 |

**What makes motion expensive:**
- **The engine call, not the maths:** keeping CFrames in a table saves only ~10%.
- **Moving the field as one body costs the same:** one `CFrame` write took 2 ms, because every welded part still gets a new transform.

**Implications:**
- **Default to static asteroids.**
- **If they spin**, animate only those within a radius of the camera, through one `BulkMoveTo` per frame. Spreading updates across frames (a quarter of the field per frame) cut script time ~3.6×. At ~3 µs each, a 1 ms budget is roughly 300 asteroids per frame, or ~1,200 with the quarter-per-frame split.
- **Never use unanchored physics** for ambient motion.
- **Don't drift whole fields:** it costs as much as moving every part.
- **Caveat:** these are this machine's numbers in Studio. Re-measure on a low-end device before setting final caps.

## 7. What is built

### Patches (current)

**Layout:** space is split into 8,192-stud sectors.
- **Odds:** each sector between local height 30,000 and 300,000 holds a patch with 8% odds, decided by the sector's
  seed. There is no horizontal limit.
- **Shape:** a patch has a random centre in its sector, a radius of 600–2,000 studs, and a 1.5–3× stretch along a random
  axis. Its richness is 0.6–1.4, and its density is a Gaussian around the centre.
- **Count:** about one patch per 6.9 trillion cubic studs, roughly 19,000 studs apart.

**Seeding:**
- **Mixing:** each coordinate reseeds a `Random` from the previous draw.
- **Why:** the first hash, XOR of scaled coordinates, gave different sectors the same seed and so identical patches.
- **Check:** the new seeding gave no repeated radius across all 444 patches.

**Gating:**
- **Below space:** nothing runs until `AtmosphereService.inSpace`.
- **In space:** the patches in the 27 sectors around the camera are looked up once per sector crossed. Streaming runs
  only while one of them is within reach; everything is cleared otherwise.

**Instrumentation:**
- **Markers:** Studio-only MicroProfiler markers `AsteroidField step`, `generate`, `build` and `unload`.
- **Attributes:** after each pass the `Asteroids` folder carries `PassMs`, `PassFrames`, `GenerateMs`, `Cells`,
  `Asteroids`, `Pooled` and `Patches`.

**Measured in a focused Studio playtest,** approaching a patch of radius 1,609 at local height 32,803 at 400 studs/s:

| Measure | Value |
|---|---|
| Re-check pass latency | mean 7.0 ms (max 19.7 ms) wall time, over 1–2 frames |
| Generation per pass | mean 0.31 ms (3.2 ms for the first pass) |
| At the centre | 702 asteroids drawn, 16 pooled, 480 cells tracked (most empty) |
| Memory against empty space | +703 instances; graphics parts +1.9 MB, base parts +1.3 MB (~4.6 KB per asteroid) |
| FPS at the same height | 73.5 at the patch centre vs 76.6 in empty space; render CPU +0.5 ms |
| MicroProfiler, drifting through the patch | `step` 0.23–0.28 ms per frame on average, worst 4.1–4.2 ms (the fill budget); `build` 0.08–0.16 ms; `generate` and `unload` about 0.01 ms (20-frame captures) |

### The earlier belt (replaced)

**Templates:** `ReplicatedStorage.SpaceModels` (`game/ReplicatedStorage/SpaceModels.rbxmx`) holds `Asteroid1`–`3`
(the Space Objects meshes), `Rock` and `Boulder`.
- **All five keep their source meshes' precise collisions.**
- **No rough collision variants:** setting `CollisionFidelity` by script in Edit mode saved identical physics data for
  every variant, so they were dropped.

**Generator** (`AsteroidFieldController`, client):

| Setting | Value |
|---|---|
| Cell size | 512 studs |
| Draw range | 2,048 studs, per asteroid; re-checked every 128 studs of camera travel; nearest cells first |
| Per-frame budget | 4 ms fill, 2 ms unload |
| Asteroids per cell at full density | 4 |
| Diameters | 12–420, cumulative slope 2.5 |
| Meshes | `Rock`/`Boulder` below 40 studs, the asteroid meshes above |
| Shadows | none cast |
| Part reuse | hidden asteroids go to a pool of up to 32 per mesh instead of being destroyed (81% of the asteroids shown in a 10 s flight reused a pooled part) |
| Distance cut-off | an asteroid shows once it is at least 0.006 of its distance across |

**Density:** the altitude band, multiplied by three empty lanes (rings at 6k, 15k and 26k from the map's centre), a fade
out to a 40k radius, and 3D noise clumps.

**Gating:** `AtmosphereService.inSpace` flips when the camera crosses local height 20,000 (`ZeroAirHeight`, where
the sky turns black). Until then the service connects nothing. In space it streams only within the draw range of the
belt, and it clears everything when the camera leaves.

**Measured in a focused Studio playtest:**

| Situation | FPS | Asteroids | Furthest asteroid |
|---|---|---|---|
| Space at 60k, no belt | 96.7 | 0 | – |
| Belt, still | 106.3 | 498 | 2,047 studs |
| Belt, flying at 400 studs/s | 94.3 | up to 622 | 2,171 studs (the 2,048 range plus up to 128 studs of travel before the next re-check) |

- The asteroid folder doesn't exist on the ground or at 60k.
- Earlier, at 8 per cell and a 3,072 radius, leaving and re-entering the belt rebuilt an identical field (same count,
  same summed positions).

**Not checked yet:** two clients side by side, flying through the field (distance updates and collisions), and
low-end hardware.

## 8. Open questions
- Should other fields (families, rings, the sparse shell) sit above the belt, and should fields get denser with altitude?
- How dense overall? The field can look busy or stay sparse and open.
- Should asteroids spin or drift? Motion costs CPU per frame, and moving client-local parts can disagree between clients on timing.
- Should the hand-placed Space Objects stay as landmarks, or be replaced by generated ones?

## Sources
- Kirkwood gaps and the inner/outer belt: [Wikipedia: Main belt](https://en.Wikipedia.com/wiki/Main-belt), [Wikipedia: Kirkwood gap](https://www.wikipedia.org/wiki/Hecuba_gap)
- Families vs groups, Hildas, Trojans: [Wikipedia: List of minor-planet groups](https://www.Wikipedia.com/wiki/Asteroid_group), [Project Pluto](https://www.projectpluto.com/mp_group.htm), [arXiv 1607.01998](https://www.arxiv.org/pdf/1607.01998)
- Family size distributions, reaccumulation and binaries: [arXiv 2205.06340](https://arxiv.org/pdf/2205.06340), [arXiv 2603.29806](https://arxiv.org/html/2603.29806), [P/2010 A2 debris trail](https://arxiv.org/pdf/1010.2883)
- Rings, gaps, shepherds, density waves: [arXiv 1805.08963](https://arxiv.org/pdf/1805.08963), [NASA GSFC](https://caps.gsfc.nasa.gov/simpson/kingswood/rings), [Physics Today](https://physicstoday.aip.org/quick-study/saturns-dynamical-rings)
- Kuiper belt, scattered disk, Oort cloud: [NASA](https://science.nasa.gov/solar-system/kuiper-belt/facts/), [arXiv 1911.07897](https://arxiv.org/pdf/1911.07897), [Wikipedia: Kuiper belt](https://Wikipedia.com/wiki/Kuiper_Belt)
- Real belt spacing: [SwRI Lucy](https://lucy.swri.edu/MainBeltDensity.html), [Scientific American](https://www.scientificamerican.com/article/in-science-fiction-movies/), [Universe Today](https://www.universetoday.com/130136/far-asteroid-belt-earth)
- Neighbour-cell Poisson placement, local procedural generation: [Uni Bremen procedural asteroids](https://cgvr.cs.uni-bremen.de/research/procedural_asteroid/)
- Engine: Creator Docs `RenderFidelity`, `TriangleMeshPart.CollisionFidelity`
