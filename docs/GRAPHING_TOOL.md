# Graphing tool

In-game plotter for block logic outputs. Records values from a running machine into ring buffers and draws them as
a scatter/line plot, in both build and ride mode.

Status at time of writing: feature-complete, **12 of 119 acceptance tests outstanding** (see [Test
status](#test-status)). Everything lives in `src/client/gui/graph/`, plus a small number of deliberate changes
outside it that are called out in [Changes outside the module](#changes-outside-the-module).

## What it does

- **Graphs** button, top right, available in build *and* ride — the first window with that lifetime.
- A manager window lists graph *groups*; each group gets its own draggable, resizable floating window.
- Pick a block, then pick one of its output connectors. Y takes any number of series; X is either elapsed logic
  time or another output (making it output-vs-output rather than a time series).
- Samples survive the machine. Leaving ride mode freezes the trace rather than clearing it, so a run stays
  readable back in build mode.

## Architecture

| File | Responsibility |
| --- | --- |
| `GraphController.ts` | Root `HostedService`. Owns the store, the button, the manager, one window per group, and the ride-scoped sampler. Drives binding re-checks. |
| `GraphSessionStore.ts` | All data. Groups, recorded outputs, ring buffers, and the `GraphData` namespace of pure helpers. Owns no GUI and no machine reference. |
| `GraphSampler.ts` | Ride-scoped. Reads `getDebugInfo` each logic tick and writes into the store's buffers. Owns no data. |
| `GraphSeriesRenderer.ts` | Pure drawing. Pooled Frames, axis mapping, clipping, sentinel bands. Writes back `xMin`/`xMax`/`yMin`/`yMax`/`status` for the window to display. |
| `GraphWindow.ts` | One graph's chrome — bounds boxes, mode buttons, series rows, pick buttons, the 30 Hz redraw loop. |
| `GraphManagerWindow.ts` | The group list, add/remove/show/hide. |
| `GraphOutputPicker.ts` | Two-stage pick: click a block, then click an output marker. One picker shared by every graph. |

The separation is deliberate: **the store outlives the machine**, the sampler dies with it, and the renderer is a
pure function of store state. If you find yourself putting data on the sampler or GUI state on the store, stop.

## Data model

```ts
type RecordedOutput = {
    arity: 1 | 3;                       // channels actually drawn
    unbound: boolean;                   // backing block is gone
    colors: (Color3 | undefined)[];     // per-channel override; hole = default hue
    times: number[]; c0: number[]; c1: number[]; c2: number[];
    gaps: boolean[];                    // no value this tick
    garbage: boolean[];                 // of those, specifically GARBAGE
    start: number; count: number;       // ring window
};
```

Three things worth internalising:

**Every value is widened to three channels at capture.** A scalar is stored as `(n, n, n)`. This is why pairing a
`number` Y against a `vector3` X broadcasts for free — the channel count is just `max` of the two arities
(`GraphSeriesRenderer.channelsOf`). Do not add per-type branching downstream; it is already handled.

**Parallel flat arrays, not an array of sample objects.** A per-sample table would be one Lua allocation per
output per tick. Same reasoning behind the pooled Frames in the renderer.

**`arity` is declared at bind time, then corrected at sample time.** `GraphData.arityOf` reads the block
definition's output types so a vector3 shows three rows immediately in build mode. An output declaring *both*
widths (a passthrough typed with all primitives) can't be resolved statically, so it starts at 1 and the first
`push` corrects it.

## Traps

### The LuaTuple trap — this one bit hard

`GraphData.widen` returns `LuaTuple<[number, number, number, 0 | 1 | 3]>` and signals "unplottable" with **arity
`0`**, not `undefined`. That is not stylistic. The original returned `LuaTuple | undefined`, and:

```ts
const widened = GraphData.widen(entry);   // → local widened = { GraphData.widen(entry) }
if (!widened) { /* never runs: {} is truthy */ }
```

The guard was dead from the day it was written. Every sentinel tick called `push(output, elapsed, nil, nil, nil,
nil)`, writing `arity = nil` and `c0[slot] = nil` while marking the slot as *not* a gap — which surfaced much later
as two unrelated-looking crashes and a series that refused to plot. **Destructure straight from the call**; never
store a LuaTuple in a variable first. See `CLAUDE.md` → roblox-ts gotchas.

The renderer also guards `=== undefined` explicitly on sample reads. `x !== x` catches NaN but **not** nil, because
`nil ~= nil` is false in Lua.

### Sentinel semantics

| State | `getDebugInfo` reports | Graph draws |
| --- | --- | --- |
| Running | its value | normal trace |
| Paused (`stopTicking`) | its value — pause does **not** disable | trace holds |
| Config-disabled | `AVAILABLELATER` | plain gap |
| Burned (`disableAndBurn`) | `GARBAGE` | red band |
| Destroyed (TNT) | `GARBAGE` — the runner burns any block whose tick throws | red band |

A destroyed block reporting GARBAGE is **intentional**: garbage means "will never produce a value", which is
exactly a destroyed block.

Bands are drawn only when X is elapsed time. Against an output X there is no coordinate to place a band at — the
block supplying X is itself producing nothing during the burn.

### A tick is a frame — one sample per tick, deliberately

`BlockLogicRunner` ticks from `event.loop(0, …)` — once per frame — and a *speedup* overclock runs `multiplier`
ticks per frame, so how much wall-clock history 8192 samples buys depends on the client: ~136s at 60fps, ~34s at
240fps, less again under an overclock. Sampling on a fixed interval of elapsed time was tried to even that out and
**reverted**: the clock advances in real seconds however fast the machine ticks, so any rate fixed against it
keeps one tick in every `multiplier` and always at the same phase of the frame, aliasing the detail an overclock
exists to produce. Scaling the interval by the multiplier papers over it without fixing the phase lock.

What actually looked like data loss was in the renderer, not the sampler — see below.

### One point per pixel, keyed on the pixel

Two rules that took three attempts to land, both in pass two of `render`:

- **Never select by buffer index.** An integer stride (`ceil(visible / pixels)`) jumps from 1 to 2 the frame the
  samples outnumber the pixels, halving the trace at once — a hard cliff exactly at `count == plot width`.
  Spreading evenly by index instead removes the cliff but not the flashing: even spacing through the *buffer* is
  not even spacing through the *plot*, since frames vary in length and an output X is spaced by its own values, so
  the drawn set clumps and reshuffles whenever a sample is appended.
- **Key the dedup on the whole pixel, not the column.** Against an output X the trace dwells in one column while Y
  sweeps the plot; dropping same-column samples threw all of that away.

A sample is drawn unless it would land on the pixel the previous drawn one occupies. Cost then scales with what is
on screen rather than with the buffer: a smooth run collapses into a few pixels however long it is.

### Pairing is by timestamp, not index

`slotAtTime` binary-searches the X source for an *exact* time match. Outputs bound mid-ride carry fewer samples
than their neighbours, so logical indices do not name the same moment. Every output in a group is stamped with the
same `elapsed` double in one pass, which is what makes exact comparison sound.

### Binding re-checks

`refreshBindings` marks outputs unbound and resets X to `Time` when its source dies. It runs on **two** signals:

- `plot.changed` — build-mode edits, deletion, undo.
- `CustomRemotes.damageSystem.broken.invoked` — a block broken mid-ride never edits the plot, so this is the only
  signal that it is gone.

Both are `task.defer`red. `tryGetBlock` is `FindFirstChild(uuid)` (blocks are *named* by their uuid), and an undo
checked inline can run before the restored model is parented — with nothing re-checking afterwards.

`resetGroup` skips unbound outputs. Nothing will ever sample them again, so their buffer is the only remaining
copy of that run.

## Changes outside the module

Three, all deliberate:

**`shared/blockLogic/BlockLogic.ts` — `getDebugInfo`'s `forOutput`.** Previously pushed *nothing* when an output
held no value, so the grapher could not distinguish "no value" from "no entry" and the visualiser showed nothing.
It now emits a sentinel entry, mirroring `forInput`. Two details:

- It reads `this.isGarbage` directly rather than calling `getOutputValue`, which would run `recalculate()` as a
  side effect of merely inspecting.
- It only trusts stored output **while the block is enabled**. Storage retains the last value forever, so a dead
  block otherwise reports it as live — which showed up as a trace flatlining after its block was destroyed.

There is a `// fixme:` at `getOutputValue`'s garbage early-return: it returns without clearing
`calculatingRightNow`, so a burned block reports AVAILABLELATER instead of GARBAGE to *downstream blocks* from the
second tick on. The grapher is unaffected (it reads `isGarbage` directly). Not fixed — it is core logic and out of
scope.

**`client/gui/ColorChooserPopup.ts` — new.** The `Color4Chooser` popup (cursor positioning, `fitToScreen`, the
`"everything"` input sink, click/tap-outside dismissal) was ~60 lines inline in `ConfigControlColor`. Extracted
verbatim so the graph's per-channel colour swatch could reuse it. **One behaviour change:** the helper resolves the
UI scale at click time rather than at construction. That fixes a latent bug — changing GUI scale with a config
panel already open previously mispositioned the popup — but it is a change to a shipped control and deserves a
regression glance.

**`.eslintrc`** — added `/src/shared/blocks/BlockModelValidators.generated.ts` to `ignorePatterns`. It is
gitignored, regenerated by `npm run genvalidators` on every build, and emitted unformatted, so `--max-warnings 0`
failed on a clean tree.

## Studio assets

The window templates live under `Interface/Floating/Graph` and `Interface/Floating/GraphManager` in
`game/StarterGui/Interface.rbxmx`. Per repo convention these are authored in Studio, never built in code.

`Plot/DataPoints` holds three prefabs — `Point`, `Segment`, `Sentinel` — each cloned via `asTemplate`, which
destroys the original, so the authored copies never reach the screen. `Sentinel` anchors at `(0, 0.5)` and is full
height, so only its horizontal placement is ever written.

`Plot/Status` is a live `TextLabel`, not a template. The series row's colour swatch is a `TextButton`.

Both windows carry an authored `UIScale` of 1.3. **This is deliberate and was reverted once already** — attaching
`AutoUIScaledComponent` replaces it with `(viewportY / 1080) × globalScale`, which lands on 1.0 at 1080p and did
not track the GUI scale setting anyway. No floating window (Grid, LogicDebug included) follows the GUI scale; that
is pre-existing and consistent.

## Known gaps

- **Per-series eye is cosmetic** — swaps its icon but does not suppress the channel. Needs a per-channel flag on
  `RecordedOutput`.
- **No UI for "keep sampling while hidden"** — the `ObservableValue` exists and defaults on; nothing surfaces it.
- **Group merging is not implemented** — one window per group.
- **Auto-fit vs Expanding undecided** — both work; collapsing them into one control was under consideration.
- **Zero-length segments** — a fully duplicated sample draws a `0×2` frame and consumes a pool slot.
- **Reference grid** — needs a `GridLine` Frame template inside `Plot`.
- **Cursor asset ids** — resize-cursor plumbing is in and inert pending uploads.
- **Floating windows do not follow the GUI scale setting** — pre-existing, affects Grid and LogicDebug equally.
- **An all-garbage graph** draws its band on the last-used bounds, or `[-1, 1]` if nothing was ever drawn. There is
  no data extent to derive an axis from, so this is a choice rather than a fix.

## Test status

The acceptance suite is 119 items in twelve sections, A–L. **A–I are closed.** Remaining:

| # | Test |
| --- | --- |
| G12 | Inverted pins → `X/Y bounds inverted`, nothing drawn |
| J7 | Undo a deletion → series rebinds |
| J10 | Resize very narrow → downsamples, no stacking or lag |
| J14 | Six status messages (below) |
| J15 | Destroy a graphed block; X source destroyed → X returns to `Time` |
| K1 | Microprofiler, 3 graphs × vector3 in ride → flat 30 Hz redraw, not per-tick |
| K2 | Build mode, frozen graphs open → essentially idle |
| K3 | Large machine, graphs closed → no measurable cost |
| K4 | Full ring, wide window → no allocation churn |
| N1 | Row swatch → chooser opens at cursor; trace and swatch recolour live; colour survives ride→build |
| N2 | Two channels of one vector3 series set to different colours |
| N3 | Block config colour control still opens, positions and dismisses — regression check on the extraction |

**N3 is the one not to skip** — it is the only outstanding item touching shipped UI outside the graph tool, and
popup *position* is the specific thing to look at.

J14's six status strings, each distinguishing a case that previously looked like an identical blank plot:

| Condition | Message |
| --- | --- |
| No Y series | `No series bound` |
| Bound, never sampled | `No data recorded` |
| Time-X, every sample a hole | `No values in range` |
| Output-X that never produced | `X source has no values` |
| Output-X with values, no aligned timestamps | `No overlapping samples` |
| X points at an output that is gone | `X source unbound` |

## Working on this

There is no headless runtime — the engine is Roblox Studio. `bash .claude/skills/run-overengineered/smoke.sh`
compiles, assembles `place.rbxl`, and lints; it exits non-zero on any failure. If you are working alongside someone
running `npm run dev`, skip it — their watcher already compiles and syncs on save.

Reading `out/**/*.luau` to confirm what the compiler actually emitted is worth doing whenever a roblox-ts subtlety
is load-bearing. The LuaTuple bug above was invisible in the TypeScript and obvious in one line of generated Lua.
