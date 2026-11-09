# Block logic performance reference

Measured costs of the `BlockLogic` subscription methods, and of real blocks at idle, so the choice of method can be
made from numbers. Every input subscription that runs per tick is paid **per block, per tick, for the whole ride** —
a build with a few hundred blocks multiplies every row below.

Measured 2026-11-07 in Roblox Studio on a desktop (solo playtest). Absolute numbers will be several times higher on
phones; the ratios between rows are what carry over.

## Cost per subscription style

One logic instance with one subscription, ticked 20 000 times through the real compiled `BlockLogic`
(fastest of 5 runs). Memory is the bytes allocated per tick (largest heap delta over 25 runs of 2 000 ticks; a
garbage collection mid-run can only lower a delta, never raise it). All inputs are unchanged between ticks, which is
the normal state of a ride.

Re-measured 2026-11-08, after unchanged input reads stopped allocating; where a row moved, it shows before → after.

| Style | µs / tick | bytes / tick |
|---|---|---|
| no subscriptions (the `ticc` itself) | 0.28 | 64 |
| `onTicc` (empty handler) | 0.43–0.46 | 64 |
| `onk([1 key])` | 1.46 → 0.89 | 416 → 64 |
| `onk([3 keys])` | 3.37 → 1.41 | 1152 → 64 |
| `on` (all 5 inputs) | 4.59 → 2.01 | 1504 → 64 |
| `onk([1 key])` on a **wired** input, source block included | 3.07 → 1.73 | 769 → 193 |
| `initializeInputCache` + 1 `get()` per tick | 1.52 → 1.01 | 416 → 64 |
| `initializeConfigCache` + 1 `get()` per tick | 0.68–0.75 | 64 |
| `onkFirstInputs` into a `let`, read once per tick | 0.45–0.52 | 64 |
| `onkFirstInputs` after its first delivery | 0.35–0.40 | 64 |
| `output.x.set` every tick | 0.78–0.87 | 224 |

What the rows mean, minus the 0.28 µs / 64 B baseline:

- **Each input key read every tick costs about 0.3–0.5 µs**, whether it changed or not: `onk`, `on`,
  `onAlwaysInputs` and `initializeInputCache` all fetch and compare every key they cover. An unchanged read does not
  allocate: a value storage hands out one never-mutated result per stored value, and the input object is built only
  once a change is found. Before that, every key cost about 1 µs and 350 bytes.
- **A wired read costs about 2× a config read**, because it recalculates the source block.
- **`onkFirstInputs` costs nothing after its first delivery** (it disconnects), and **`initializeConfigCache` costs
  only the call** — neither allocates.
- Before reads stopped allocating, the per-read cost in a real build was higher than in isolation: an idle servo
  measured about 2.8 µs per read, most likely because garbage collection costs more with the game's larger heap (not
  separately proven). Not re-measured since.

## Choosing a method

| The input is… | Use |
|---|---|
| `connectorHidden` (config only), needed in a tick handler | `onkFirstInputs` into a closure `let` |
| `connectorHidden`, needed from an event handler or anything that can run before the first tick | `initializeConfigCache` |
| `connectorHidden`, and the handler is already an `on(...)` | destructure it from the `on` object |
| wireable, and the block acts on change | `onk` with only the keys that can change |
| wireable, read every tick by a side-effect block | `initializeInputCache` |

`initializeConfigCache` reads the input's storage directly. That is safe only for `connectorHidden` inputs: they
are never wired, so their storage always holds the configured constant (see its doc comment in `BlockLogic.ts`).

## Idle cost of real blocks

40 copies of each block (20 for AESA radar and proximity scanner), placed **unwired**, ridden, compared against an
empty ride. µs per block per frame of logic: a player's blocks are processed once per frame.

Measured 2026-11-07, before input reads stopped allocating, so blocks that read inputs every tick (servo, hinge,
gyroscope, motor) now cost less than shown. A re-measure on 2026-11-08 varied by up to 50% between runs of the same
build — too noisy for new figures; the per-method table above is the reliable measure of that change.

| Block | µs per frame | Other per-frame work |
|---|---|---|
| Servo — before / after the config-read fix | 43 / ~29 (estimated) | |
| Gyroscope | 36 | +5 µs PostSimulation |
| AESA radar, not scanning | 33 | ~1 ms per radar while scanning (spherecasts) |
| Hinge | 22 | |
| Motor | 20 | |
| Radar Section | 20 | +13 µs PreSimulation |
| Beacon | 18 | +6 µs PostSimulation, +11 µs PreRender |
| Rocket engine | 15 | |
| Magnet | 7 | PostSimulation grows with magnets² (+0.25 ms per step at 40) |
| Proximity scanner | 5 | +6 µs PreSimulation |
| Helium, GPS, wing, angle sensor, AND gate | 0.6–3.2 | |

The servo's "after" figure was measured with profiler markers inside the hot path (33 µs) and is corrected for their
measured overhead (0.21 µs per marker pair); re-measure it once the remaining markers are gone.

These are idle numbers: a block driven by logic also pays for its handler, its network sends and, on every client,
whatever those sends trigger.

### Sensors

| Sensor | µs per frame | Notes |
|---|---|---|
| Controller sensor — before / after sharing the gamepad read | 55.6 / 11.7 | |
| Mouse sensor — before / after sharing the pointer read | ~17 / ~6.5 | mostly in its own PostSimulation handler |
| Fire sensor, no fires / ~120 parts burning | ~7–9 / ~61 | walks every burning part each tick |
| Key sensor | 5.5 | |
| Radar warning receiver | 4.3 | +5.4 µs PreSimulation |
| Gravity sensor | 3.7 | plus its own PostSimulation handler (position-dependent, not shareable) |
| Ping sensor — before / after sharing | 3.6 / 2.1 | |
| Joystick, clock time, mass, keyboard, chat sensors | 0.2–3.0 | |

**Share what every instance would compute identically.** A sensor whose reading is the same for every copy in a
frame — the gamepad, the mouse, the ping — reads it through a module-level `PerFrame` (`engine/shared/PerFrame.ts`),
so forty sensors pay for one read instead of forty. Keep per-block anything that depends on the block's own
configuration or position, and anything whose timing would change (an event-driven value, or a per-block wheel delta
that resets when that block reads it).

## Reproducing

- **Method costs:** in a playtest client console (`scripts/studio-mcp.js luau client`), require
  `ReplicatedStorage.TS.blockLogic.BlockLogic`, build an instance with `setmetatable({}, BlockLogic)` +
  `:constructor(definition, {}, false)` (the class is abstract, so it has no `.new`), subscribe, then
  `:initializeInputs(config, blocks)` and `:enable()`, and drive `:ticc({ tick = i, dt = 1/60 })` with a fresh
  `tick` each call. Edit mode cannot load the module: its imports wait on `ReplicatedStorage.Assets`.
- **Block costs:** place N copies with `building_place` (under `PlayerGui`), ride with `md_set`, and capture
  with the MicroProfiler through LibMP (`rbx-perf-profiling` skill of the Studio MCP server); compare the
  `BlockLogic tick` scope against an empty ride.
- **Measure block costs in a session where the method benchmark has not run.** Its synthetic logics leave shared
  state behind that stops later rides' block logic from running at all (servos keep their prefab speed and torque),
  so every block then measures like an empty ride. Restart the playtest in between.
- A console call that runs for more than about 2 s without yielding is dropped ("Target is not reachable"); yield
  inside long loops.
