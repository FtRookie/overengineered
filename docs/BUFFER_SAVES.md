# Binary save data: gzip and `buffer`

Feasibility and implementation plan for shrinking slot saves, measured against this codebase rather than
against a generic "JSON is bloated" argument.

Read [SAVE_DATA.md](claude/SAVE_DATA.md) first — it owns the storage routing and versioning rules this
document builds on. Nothing here is implemented.

## Summary

**Do gzip first, and treat the binary format as a separate, later decision.**

Measured on a 5 000-block slot through the real serializer:

| | size | vs today |
|---|---|---|
| JSON today | 964 KB (197 B/block) | — |
| JSON + gzip | 224 KB | **4.30x** |
| binary, no gzip | 239 KB (49 B/block) | 4.03x |
| binary + gzip | 139 KB | 6.95x |

The headline: **gzip alone is worth as much as the entire binary rewrite** (4.30x vs 4.03x), and it is one
field on an existing call. Once gzip is in, the binary format adds a further **1.61x** — real, but no longer
the transformative number a raw JSON-vs-binary comparison suggests, because gzip is very good at exactly the
redundancy binary encoding removes by hand.

The two are complementary, not alternatives. Stage them.

## Why the ceiling is lower than expected

Two reasons, both settled rather than assumed.

**The format is already partly compacted.** `objectToJson` (`BlocksSerializer.ts:1873`) uses three-letter keys
and `shared/Serializer.ts` stores a CFrame as position plus Euler angles — *not* the 12-number tagged matrix
that `engine/shared/fixes/Json.ts` uses for generic values. Any estimate built on that generic shape overstates
the win by roughly double.

**The UUID is irreducible and dominant.** `BlockUuid` must stay byte-stable across a save/load round trip
because logic connections are keyed by it; reshuffling would silently rewire builds. A GUID is 128 bits, so
16 bytes is the floor, and being high-entropy it does not compress. At 5 000 blocks that is 78 KB — **56% of
the entire gzipped binary save**. Every other field combined is smaller than the identifiers.

## Measured per-block JSON cost

Real `Serializer` output, encoded as JSON:

| block | bytes |
|---|---|
| axis-aligned, no colour/material | 95 |
| axis-aligned, colour + material | 123 |
| 90° yaw, colour + material | 136 |
| **free rotation, colour + material** | **216** |

`CFrame` holds float32 but JSON prints the float64 expansion, so a position that is not round serialises as
`12.529999732971191` — 19 characters for ~7 significant digits. **Rounding before encode is a free win**
independent of everything else here: no format change, no version bump, no migration, and it takes that
216-byte block to roughly 130. It is also the single cheapest thing on this page after gzip.

## Stage 1 — gzip

### Infrastructure

`ExternalDatabase.ts:204` already goes through `HttpService:RequestAsync`, which takes a `Compress` field:

> "An optional compression field that will compress the data in the request. The value can either be
> `Enum.HttpCompression.None` or `Enum.HttpCompression.Gzip`."

So the upload path is a one-field change. SQLite stores the result as a `BLOB`.

### The asymmetry — read this before planning

**Roblox documents no local compression API.** Luau cannot gzip or gunzip anything itself; `Compress` only
applies to an outgoing request body. That means:

- **Uploads** compress natively, for free.
- **Downloads** cannot be decompressed client-side. The backend must either store the blob compressed and
  inflate it server-side before responding, or store it inflated. Whether Roblox transparently inflates a
  gzipped *response* is not documented and would need a live test before being relied on.

Since the backend is ours, the sane shape is: client gzips on upload, backend stores the blob as-is
(disk win), backend inflates on read and serves plain. That captures upload bandwidth and storage, and leaves
download bandwidth unchanged.

### What changes

- `Compress: Enum.HttpCompression.Gzip` on the slot-upload request.
- Backend: accept a gzipped body, store as `BLOB`, inflate on read.
- `uploadInChunks` chunk arithmetic — see gotchas.

## Stage 2 — the binary layout

### Precision, as decided

| field | decision | encoding | bytes |
|---|---|---|---|
| block id | ~460 definitions, exceeds `u8` | palette index `u16` | 2 |
| uuid | **must stay stable** | raw 128-bit | 16 |
| position | ±2048 studs typical, larger must still load; 1e-5 is imperceptible | `i32` at 1e-5 studs → ±21 474 | 12 |
| rotation | free, noise below 0.001° | `f32` radians → 2.15e-5° at π, 46x margin | 12 |
| colour | already 8-bit hex | `u8` RGBA | 4 |
| material | `Enum.Material.Value` observed at 816 | `u16`, **not** `u8` | 2 |
| flags | collidable, has-config/scale/welds | bitfield `u8` | 1 |
| | | **fixed stride** | **49** |

Optional per-block fields (scale, welds, config) follow as flagged, length-prefixed runs.

**Scale** spans 1/256 to 512 — a 131 072x range, 17 octaves. `f32` covers it with enormous margin; a `u16`
log-encoding would too, at 0.00026-octave steps, if the 6 bytes matter.

**Rotation could be 8 bytes instead of 12.** 0.001° over 360° needs 19 bits per axis, so three axes pack into
57 bits. That saves 4 B/block — worth about 3% of the compressed save. Probably not worth the unpacking code.

### Why `i32` at 1e-5, and what it means for 64-bit CFrame

The target is 1e-5 studs — below that is imperceptible to the game and the eye. `i32` at 1e-5 steps covers
**±21 474 studs**, ten times the stated ±2048 bound, so range is not a constraint. `i24` would only reach
±83.9 studs and is not an option; `i32` is the smallest that works, at the same 12 bytes as three `f32`.

The useful part is how that compares to what `CFrame` can hold. float32 spacing crosses 1e-5 at exactly
**83.9 studs from the origin**:

| distance | float32 step | i32 @ 1e-5 | finer |
|---|---|---|---|
| 1 stud | 1.19e-7 | 1e-5 | float32 |
| 16 studs | 1.91e-6 | 1e-5 | float32 |
| 84 studs | 1.00e-5 | 1e-5 | crossover |
| 512 studs | 6.10e-5 | 1e-5 | **i32** |
| 2048 studs | 2.44e-4 | 1e-5 | **i32** |

So beyond ~84 studs the stored value is *more precise than the `CFrame` it came from*, and within 84 studs the
loss is bounded by 1e-5 — which is the stated noise floor. Fixed-point wins here precisely because it does not
lose precision with distance the way a float does.

This also lowers the urgency of 64-bit CFrame. A wider `CFrame` would buy range and near-origin precision, not
anything this format is throwing away. Still, **declare field widths in the header** rather than hard-coding
them, so a later version can widen without reflowing the record or migrating existing saves.

### Infrastructure

- A new `vN` in `BlocksSerializer`. The existing machinery already selects a reader by the version field and
  derives `latestVersion` from the last array element, so no magic number is needed and old JSON saves keep
  loading through their existing readers.
- Answer to the transport question: **the backend accepts binary blobs**, so no base64 and no 33% penalty.
- A block-id palette written once per save, referenced by `u16`.
- A JSON debug exporter, kept permanently. A binary save is opaque when something is wrong.

## Serial ids instead of UUIDs

Proposed: the server assigns `1, 2, 3, …` per block instead of a GUID, deletion frees the id, and a freshly
placed block may reuse a dropped one.

### It is worth a lot — and the recycling is worth almost none of it

| id scheme | raw | gzipped | per block (gzipped) |
|---|---|---|---|
| GUID, 16 B | 239 KB | 138 KB | 28.3 B |
| serial `u32`, 4 B, **recycled** | 181 KB | 55.4 KB | 11.4 B |
| serial `u32`, 4 B, **monotonic, 10x churn** | 181 KB | 59.8 KB | 12.2 B |
| serial `u32`, 4 B, **monotonic, 100x churn** | 181 KB | 60.1 KB | 12.3 B |

Raw, the change saves 12 B/block — 1.32x. **Gzipped it saves 2.49x**, far more, because sequential integers
compress and high-entropy GUIDs cannot. This is the single largest remaining lever after gzip itself.

But look at the last three rows. **Reusing dropped ids buys about 8%** over a monotonic counter that never
reuses anything, and that gap barely widens even after 100x churn — gzip encodes the near-constant stride
between ids regardless of how large they get. So the compression comes from *being an integer*, not from
*being dense*.

**The recommendation is therefore: serial ids yes, recycling no.** Every hazard below is a hazard of reuse,
not of serials. Paying ~4.7 KB per 60 KB save to delete the entire aliasing class is a good trade.

With a monotonic `u32` and 5 000 blocks the whole pipeline lands at **59.8 KB against 964 KB today — 16.1x**.

### What is already safe

`BuildingPlot.delete` (`BuildingPlot.ts:151`) already resolves every logic connection into the deleted blocks
via `getBlocksConnectedByLogicToMulti` and calls `logicDisconnect` before destroying them. The "deletion
disconnects all logic connections assigned to that id" behaviour the proposal asks for **already exists**, so
in the normal in-session path a recycled id cannot inherit a live wire.

### What breaks under reuse

The problem is never the delete itself; it is every reference that outlives it.

- **Undo/redo.** `ActionController` keeps an operation history. Delete block #5, place a new block that takes
  id 5, then undo — the restored block wants an id that is now occupied, and any redo of the original
  connections reattaches to the wrong object. There is no version of this that fails loudly.
- **Client-held references.** `EditTool`, `BlockConfigControls`, `GraphSessionStore` and `TutorialController`
  all hold ids across frames. An open config panel or a live graph session pointing at id 5 will silently
  retarget when 5 is recycled — the write lands on a real block, just the wrong one, so no validator fires.
- **In-flight remotes.** An id in a request already on the wire is resolved after the recycle. Same failure,
  narrower window.

### What breaks regardless of reuse

- **240 hardcoded GUIDs** across four committed tutorial diffs (`BasicCarTutorial.diff.ts` 85,
  `BasicPlaneTutorial.diff.ts` 99, `NewBasicPlaneTutorial.diff.ts` 53, `TestTutorial.ts` 3). These are source,
  not save data. *Not a real blocker*: the tutorials are already broken — `NewBasicPlaneTutorial.ts:52` asks
  for `"Beam 1x4"` while the block is `beam4x1` / "Beam 4x1", and that 1xN family is being retired per
  [BLOCK_1XN_DEPRECATION.md](BLOCK_1XN_DEPRECATION.md). They need regenerating regardless, so fold it in.
- **Every existing save** carries GUIDs. The `upgradeFrom` for the new version has to assign serials and
  rewrite every wire reference in one pass — mechanical, but it must be atomic per slot.
- **`tryGetBlock(uuid)` and the `uuid` attribute.** Ids live as a Roblox attribute
  (`BlockManager.ts:77`); a numeric attribute is cheaper than a string one, so this part is an improvement.
- **Copy/paste and cross-plot moves** need fresh ids and a remap of internal wires, the same as today.

### On base64

Worth correcting: **base64 is not compression — it expands binary by 33%** (3 bytes become 4 characters). The
180.7 KB serial blob becomes 240.9 KB base64. It is only a win against *hex* text, which doubles. Since the
backend accepts binary blobs, store raw bytes and skip it entirely.

## Options, graded by danger

0 is "cannot lose data", 10 is "loses data silently and no check fires". Grading weighs blast radius and
whether a mistake surfaces loudly, not how much work it is.

| # | option | worth | danger |
|---|---|---|---|
| 1 | Colour as `u8` RGBA | exact, no change | **0** |
| 2 | Material as `u16` palette | correctness fix — `u8` would corrupt, 816 observed | **0** |
| 3 | Header-declared field widths | nothing today; insurance for 64-bit CFrame | **0** |
| 4 | Round floats before encode | ~35% on rotated blocks | **1** |
| 5 | `f32` rotation | matches today's precision, 46x margin on the 0.001° floor | **1** |
| 6 | `i32` @ 1e-5 position | finer than the CFrame beyond 84 studs | **2** |
| 7 | `Compress: Gzip` on upload | **4.30x** | **2** |
| 8 | Backend accepts binary body | removes the base64 33% | **2** |
| 9 | Packed 21-bit rotation | ~3% of the compressed save | **3** |
| 10 | `scl` / `wld` as first-class fields | small | **3** |
| 11 | DataStore compatibility path | none directly — avoids a loss | **3** |
| 12 | Binary `vN` layout | 1.61x on top of gzip | **4** |
| 13 | **Monotonic serial ids** | **2.49x gzipped** | **6** |
| 14 | **Recycled serial ids** | +8% over monotonic | **10** |

Why each grade:

- **0–1** — exact or below the stated noise floor, no format change, revert by redeploy. #2 is graded 0 because
  it *prevents* a corruption; choosing `u8` would be the dangerous act.
- **2** — bounded, and failures are loud. A gzip or binary-body mismatch fails at the HTTP layer with an
  error, not with a wrong-looking build. #6 loses at most 1e-5 studs, which is the defined noise floor.
- **3** — more code than payoff, or touching something already awkward. #10 unpicks double-encoded nested JSON.
  #11 earns its 3 from the SAVE_DATA.md tripwire: an unreachable backend plus a stale read stamps the *old*
  build as newest, and `savedAt` then resolves a format mismatch as data loss rather than an error.
- **4** — real migration surface, but the versioning machinery already exists, old readers keep working, and a
  broken binary reader fails on load rather than corrupting. The cost is opacity: keep the JSON debug exporter.
- **6** — the migration must assign ids and rewrite every wire reference atomically per slot. Get it wrong and
  builds rewire. It is graded well below 14 because a monotonic counter **cannot alias**: a stale reference
  finds nothing rather than finding the wrong block.
- **10** — reuse is the only option here that fails *silently and plausibly*. Undo after a recycle, an open
  config panel, a live graph session or an in-flight remote all resolve id 5 to a real block that is not the
  one meant. Nothing validates it, because nothing is invalid. For ~8% over #13.

**Recommended set: 1–8 and 12–13, skipping 14.** That is the full 16.1x with no silently-failing step. 9 and
10 are optional polish; 11 is required only while the DataStore fallback lives.

## Gotchas

Each of these is silent, and none is caught by the compiler.

- **`Enum.Material.Value` exceeds 255.** 816 observed in the wild. `u8` would corrupt materials on a subset of
  blocks and only for some builds.
- **`BlockUuid` must round-trip byte-exact.** Logic connections key off it. Re-indexing blocks to save 12 B
  each would silently rewire machines — the most dangerous single optimisation on this page, and it is off the
  table.
- **No Luau gunzip exists.** Any design that assumes the client can inflate what it stored is wrong.
- **`uploadInChunks` measures JSON-escaping inflation** to pick a chunk size. A gzipped or binary body does not
  escape the same way; that arithmetic must be revisited, not inherited. `MAX_BODY` is 900 000.
- **A `buffer` is not a DataStore-storable value.** DataStore is deprecated for us but still the outbox and
  legacy fallback, so that path needs a text representation regardless — and per SAVE_DATA.md, an unreachable
  backend plus a stale read can stamp the *old* build as newest.
- **`savedAt` picks the winner** between backend and DataStore copies. Both sides must agree on the format
  story before the flip, or a format mismatch resolves as data loss rather than an error.
- **`scl` and `wld` are double-encoded** — nested JSON strings inside the save today. They should become
  first-class binary fields, not embedded strings.
- **`CFrameSerializer.serialize` puts `ToEulerAnglesXYZ()` in the last slot of an array literal**, the LuaTuple
  expansion tripwire from CLAUDE.md. Verified against the compiled output: roblox-ts wraps it correctly and it
  round-trips as a nested 3-array. Not a bug, but do not "fix" it.
- **`tests/testsave` guards schema drift** against a committed baseline. A binary layout makes that drift
  harder to eyeball, so the guard matters more, not less.
- **Rotation is genuinely free.** Snapping is a build-mode convenience only, so no fixed-orientation table
  (`rot u8`) is valid. A measured slot contains arbitrary Euler angles.

## Migration

The version field does the work. New saves write `vN`; anything older loads through its existing reader and
converts on next save. No big-bang migration, no downtime. `upgradeFrom` for the binary version reads the
previous JSON shape and re-emits, exactly as every prior version bump has.

Order of work, cheapest and safest first:

1. Round positions and angles before encode. No version bump. Immediate ~35% on rotated blocks.
2. `Compress: Enum.HttpCompression.Gzip` plus backend inflate-on-read. No format change. 4.30x.
3. Binary `vN` behind the existing versioning. A further 1.61x, and it removes multi-chunk uploads for all but
   the largest builds.

## Still open

- **Config share is unmeasured.** Everything above measures the fixed part of a block; per-block config is
  freeform and stays a length-prefixed run in any layout, so it caps the achievable ratio. This needs one real
  production slot to settle. The DB endpoint may not be reachable from a sandboxed session — an exported slot
  blob would do just as well and avoids pointing anything at production.
- **Does Roblox inflate gzipped responses?** Undocumented. Decides whether downloads can benefit.
- **Is the 8-byte packed rotation worth it?** ~3% of the compressed save against real unpacking complexity.
