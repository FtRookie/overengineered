# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Editing consent

- **Changes with no runtime effect need no sign-off.** An edit that cannot change behaviour (renaming, grouping constants into an object, comment or formatting changes) is fine to make unprompted, as long as it benefits the code and does not destroy readability.
- **Behaviour-changing and major edits need consent.** Ask before acting, and wait for the answer.
- **Inform rather than ask when the edit is small and the risk is low.** A one-line change that only *might* alter behaviour is not worth stopping for — make it, then say plainly what changed and why in the same turn.

## Commands

```bash
npm install               # install dependencies
npm run check             # assetcheck + updatelogs — headless, no Studio
npm run checkassets       # asset integrity only (`-- -f` to list warnings in full)
npm run checklogs         # update-log consistency only
lune run assemble         # generate place.rbxl (required before opening Studio)
npm run dev               # run all watchers: rbxtsc + rojo + asset watcher
npm run build             # compile TypeScript once (rbxtsc)
npm run watch             # TypeScript compiler watch only
npm run rojo              # Rojo sync server only
node ./scripts/lunewatch.js  # place file asset watcher only
lune list                 # list available lune toolchain scripts
```

### Checks that run without Studio

`npm run check` runs `tests/assetcheck.luau` and `tests/updatelogs.luau` under **Lune, from the console** — no
Studio, no place file. `assetcheck` parses every `.rbxm`/`.rbxmx` under `game/`, resolves every registered
block id to a model, and runs each model through the block assertions. A clean run reports counts and exits 0;
warnings are summarised and listed in full with `npm run checkassets -- -f`.

**It runs the real code, not a re-implementation.** `@rbxts/lunit` is in the dependency list purely as a
*runtime compatibility shim*: `node_modules/@rbxts/lunit/scripts/lune-shim` (patched via `patch-package` for
this fork's RuntimeLib convention) lets a Lune script `require` the compiled game modules out of `out/`. So
`assetcheck` loads the actual `shared/blocks/BlockAssertions` — the same module `BlockListBuilder` runs in
Studio — instead of porting those rules into Luau and letting the two drift.

Two consequences: **`out/` must be compiled first** (the `npm run dev` watcher keeps it current), and the raw
`.rbxm` differs from the runtime model, so `assetcheck` preps each one — unparenting `WeldRegions` and
`MarkerPoints`, which weld init and `BlockCreation.MarkerPositions` do at runtime — before asserting.

Prefer these over guessing when a change touches block models, ids, or `BlockAssertions` itself.

### Tests in Studio

Tests (files named `*.test.ts`) execute inside Roblox Studio via `TestFramework`, which walks `ReplicatedStorage` and the script services for `*.test` ModuleScripts. Existing tests are namespace-style — `export namespace Tests.XTests { export function name() { … } }` using `Assert` from `engine/shared/Assert`. Block-specific tests use `BlockTesting` and `BlockTestRunner` from `src/shared/blocks/testing/`.

Anything touching Roblox services or instances is Studio-only: lunit's Lune shim resolves the game's own modules but not `@rbxts/services`, so a test importing `Workspace` or creating instances cannot run headlessly.

### Running compiled game code from the console

The same shim generalises: anything in `out/` that does not import `@rbxts/services` can be loaded and called
outside Roblox. The `/run-overengineered` skill wraps this.

```bash
.claude/skills/run-overengineered/driver.sh verify     # typecheck + lint + asset integrity, no compile
.claude/skills/run-overengineered/driver.sh modules    # ~385 modules loadable this way
.claude/skills/run-overengineered/driver.sh eval '
local Objects = rbx("out/engine/shared/fixes/Objects").Objects
print(Objects.deepCombine({ b = { c = 2 } }, { b = { c = 9 } }).b.c)   --> 9
'
```

Reach for this instead of reasoning about behaviour: utility namespaces, validators, serializers and the pure
parts of block logic are all directly callable, and `eval` is also the fastest way to settle a Luau semantics
question (truthiness, `string.format`, `math.clamp` argument order, NaN comparison).

Two limits. **`verify` does not compile** — `rbxtsc -w` owns `out/` during `npm run dev`, so a second compiler
corrupts what Studio is syncing; `driver.sh build` refuses outright while the watcher is up. And a module
importing Roblox services cannot load, which rules out most `client/` code and any block that touches
`Workspace`.

Lint/format: ESLint + Prettier are configured via `.eslintrc`. Run with `npx eslint src` or via IDE.

## Stack

This is a **Roblox game** written in **roblox-ts** (TypeScript compiled to Lua). The compiled output goes to `out/` and is synced into Roblox Studio via **Rojo** (`default.project.json`). A custom TypeScript transformer (`src/engine/transformer/`) injects array/map/set macros and other Lua-specific utilities at compile time.

The project uses a private fork of roblox-ts (`github:anywaymachines/roblox-ts-awm`) — `npm install` pulls it from GitHub, not the npm registry. Do not upgrade `roblox-ts` from npm.

## Source Layout

```
src/
  engine/       # Framework layer — Component, DI, events, utilities. Not game-specific.
  shared/       # Game logic shared between client and server
    blockLogic/ # Core block logic runtime
    blocks/     # All block definitions and implementations
  client/       # Client-only: GUI, rendering, input
  server/       # Server-only: database, anti-exploit, player data
  anywaymachines/ # Proprietary backend (not needed for local dev)
```

Per-system reference notes live in `docs/` and are documentation only — nothing there is read by the build. Read the relevant one before working on that system; they carry the decisions and traps that the code cannot state for itself (e.g. `docs/GRAPHING_TOOL.md`, `docs/BLOCK_1XN_DEPRECATION.md`).

## Block System Architecture

The logic block system is the core of the game. Understanding it is required for most work in `src/shared/`.

### Block IDs and save data

The `id` field on a `BlockBuilder` is the stable identifier used to persist player save data. **Renaming an `id` string breaks existing saves.** Two forms:

- **Explicit `id:`** — set directly on the exported `const` in a block's own file (e.g. `id: "tpscounter"`).
- **Key-as-id** — blocks in `src/shared/blocks/blocks/grouped/BuildingBlocks.ts` use `BlockBuildersWithoutIdAndDefaults` (no explicit `id:`). `BlockCreation.arrayFromObject` converts the object's keys into the `id` for each entry. Renaming a key in that object is therefore also a breaking save-data change.

### Registering a block

The `BlockBuilder` export lives at the **bottom of the block's own file** (e.g. `LuaCircuitBlock.ts` exports `LuaCircuitBlock` at the end). Logicless blocks (no `BlockLogic`) go in `src/shared/blocks/blocks/grouped/BuildingBlocks.ts`. Once defined, the export is imported and added to the array in `src/shared/SandboxBlocks.ts` to appear in-game.

### Defining a block

A block is a plain object `satisfying BlockBuilder`, exported as a `const`. The `BlockCreation.defaults` spread covers model/weld/category resolution for standard cases:

```ts
export const MyBlock = {
    ...BlockCreation.defaults,
    id: "myblock",
    displayName: "My Block",
    description: "...",
    logic: { definition, ctor: Logic },
    modelSource: {
        model: BlockCreation.Model.fAutoCreated("GenericLogicBlockPrefab", "LABEL"),
        category: () => BlockCreation.Categories.other,
    },
} as const satisfies BlockBuilder;
```

### Block logic class

Blocks that access named model children (e.g. `VehicleSeat`, `GreenLED`) must use `InstanceBlockLogic<typeof definition, TModel>` where `TModel extends BlockModel` declares those children as typed fields. Do **not** use `BlockLogic` with `block.instance?.FindFirstChild(...)` — the optional chain hides a guaranteed crash when `instance` is undefined, and the cast to a concrete type discards the type safety.

```ts
type MyModel = BlockModel & {
    SomePart: BasePart;
};
class Logic extends InstanceBlockLogic<typeof definition, MyModel> { ... }
// access: this.instance.SomePart (typed, non-optional)
```

**Do not mark those children `readonly` by default.** A block's model is regenerated on every ride exit and
its parts can be swapped, so the reference is not fixed. `readonly` is for things that genuinely never change —
UI templates and the like. Much of the block tree marks it anyway (76 declarations do, 28 do not); follow the
28. `InstanceBlockLogic` already declares `readonly instance: TBlock`, which is the part that really is fixed —
and it is why `this.instance` is typed as your model while the constructor's `args.instance` is only
`BlockModel`. Read children off `this.instance`, never off the constructor argument, and no cast is needed.

All block logic extends `BlockLogic<typeof definition>`. The entire logic is wired in the constructor — there are no lifecycle methods to override. The constructor uses protected methods to subscribe to inputs:

- `onkRecalcInputs(keys, func, elseFunc?)` — fires when another block requests this block's output, but only when all listed inputs have valid values and at least one changed.
- `initializeInputCache(key)` — returns an auto-updating `{ get, tryGet, getType, tryGetType }` for one input (fed by `onk`, i.e. every-tick-on-change). Read it inside an `onTicc`. **This is the preferred way for a side-effect block that must act every tick from its inputs** (e.g. a weapon firing while held): no `ctx`, no manual `this.input[key].get(ctx)` + sentinel handling. Use only in blocks **without** any `*Recalc*` subscription — it rides on `onk`, which can run before recalc. **For a `connectorHidden` (config-only) input, read it once with `onkFirstInputs([key], ({ key: value }) => (state = value))` into a closure `let`, not an input cache.** Such a value is set in build mode and is constant for the whole ride (the logic is re-instantiated on each ride enter), so a per-tick cache read is wasted work. Plain `onk` would deliver the first value too (first availability counts as a change against the empty input cache — both methods share the same read path in `executeFuncWithValues` and differ only in `skipIfUnchanged` and disconnection), but it keeps re-evaluating every tick for the rest of the ride — wasted work for a value that never changes again. `onkFirstInputs` fires once when the value first arrives and disconnects. Every config-read block in the repo (`FunctionBlock`, `LuaCircuitBlock`, `SuspensionBlock`, `KeySensorBlock`, …) uses it; store the value and read the closure variable each tick.
- `initializeRecalcInputCache(key)` — same shape, but fed by `onkRecalcInputs` (recalc-only). Use with `onkRecalcInputs([], ...)` when you need inputs independently of each other (e.g. AND-gate that can short-circuit on `false` without both inputs being ready). Only for blocks **with** outputs — recalc never fires for an output-less block.
- `onTicc` / `on` / `onk` — fire every tick (not on-demand); avoid for pure logic blocks.

### AVAILABLELATER vs GARBAGE

`BlockLogicValueResults` has two sentinels:

- `availableLater` — the source block hasn't produced a value yet this recalc cycle. Also occurs with circular logic (a block wired to itself or any dependency cycle, e.g. a NOT gate feeding back into its own input) — in that case it never resolves.
- `garbage` — unconfigured value by player (e.g. unwired input); will never produce a value.

These are returned by input storage when no value is set, and propagated through `BlockBackedInputLogicValueStorage` from wired sources.

`garbage` means *will never produce a value*, so it covers more than an unwired input: a burned block, and a destroyed one (the runner calls `disableAndBurn()` on any block whose tick throws, and a block whose model was destroyed throws every tick thereafter).

### Reading block state from outside — `getDebugInfo`

`getDebugInfo` is the read-only view of a block used by `LogicVisualizer` and the graphing tool. Three properties it must keep:

- **It never forces a recalculation.** It reads `isGarbage` and the stored value directly rather than calling `getOutputValue`, which recalculates the block as a side effect. A consequence worth knowing when debugging: an output nothing pulls reads as `AVAILABLELATER`, because nothing has asked it to compute.
- **It only trusts a stored output value while the block is enabled.** `OutputLogicValueStorage` retains the last value indefinitely — nothing clears it when a block stops running — so a dead block would otherwise keep reporting a stale value as though it were live.
- **Both inputs and outputs report sentinels.** An output holding nothing emits `GARBAGE`/`AVAILABLELATER` in its `type`, the same as an input.

**Pausing a ride does not disable blocks.** It is `BlockLogicRunner.stopTicking()`, which disconnects the tick loop; `isEnabled()` stays true throughout. Anything gating on enabled state therefore keeps working while paused — which is what makes the paused visualiser readable.

### CalculatableBlockLogic

For pure computation blocks (no side effects, output is a pure function of inputs), extend `CalculatableBlockLogic` instead. It automatically calls `disableAndBurn()` and propagates GARBAGE downstream when any input goes to GARBAGE. Override `calculate()` instead of wiring up handlers.

### elseFunc convention

`garbage` and `availableLater` are handled the same way in `elseFunc` — both mean no valid value is available, so typically just unset the output:

```ts
(result) => {
    this.output.result.unset();
},
```

### Input type definitions

Use `BlockConfigDefinitions` for standard type sets:

```ts
types: BlockConfigDefinitions.any     // bool, number, vector3, string, byte, color, sound
types: BlockConfigDefinitions.number  // number only
types: BlockConfigDefinitions.bool    // bool only
```

For output types, use a plain string array — `types: ["bool"]`, `types: ["vector3"]`, etc. Use `Objects.keys(BlockConfigDefinitions.any)` only when the output must support all types (e.g. memory/passthrough blocks).

### Input display options

`inputOrder: [...]` on the definition controls the order inputs appear in the config UI. List all input keys in the desired display order.

`connectorHidden: true` on an individual input prevents the player from wiring that input from the logic system at runtime — the value is treated as a constant set via the config panel only (e.g. `imin`/`imax` on the PID controller). Read such an input once with `onkFirstInputs([key], …)` rather than `initializeInputCache` or `onk` (see the input-subscription notes above) — it's set in build mode and constant for the ride, so any per-tick read or change-check after the first delivery is wasted; `onkFirstInputs` delivers once and disconnects.

`configHidden: true` hides the input from the config menu UI, reducing visual clutter for inputs that don't need to be manually configured (e.g. the 16 I/O nodes on LuaCircuit). When `configHidden: true` and `connectorHidden: false`, the connector will still appear on the block face if something is wired to it.

## task.spawn in Components

When a `Component` uses `task.spawn` for a long-running loop, a guard at the **top of the loop** is not sufficient if yield points (`task.wait()`) exist inside called functions. The component can be destroyed during those inner yields, and any state writes after the yield will operate on cleared/destroyed state.

Guard pattern — check `isDestroyed()` (or `isEnabled()`) after any yield point before writing back to Component state:

```ts
task.spawn(() => {
    while (true as boolean) {
        task.wait();
        if (this.isDestroyed()) return; // top-of-loop guard
        if (!this.isEnabled()) continue;

        const result = this.doWorkThatMayYield(); // task.wait() may fire inside here
        if (this.isDestroyed()) {                 // guard again after the yield
            result.cleanup();
            return;
        }
        this.state = result; // safe to write now
    }
});
```

## Client-only handlers in block constructors

Block logic is effectively client-only at runtime, and only runs on the **owning player's client** — not on spectating clients. The server instantiates block logic solely for initialization and test plane purposes — no block in the codebase does meaningful work server-side (confirmed: zero `RunService.IsServer()` calls exist in any block file). Treat the owning client as the only real execution environment when writing block logic.

Any handler that calls a client-only API — `C2SRemoteEvent.send()`, `Players.LocalPlayer`, machine state, etc. — must be registered **after** `if (!RunService.IsClient()) return`, or guard internally with the same check. Calling a client-only API on the server throws at runtime.

## Component Lifecycle

`enable`, `disable`, and `destroy` directly map to in-game block state:
- **`enable`** — called when the player enters Ride Mode; all blocks become active
- **`disable`** — called when a block is turned off by configuration or an error state (e.g. GARBAGE)
- **`destroy`** — managed by the Ride Mode controller when the vehicle is torn down

Block instances (including all model parts) are **fully regenerated from the original block model** when the player exits Ride Mode back to Build Mode. It is safe to destroy instance parts in `onDisable` — they will be recreated fresh on the next enable.

**A teardown handler that broadcasts must guard on `isDestroying()`.** A ride exit disables every block in one pass, so a "stop the effect" message per block is a burst of remotes for models that are about to stop existing — a real source of despawn lag. `Component.isDestroying()` is true from the moment `destroy()` begins, and the flag is handed down to children before they are disabled — by `parent()` for parented components, and by `markChildDestroying` in `ComponentChildren` / `ComponentKeyedChildren` / `ComponentChild`, which is the path block logic takes. So a block can tell a despawn from a burn synchronously:

```ts
this.onDisable(() => {
    if (this.isDestroying()) return;
    ...send...
});
```

Plain `onDisable` with no guard is still right for purely local work. Before adding the guard, confirm the receiving side reaches the same resting state on its own (an effect handler that bails on a destroyed instance, a timer that stops when its block loses its parent), since the message is genuinely dropped.

`HostedService` extends `Component` but cannot be disabled — it lives for the entire session, and one that was registered is enabled for all of it. Still subscribe through `this.event` rather than connecting signals directly: the guarantee is a property of how it is registered today, not of the class, and a service demoted back to a plain `Component` would leave raw connections running.

`Component` mechanics (`engine/shared/component/Component.ts`):

- `enable()`/`disable()`/`destroy()` are idempotent, and everything is a no-op after destroy. `destroy()` calls `disable()` first, so `onDisable` handlers always run before `onDestroy` handlers during teardown.
- `onEnable(func)` fires immediately when subscribing to an already-enabled component; `onDisable` fires only on a real transition.
- `parent(child, config?)` ties the child's lifecycle to the parent — enable/disable/destroy each propagate unless opted out (`{ enable: false }` etc.), and a child parented to an already-enabled parent is enabled on the spot. Parenting also hands the parent's DI scope to the child; this is how injection flows down the component tree.
- Every injected component gets its own DI scope with itself registered in it (resolvable by its class). `cacheDI(value)` adds a value to that scope for descendants; `onInject(func)` runs once DI arrives and must be subscribed *before* parenting — it throws afterwards.
- `getComponent(Clazz)` lazily creates and caches one attached component per class, parenting it (or destroy-linking a non-`Component`) automatically.

## Save Storage

The **external database** (`src/server/database/ExternalDatabase.ts`, a Bun/SQLite backend) is the source of truth for slot blocks. The Roblox DataStore is an **outbox** (when the backend is unreachable) and a **legacy fallback** (slots not re-saved since the flip). The player row — slot list, settings, achievements — is the other way round: the DataStore is the write target, and the external db gets a coalesced mirror, because the DataStore dies with the experience and the blocks would otherwise be left with no index.

- **`savedAt`** (wall-clock ms, on the save blob) picks the winner. Absent = oldest. On a tie the DataStore wins.
- **Unreachable backend blocks loads AND automatic writes.** A stale read plus a fresh write stamps the OLD build as newest, and the flusher then destroys the real one. Manual save is allowed behind a multi-stage confirmation and goes to the outbox.
- **A player whose row could not be loaded** may play, but every write for them is refused — `lastRun` excepted, since ride→build restores from it.
- **The backend has no DELETE**: deletion writes an empty blob with a fresh `savedAt` as a tombstone.
- **`lastRun` (-1) never leaves the DataStore.** Quit (-2) and autosave (-3) do go external.
- `SlotDatabase.resolveBlocks` / `setBlocks` are the only entry points; routing is derived from the index so no call site can forget it.

**Studio dev config** lives in **`.env`** (see `.env.example`). `npm install` and `npm run dev` generate `.studioconfig.json` from it — Roblox cannot read `.env`, so the values must arrive as a Rojo-synced ModuleScript. That file is generated, never edited, gitignored, and deliberately outside `src/` because it holds a token. Both keys below are Studio-only.

| `.env` key | effect |
|---|---|
| `WRITETOKEN` | empty = read-only. A token is a live write path to **production** — and a Studio session autosaves and snapshots on exit, so it writes without anyone pressing Save. It also lands inside anything `rojo build` produces (`lune run assemble`, the publish path, ignores JSON and is safe) |
| `DB_BASEURL` | empty = production; point at `npm run dbrelay` (`scripts/dbrelay.js`) if your link cannot pull real saves |

## Save Data & Config Versioning

### Block save data (`src/shared/building/BlocksSerializer.ts`)

Building saves are versioned. Each version is a `const vN` implementing `UpgradableBlocksSerializer<SerializedBlocks<TNew>, typeof vPrev>` with an `upgradeFrom(prev, blockList?)` method. The `current` pointer and `latestVersion` export are derived automatically from the last element of the `versions` array.

To add a new save version:
1. Define `interface SerializedBlockVN extends SerializedBlockVPrev { ... }` if the per-block schema changes (only needed when fields are added/removed/replaced).
2. Create `const vN: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockVN>, typeof vPrev>` with `version: N` and `upgradeFrom`.
3. Append `vN` to the `versions` array.

`upgradeFrom` receives the full `SerializedBlocks<TPrev>` and must return `SerializedBlocks<TNew>`. Add a second `blockList: BlockList` parameter only when live block definitions are needed (e.g. to fill in default config values or resolve wire types). No-op migrations still bump the version and return `{ version: this.version, blocks: prev.blocks }` unchanged.

### Player config (`src/server/PlayerConfigVersioning.ts`)

Player settings (camera, graphics, terrain, etc.) are versioned. Each version is a `const vN` implementing `UpdatablePlayerConfigVersion<TCurrent, TPrev>` with an `update(prev)` method.

**Adding a field needs no version.** Every load runs `Config.addDefaults(data.settings ?? {}, PlayerConfigDefinition)` (`client/PlayerDataStorage.ts`), which walks the definition and fills anything the save is missing — `config[key] ??= def.config` for scalars, `{ ...def.config, ...config[key] }` for nested tables. A new field appears with its definition default on the next load, in every old save, for free. Changing a *default* needs no version either: existing saves keep the value they stored, new ones pick up the new default.

**A version is needed when an existing value has to be reinterpreted**, because `addDefaults` cannot do that:
- **Changing a field's type or shape.** `addDefaults` sees the type mismatch and overwrites with the default, silently discarding the player's setting. `v2` exists precisely for this — `beacons` went from `boolean` to a table, and its `update` carries the old value across as `{ plot: prev.beacons ?? true, players: false }`.
- **Renaming or removing a key.** The old key is left in the saved table and nothing reads it; if you need its value moved somewhere, or want the dead key gone, that is the upgrader's job.
- **Changing what a field means** while keeping its type. Nothing can detect this automatically.

To add one:
1. Define `type PlayerConfigVN = Replace<PlayerConfigVPrev, "field", NewType>` (or `& { readonly newField: T }` if a version is being added for another reason anyway).
2. Create `const vN: UpdatablePlayerConfigVersion<PlayerConfigVN, PlayerConfigVPrev>` with `version: N` and `update`.
3. Append `vN` to `versions`.

`update` receives `Partial<TPrev>` (fields may be absent in old saves) and must return `Partial<TCurrent>`. Always spread `prev` first and set `version: this.version`. Use `PlayerConfigDefinition.<field>.config` for defaults so they stay in sync with the definition source of truth.

## Remotes / Client-Server Communication

All remote types are in `engine/shared/event/PERemoteEvent.ts`. Pick the right class for the direction:

| Class | Direction | Use case |
|---|---|---|
| `C2SRemoteEvent` | Client → Server | Client action that server must handle |
| `S2CRemoteEvent` | Server → Client(s) | Server pushing state to one or all clients |
| `BidirectionalRemoteEvent` | Both (wraps `.c2s` + `.s2c`) | Two-way communication on a single named channel |
| `C2S2CRemoteFunction` | Client → Server → Client (response) | Client requests something and awaits a server response |
| `S2C2SRemoteFunction` | Server → Client → Server (response) | Server asks a client something and awaits a response |
| `C2CRemoteEvent` | Client → all other Clients (via server relay) | Broadcast from one client to others |
| `A2SRemoteEvent` | Anyone → Server | Fires from either side, always received by server |
| `A2OCRemoteEvent` | Anyone → a specific owner Client | Targeted client delivery from any context |

**`BlockSynchronizer`** is the standard tool for syncing block state across all clients. When a client calls `.send(arg)`:
1. Fires `.invoked` locally so the sender updates immediately
2. Sends to server via `c2s`; server validates with runtime type-checking (kicks the player on failure) and runs any middleware
3. Server broadcasts to all other players via `s2c`
4. Newly joined players automatically receive saved state

Use `BlockSynchronizer` for any block property that must be consistent across all clients. Attach it to the block's `logic.events` in the `BlockBuilder`. Because state changes originate from the client and are relayed by the server rather than computed server-side, processing load is shifted to clients — the server acts only as a validator and broadcaster, keeping server overhead low.

**`BlockSynchronizer` API:**

- `.send(arg)` — send from either side; on client fires `.invoked` locally then sends to server; on server broadcasts to all loaded players
- `.sendOrBurn(arg, block)` — like `.send` but calls `block.disableAndBurn()` if `arg` fails the type check
- `.invoked` — read-only signal fired on the client when state arrives (both from local `.send` and from server broadcast)
- `.sendBackToOwner = true` — also send the server-processed value back to the invoking client; use when server middleware transforms the value (e.g. text censoring) and the sender needs the result
- `.getExisting = (stored) => TArg` — override what's replayed to newly joined players; defaults to the last stored value as-is

**Middleware** (server-only; all registered middleware runs in order; return `"dontsend"` to suppress or `{ success: true, value: arg }` to pass through, optionally with a modified `arg`):

- `.addServerMiddleware((invoker, arg) => ...)` — global gate; runs once per send before broadcasting. `invoker` is `undefined` when the server calls `.send()` directly. Use to block the entire broadcast based on the sender's state (e.g. sender's setting is off).
- `.addServerMiddlewarePerPlayer((invoker, player, arg) => ...)` — per-recipient filter; runs once per player per send. Use to suppress or transform delivery for individual recipients (e.g. recipient's setting is off, or either party has blacklisted the other).

See `src/server/blocks/logic/TracerBlockServerLogic.ts` for a canonical two-tier middleware example.

**Server block logic** — blocks that need server-side behaviour (middleware, anti-cheat, server-only services) get a companion class extending `ServerBlockLogic<TBlockLogicCtor>`:

1. Create `src/server/blocks/logic/MyBlockServerLogic.ts`, decorated `@injectable`. The constructor receives the block's client logic class as its first parameter (injected by the controller), then any `@inject` server services. Call `super(logic, playModeController)`.
2. Wire middleware or other server behaviour in the constructor via `logic.events.<synchronizer>.addServerMiddleware(...)`.
3. Import the class in `src/server/blocks/ServerBlockLogicController.ts` and add an entry to `serverBlockLogicRegistry` keyed by the block's id string.

`ServerBlockLogicController` automatically registers a global `addServerMiddleware` on every `logic.events` entry for all blocks that validates the block exists in the workspace and the invoker is in ride mode — this runs before any block-specific middleware, so individual server logic classes don't need to repeat that check. `protected isValidBlock(block, player)` is also available on the base class for ad-hoc checks.

**Anti-spoofing guard in `.invoked` handlers** — the global middleware check covers `addServerMiddleware` handlers only. Direct `.invoked.Connect` listeners (used when the server needs to react to a client event beyond just broadcasting) are NOT covered and must guard manually: always call `if (!this.isValidBlock(block, player)) return;` at the top of any such handler. See `PropellantBlockServerLogic.ts` for the canonical example.

**`isValidBlock` proves ownership, not block type.** It checks that the model exists in the workspace, that the sender is in ride mode, and that the block is on their plot — nothing about *which* block it is. A handler that then indexes children the payload's block type is assumed to have (`WaitForChild("Screen")`, `block.MainPart`) will hang or throw on any other block the sender owns. Resolve rather than index, or validate the type.

### Choosing a remote for block state

**`A2SRemoteEvent` performs no validation whatsoever.** `OnServerEvent` fires `_invoked` with the raw client payload — no type check, no kick, and none of the global block-validity middleware. It is only appropriate for events with no untrusted fields. **Prefer `BlockSynchronizer` for anything carrying block state**: `handleC2S` runs the payload through its `t.Type` and kicks the sender on mismatch, applies the global block-validity middleware, broadcasts to other clients, and replays to players who join later.

**Write the validator as tightly as the input.** A field typed `t.number` where the block's own input clamps to 0–10, or `t.string` where only a handful of values are legal, hands a crafted payload straight to whatever consumes it — and a synchronizer's callback runs on **every receiving client**, so one bad send breaks the block for everyone in the server, not just the sender.

- Mirror input clamps with `t.numberWithBounds(min, max, step?)`. Its bounds ride along as `additional` so a caller can read them back. (Note the guards are `if (min && …)`, which works for `min: 0` only because `0` is truthy in Luau.)
- Never index an enum or lookup table with a loosely-typed field. `Enum.Whatever[payload.field]` yields `nil` for an unknown name, and assigning `nil` to an Enum property raises.
- `t.any.as<T>()` is a **compile-time cast with no runtime effect** — it validates nothing. Neither does `.as<>()` on any other checker.
- Constraints spanning two fields (a buffer whose length must match a `size` field) cannot be expressed in the type; check them at the top of the handler and return.

**Every `send` must carry the complete state.** A synchronizer keeps one payload per block and replaces it wholesale rather than merging, and that single payload is all a joining player is replayed. A send carrying only the field that changed leaves late joiners without the rest. Use one `sendAll()`-style helper that always emits the full object, called from every path — `SpeakerBlock` and `LedDisplayBlocks` both do this and say why. For the same reason, prefer one synchronizer carrying complete state over several carrying parts of it: split state also makes replay order depend on declaration order.

**The callback runs on clients, never on the server.** `func` is wired only inside `BlockSynchronizer`'s `IsClient()` branch, and a client's own `send()` fires it locally *before* the round trip — so the sender updates immediately. Put the work that builds or mutates instances there and the server does none of it, which is both the performance argument and the reason a malicious payload cannot make the server do work on its behalf.

**Avoid raw Roblox instances.** The codebase wraps everything — use the provided abstractions rather than reaching for raw Roblox APIs. `ArgsSignal` (a fully custom pure-Lua signal, not a `BindableEvent` wrapper) is the standard for events; `PERemoteEvent` subclasses wrap `RemoteEvent`/`RemoteFunction`; helpers in `engine/shared/` cover most common needs.

**Block damage is server-authoritative.** Block HP lives on the server (`ServerBlockDamageController`); clients never store health. Deal damage by calling `BlockDamageController.instance.applyDamage(block, damage)` on the **owning client** — it accumulates per block and flushes one batched `CustomRemotes.damageSystem.damage` send per frame. Never use a blocking `C2S2CRemoteFunction` for high-frequency events like this (a laser hits every tick) — a fire-and-forget `C2SRemoteEvent`, batched per frame, is the pattern. The server decides breaks and broadcasts `damageSystem.broken`; subscribe to that for client reactions (e.g. TNT chains).

**C2C effects run on every client.** A projectile/effect spawned via `C2CRemoteEvent` is created on the sender *and* every other client. Any side effect that must happen once — applying damage, triggering an explosion — must be gated to the owner (`if (Players.LocalPlayer === this.owner)`), or the server receives it once per player. Thread an `owner: Player` through and gate on it (see `WeaponProjectile`).

**Weapon damage modifiers are sequential, not override (Balatro-style).** `applyModifiers(base, modifiers, key)` in `BaseProjectileLogic.ts` folds an *ordered* list left-to-right: for each modifier carrying that `key`, `value *= mv.value` when `isRelative`, else `value += mv.value`. Order matters — `+5` then `×2` is `(base + 5) * 2`, not `(base + 5×2)`. Each stat (`impactDamage`, `heatDamage`, `explosiveDamage`, `speedModifier`, `lifetimeModifier`) is reduced **independently** over the same ordered list. The per-output list is assembled by `ModuleCollection.recalc` from the module graph in path order: the emitter's own modifier → connected upgrades → the `1/N` split-ratio for multiple outputs. It is *not* a collapse-to-one-value override — an older `calculateTotalModifier` did that and was a bug.

**Server-sent effects need a network-ownable host part.** `ServerEffect.send(part, …)` silently no-ops for anchored parts (`CanSetNetworkOwnership` is false). Prefer an already-replicated part (e.g. the source block). For a position-only effect, create a throwaway part **unanchored**, send, then anchor it in the same synchronous block (no physics step runs between) so it neither falls nor is skipped — a freshly-created part can otherwise arrive `nil` on clients before replication catches up.

**`ChildAdded` fires before a block's descendants replicate.** When a block model is added to a plot's `Blocks` folder, its `PrimaryPart` (and other children) may not exist yet. Don't read them in the `ChildAdded` handler — use `model:GetPivot()` for position, or react to the placement remote's client-side `placeBlocks.completed` signal, which carries the placed models after the round-trip (and only fires for real placements, not world load / ride→build regeneration).

## roblox-ts / Luau Gotchas

These affect all code in this repo and are the most common source of subtle bugs.

**Luau uses 64-bit IEEE 754 doubles** — not 32-bit floats. There are no integers at runtime; all numbers are doubles. This gives ~15 significant decimal digits of precision. Constants beyond 15 significant figures are representational noise and should be trimmed when writing or porting numeric code.

**Truthiness differs from JavaScript.** In Luau, `0` and `""` are **truthy**. Only `false` and `nil`/`undefined` are falsy. The `lua-truthiness` ESLint rule catches this but is disabled in this project — be vigilant with numeric/string conditionals.

**No `null`.** Use `undefined` only. `null` is banned by ESLint (`no-null` rule).

**Array length is `.size()`, not `.length`.** The `size-method` ESLint rule enforces this.

**Iteration patterns, in order of preference:**
- `for (const v of arr)` — preferred for arrays; always use the expanded block form (never single-line)
- `for (const [k, v] of pairs(obj))` — standard for key-value maps/objects; heavily used throughout the codebase
- `.map()` — widely used and idiomatic for transformations
- `.forEach()` — acceptable but slower than a for loop; use when readability wins
- `ipairs()` — use for ordered plain Lua tables when index matters

**Never compare a `LuaTuple` without destructuring it.** Multi-return functions return `LuaTuple`s — not just the obvious `string.match`/`string.find`/`.gsub`/`pcall`, but plenty of Roblox APIs whose tuple-ness is easy to miss: `CanSetNetworkOwnership`, `GetBoundingBox`, `WorldToScreenPoint`, `WorldToViewportPoint`, `ReadVoxels`, `GetGuiInset`, `GetAsync`, `GetUserThumbnailAsync`. Using any of them directly in a comparison (`string.match(s, p) === undefined`) compiles to `{ string.match(s, p) } == nil` — a fresh table compared to nil, which is always false. Destructure first (`const [m] = string.match(s, p); if (m === undefined) …`) or index the tuple (`.gsub(...)[0]`).

**Nothing catches that mistake for you.** `LuaTuple<T>` is `T & brand`, i.e. a non-nullable array type, so TypeScript sees a legal (if pointless) comparison and `strict` does not object. The `roblox-ts/misleading-luatuple-checks` lint rule only reports a LuaTuple used *as* a condition, an assignment, or a declaration — never one inside a comparison — and that is still true in the plugin's latest version. The result is not a wrong value but a dead branch: the comparison is constant `false` whether the match succeeded or not, with no crash and no warning. Grep for `string.match(`/`string.find(`/`.gsub(` when a conditional behaves as though it never fires.

**Never write a function returning `LuaTuple<T> | undefined`.** The same trap, one step worse: storing the result in a variable *packs* it, so `const r = f();` compiles to `local r = { f() }` and the `undefined` return arrives as an empty table. `if (!r)` and `r === undefined` are then constant `false`, the guard is dead, and destructuring `r` yields all-`nil` fields that flow on as real values. Carry the "no result" case *inside* the tuple as a sentinel field and destructure straight from the call:

```ts
// returns arity 0 when the value cannot be used
export function widen(info: DebugInfo): LuaTuple<[number, number, number, 0 | 1 | 3]> { … }

const [x, y, z, arity] = widen(entry);
if (arity === 0) return;
```

Only a *direct* destructure compiles to `local x, y, z, arity = widen(entry)`. Assigning first always packs, whatever the declared type says.

**A compiled namespace method is a Luau method — call it with `:`, not `.`.** Any exported function that uses
`this` compiles to `function ns:name(...)`, so reading it back from compiled output (or through the Lune shim)
needs the colon. `t.typeCheck(5, t.number)` returns **`false`** because `5` binds to `self`, where
`t:typeCheck(5, t.number)` returns `true` — it fails with a wrong answer rather than an error, so nothing
flags it.

**Never name a variable after a Luau global.** TypeScript has no idea these exist, so nothing warns you, and the two ways it goes wrong look nothing alike.

*Silent* — a local shadows the global for the rest of its scope, and the break lands on whatever calls it next, often in a later edit rather than the one that introduced it: `next`, `pairs`, `ipairs`, `select`, `unpack`, `print`, `warn`, `error`, `assert`, `pcall`, `xpcall`, `require`, `tostring`, `tonumber`, `rawget`, `rawset`, `setmetatable`, `getmetatable`; the library tables `table`, `string`, `math`, `os`, `task`, `coroutine`, `debug`, `utf8`, `buffer`, `bit32`; and the Roblox globals `game`, `workspace`, `script`, `shared`, `Enum`, `Instance`, `tick`, `time`, `wait`, `spawn`, `delay`. Suffix instead — `nextI`, `segmentPairs`, `startTime`.

*Loud* — a few are reserved by the compiler and fail the build with `Cannot use identifier reserved for compiler internal usage`. `type` is one. This only appears when `rbxtsc` emits, so `driver.sh verify` (which is `tsc --noEmit`) passes right up until the watcher rejects it.

**Never use `for...in`.** It has zero usages in the codebase. In roblox-ts it compiles to Luau behavior that iterates string keys of objects (JavaScript semantics), which is meaningless for typed arrays or maps. Use `for...of` for arrays and `pairs()` for key-value iteration.

**Compiler macros:**
- `$tuple(a, b)` — creates a `LuaTuple` for multiple returns (compiles to `return a, b` in Lua)
- `$trace(...)` / `$debug(...)` / `$log(...)` / `$warn(...)` / `$err(...)` — logging macros that route through `Logger` (→ Lua `print`/`warn`). Output goes to the console/output window. All levels are disabled by default; admins can toggle them in-game via the Developer Switches tab in `AdminGui`. `$warn` and `$err` use Lua's `warn()` when active.
- **`print` for temporary diagnostics, the macros for anything that ships.** A macro is gated behind the Developer Switches, which means enabling them by hand every test session — pointless for lines that get deleted at the end of it. Use a bare `print` while diagnosing, and remove every one before the work is done; use `$log`/`$warn`/`$err` for logging that stays in the code for monitoring.
- `$beginScope(name)` — opens a named logging scope (matched with `Logger.endScope()`)
- `$autoResolve(func)` — wraps a function so its parameters are auto-resolved from a `DIContainer`
- `asMap(obj)` — converts a plain object/table to a `ReadonlyMap`
- `asObject(map)` — converts a `ReadonlyMap` back to a plain object

**RunService event connections** — always use the modern signal names; the old ones are deprecated:

| Deprecated | Use instead | Fires |
|---|---|---|
| `Heartbeat` | `PostSimulation` | After physics, every frame |
| `RenderStepped` | `PreRender` | Before rendering, client only |
| `Stepped` | `PreSimulation` | Before physics, every frame |

Use `PostSimulation` for physics-driven logic and `PreRender` for visual/rendering updates (client-only). `PreRender` is preferred for anything that changes part appearance (Color, Transparency, CFrame overrides).

**Write only TypeScript** — never write `.lua`/`.luau` directly. Let the compiler handle the translation. The Roblox Studio debugger will show compiled Luau, not TypeScript source.

**Guards over nesting.** Prefer early returns to flatten control flow rather than nested `if` blocks. This is the dominant style throughout the codebase. A guard whose body is nothing but a `return` (or `continue`/`break`) goes on one line without braces — `if (this.suppress) return;` — except in nested cases where the one-liner would hurt readability.

**No single-use methods.** Inline anything with exactly one call site; a handler that exists only to be subscribed goes inline as a lambda at the subscription. Two reasons to keep one named: inlining would hurt readability, which in practice means a body past roughly ten lines; or the method is plausibly useful to a caller outside the class. `private` settles the second — a private method has already declared it has no external use, so inline it. Check the nearest comparable file before deciding.

**Ternary operators** are used often for concise conditionals but should not replace every `if` statement — use judgment based on readability.

**`ObservableValue<T>`** is used extensively throughout the codebase. It stores a value and fires a `changed` signal when it changes. Key API: `.get()`, `.set(value)`, `.changed` (signal). Prefer `ObservableValue` over manual signal+field pairs whenever a value needs to be observed.

**Follow existing block files as the reference.** When adding or modifying a block, copy the structure of an existing block file closely — definition shape, constructor wiring, `elseFunc` guard style, `as const satisfies` pattern. If uncertain about a convention, find the nearest existing example and match it exactly.

**Every player-facing key goes through `Keybinds`.** Register a `Keybinds.registerDefinition(action, displayPath, keys, priority?, touchButton?)` and subscribe with `keybinds.fromDefinition(def)`, never `ContextActionService.BindAction` or `InputHandler.onKeyDown("X")` directly. The registries carry a `displayPath` per action precisely so a rebinding UI can enumerate and remap them; a key bound outside the system is invisible to that and can never be rebound. A combination's **last** key is the trigger and the ones before it are modifiers held first, so `[["LeftControl", "L"]]` means holding Ctrl and pressing L.

**On-screen touch buttons are part of the same registration.** Pass a `TouchButtonInfo { description, image, position }` as the fifth argument; `KeybindRegistration` creates the ContextActionService button itself and binds `Enum.UserInputType.None` alongside the keys, so the button still works when the action has no key bound. `TouchButtonController` then lets the player drag it, persisting the position in `interface.touchButtonPositions`. A button made with a raw `BindAction` sits outside all of that — not arrangeable, not resettable, and destroyed the moment the action rebinds. The system originally had no mobile support at all, so treat any older guidance to reach for `createTouchButton` directly as superseded.

Raw `ContextActionService` is still correct for input that isn't a rebindable action: capturing an arbitrary key (`KeyChooserControl`), a key the player configures per block (`KeyboardBlock`), and blanket sinks that swallow whole input types while something is open (`ConfigControlColor`'s `"everything"`, `TutorialController.disableInput`).

**Settings rows label the row, not the widget.** `addButton("Reset UI Position", func)` names the *row*; the text on the button itself comes from `.button.setButtonText("Reset")`, which must end the builder chain (or be split out into a `const` when another call would otherwise follow it). Passing the button's caption as the first argument silently labels the row instead.

**A settings row must be added synchronously.** `$onInjectAuto` does not run until the component is parented, which puts it after every synchronous `addX` call — so a row created inside its callback lands below every later category rather than where it was written. Add the row in place and let the callback fill in what it needs afterwards: capture the service into a `let`, and configure the row (`initToObservable`, `setValues`) from inside the callback if it depends on an injected value. Only the `addX` call has to be synchronous; the ordering is all it controls.

**GUI config controls** — `ConfigControlBase<T, V>` is the base class for block configuration UI controls. It wraps a `SubmittableValue` (edit state + submit event) backed by an `ObservableValue`, and supports multi-block editing via `Values<V> = { [k: string]: V }`. Subclass it when building a reusable config input. Leave broader GUI work to the user unless the pattern is clearly established.

**External reference:** https://create.roblox.com/docs — Roblox Creator documentation for engine APIs, services, and instance types.

**Verify engine/API behavior against the docs — do not assert it from inference.** When a claim about how a Roblox API behaves is load-bearing (a signal's firing conditions, a method's edge cases, a property's side effects), fetch the relevant Creator Docs page and confirm it before stating it as fact, even when a logical deduction seems obviously correct. A plausible inference is not a citation; present what the docs actually say.

**When the docs are silent, search — do not reason the gap shut.** Many Creator Docs pages carry a type signature and no description (`InputObject.Position`, `GuiButton.MouseButton1Click`, `GuiObject.Active` among them), and the roblox-ts typings are interfaces without documentation, so neither is a reliable answer on its own. Use WebSearch next. Failing that, `driver.sh eval` settles anything pure, and a Studio log settles anything that needs the engine — say which of these the answer rests on, and never present a deduction as though it were documented.

## Utility APIs

### Where the macros live

Every `.propmacro.ts` augments a built-in or engine type with extra methods. They activate on import, and each
opens with a macro hoist that must stay put (see Code Conventions). Full index, so nothing here gets
reimplemented by hand:

| File | Augments |
|---|---|
| `fixes/Arrays.propmacro` | Array / Set / Map — the LINQ-like API below |
| `fixes/Roblock.propmacro` | `Vector3` |
| `fixes/Color3.propmacro` | `Color3`, plus the `Color3s` namespace |
| `fixes/String.propmacro` | `string`, plus the `Strings` namespace |
| `t.propmacro` | `t` checkers |
| `component/ComponentEvents.propmacro` | `this.event` on a `Component` |
| `component/Component.propmacro` | `Component` itself |
| `component/Transform.propmacro` | `TransformBuilder` |
| `component/SecondaryTransform.propmacro` | secondary transform targets |
| `component/InstanceValuesComponent.propmacro` | `InstanceValuesComponent` |
| `event/ObservableValue.propmacro` | `ObservableValue` / `ReadonlyObservableValue` |
| `event/FakeObservableValue.propmacro` | derived observables |
| `client/component/Component.propmacro` | GUI components (client) |
| `client/gui/ComponentEvents.propmacro` | input events (client) |
| `client/gui/TooltipComponent.propmacro` | tooltips (client) |
| `client/Action.propmacro` | `initKeybind` on an action |
| `client/Theme.propmacro` | `themeButton` |

### Collection macros (Array / Set / Map)

All three collection types have a shared LINQ-like API injected by `engine/shared/fixes/Arrays.propmacro.ts`. Key methods:

- `count(func?)`, `all(func)`, `any(func?)`, `contains(value)`
- `first()` — first element, or `undefined`
- `find(func)` — first match; Map has `findKey` / `findValue` variants
- `filter(func)` — returns same collection type; also `filterToSet`, `filterToMap`
- `map(func)` — also `mapToSet`, `mapToMap` (`mapToMap` requires returning `$tuple(k, v)`)
- `flatmap(func)` — also `flatmapToSet`, `flatmapToMap`
- `groupBy(keyfunc)` — returns `Map<key, T[]>`
- `except(items)` / `exceptSet` / `exceptKeys` / `exceptValues` — exclusion
- `distinct()` — deduplicate (Array only)
- `chunk(size)` — split into N-sized sub-arrays
- `toSet()`, `toArray()`, `toMap(keyfunc)` — convert between collection types
- `sequenceEquals(other)`, `clone()`, `asReadonly()`
- `getOrSet(key, create)` — Map only; inserts and returns if key is missing
- `withAdded(items)` / `withAddedSet` — Set only; returns a new set with items added
- `min()` / `max()` — Array of numbers only

### Vector3 macros

Injected by `engine/shared/fixes/Roblock.propmacro.ts`:

- `v.with(x?, y?, z?)` — new Vector3 with selective axis override, e.g. `v.with(undefined, 0)` zeros only Y
- `v.apply(func)` — maps a function over each axis: `v.apply((n) => math.abs(n))`
- `v.findMin()` / `v.findMax()` — min/max scalar across all three axes

**Prefer the macro over `VectorUtils`.** `shared/utils/VectorUtils` carries a static `apply(v, func)` and
friends (`round`, `normalize`, `roundVector3To`, `areCFrameEqual`); those exist for static contexts where there
is no receiver to call a method on. When you have a `Vector3` in hand, `v.apply(f)` is the idiom.

### Color3 macros

Injected by `engine/shared/fixes/Color3.propmacro.ts` — the same shape as the Vector3 macros:

- `c.apply(func)` — maps over each channel; the callback receives `(value, "R" | "G" | "B")`
- `c.with(r?, g?, b?)` — new Color3 with selective channel override
- `c.mul(n)` — scalar multiply

### String macros & Strings namespace

Injected by `engine/shared/fixes/String.propmacro.ts`:

- `str.contains(s)`, `str.startsWith(s)`, `str.trim()`, `str.fullLower()`, `str.fullUpper()`
- `Strings.pretty(value)` — recursive pretty-printer for any value
- `Strings.prettyNumber(value, step)` — formats with step-based decimal places
- `Strings.prettySecondsAgo(s)` / `Strings.prettyTime(s)` — human-readable time
- `Strings.prettyKMT(n)` / `Strings.prettyKMB(n)` — abbreviate large numbers (k/M/G/T or k/M/B/T)

### ComponentEvents helpers

`this.event` (a `ComponentEvents`) provides subscription helpers that auto-disconnect on disable/destroy:

- `this.event.subscribe(signal, callback)` — registers through `onEnable`, so it disconnects on disable and **reconnects on every enable**; one made while disabled still arrives on the next enable rather than being lost
- `this.event.subscribeObservable(observable, callback, executeOnEnable?, executeImmediately?)` — subscribe to an `ObservableValue`
- `this.event.subscribeObservablePrev(observable, callback, ...)` — same but receives previous value
- `this.event.subscribeCollection` / `subscribeCollectionAdded` / `subscribeMap` — collection/map subscriptions
- `this.event.subscribeRegistration(func)` — register a custom `SignalConnection`
- `this.event.loop(interval, func)` — **preferred over manual `task.spawn` loops**; only runs `func` while enabled, checks `isDestroyed()` internally, returns a `SignalConnection` to stop it
- `this.event.observableFromInstanceParam(instance, param)` — two-way `ObservableValue` bound to an instance property
- `this.event.addObservable(fakeObservable)` — registers a `FakeObservableValue` for auto-destroy

### ObservableValue macros

- `obs.subscribe(func, executeImmediately?)` — shorthand for `obs.changed.Connect`
- `obs.subscribePrev(func, executeImmediately?)` — callback receives `(value, prev)`
- `obs.subscribeWithCustomEquality(func, equalityCheck, executeImmediately?)` — skip callback when equal
- `obs.waitOnceFor(predicate, action)` — fires action once when predicate is true, then disconnects
- `obs.connect(other)` — two-way sync between two observables
- `obs.createBothWayBased(toOld, toNew)` — derived two-way observable with transform functions
- `obs.toggle()` — boolean only; flips and returns the new value

### Runtime type checking (`t`)

`import { t } from "engine/shared/t"` — a repo-local validator, **not** the `@rbxts/t` package. Used wherever untrusted data crosses a boundary: remote payloads, save data, command arguments.

A `t.Type<T>` is a checker plus a type guard. Two entry points:

- `t.typeCheck(value, type, result?)` — narrows `value is T`; pass a `t.newResult()` to get the failure reason out via `result.toString()`
- `t.typeCheckWithThrow(value, type)` — asserts, throwing the formatted failure

Primitives are properties, not calls: `t.number`, `t.string`, `t.boolean`, `t.object`, `t.any`, `t.undefined`, `t.vector2`, `t.vector3`, `t.cframe`, `t.color`, `t.material`, `t.anyInstance`, `t.true`, `t.false`. Composites are calls: `t.interface({...})` (extra keys allowed), `t.strictInterface({...})` (extra keys rejected), `t.partial({...})`, `t.array(item)`, `t.union(...)`, `t.intersection(...)`, `t.const(literal)`, `t.enum(Enum.X)`, `t.instance("Part")`, `t.instanceTree<T>()`, `t.mappedInterfaceKV(key, value)`, `t.custom(predicate, additional?)`.

Macros (from `t.propmacro.ts`, must be imported to activate):

- `t.numberWithBounds(min?, max?, step?)` — range and step check; the bounds ride along as `additional` so a caller can read them back
- `type.orUndefined()` — sugar for `t.union(type, t.undefined)`
- `type.nominal("Name")` / `type.as<U>()` — compile-time only, no runtime effect

`t.Infer<typeof someType>` derives the TypeScript type from a checker, so the validator stays the single source of truth rather than duplicating an interface next to it.

### Component macros

From `engine/shared/component/Component.propmacro.ts`:

- `setEnabled(bool)` / `switchEnabled()` — instead of branching on `enable()`/`disable()` by hand
- `onEnabledStateChange(func, executeImmediately?)` — one subscription for both directions
- `with(func)` / `withParented(child)` — configure and return `this`, for chaining at a parent call
- `asTemplate(object, destroyOriginal?)` — turns an instance into a `() => T` clone factory
- `parentDestroyOnly(child)` — sugar for `parent(child, { enable: false, disable: false })`
- `getAttribute<T>(name)`

### Derived observables

`engine/shared/event/FakeObservableValue.propmacro.ts` builds observables *from* other observables, so a
derived value never needs its own subscription bookkeeping:

- `obs.fCreateBased(funcTo, funcFrom)` / `obs.fReadonlyCreateBased(funcTo)` — map to a new observable
- `obs.fWithDefault(value)` / `obs.fReadonlyWithDefault(value)` — substitute a default for `undefined`
- `obs.asArray()` — `ObservableValue<ReadonlySet<T>>` viewed as an array

### Transforms

`engine/shared/component/Transform*.ts` plus `Transform.propmacro` / `SecondaryTransform.propmacro` are the
animation/tweening system (`Transforms`, `TransformBuilder`, `Easing`). It is a large builder API — read the
source before using it rather than guessing the shape.

### `Objects` namespace

`engine/shared/fixes/Objects.ts` — the object-side counterpart to the collection macros, used constantly:

- `Objects.keys(o)` / `values(o)` / `size(o)` / `entriesArray(o)`
- `Objects.firstKey(o)` / `firstValue(o)`
- `Objects.empty` — one shared empty array, used as a default instead of allocating `[]` per call. `readonly` at the type level only, not `table.freeze`d, so never pass it somewhere that might mutate it
- `Objects.map(o, func)` / `mapValues(o, func)` — transform an object
- `Objects.fromEntries(entries)` / `assign(target, ...sources)`
- `Objects.deepCombine(base, partial)` — recursive merge, typed `PartialThrough<T>` so only the leaves you
  override appear. Preferred over a nested spread chain when overriding one deep field of a config or
  definition object (see `sidewaysServoDefinition` in `ServoMotorBlocks`)
- `Objects.deepEquals(a, b)` / `objectDeepEqualsExisting(object, properties)` — the latter compares only keys
  present in `properties`
- `Objects.writable(o)` — drops `readonly` for a local mutation
- `Objects.awaitThrow(...)` / `multiAwait(...)`
- `Objects.PathsOf<T>` / `createObjectWithValueByPath(value, path)` — dotted-path types and construction

### Global type helpers

`engine/shared/fixes/Types.d.ts` is ambient — **no import needed**, and these are easy to reimplement by
accident:

`Replace<T, K, V>`, `ReplaceWith<T, Props>`, `MakePartial<T, K>`, `MakeRequired<T, K>`, `OmitOverUnion<T, K>`,
`ConstructorOf<T, Args>`, `AbstractConstructorOf<T, Args>`, `InstanceOf<T>`, `ArgsOf<T>`,
`ConstructorToFunction<T>`, `PartialThrough<T>`.

### Remaining `engine/shared/fixes`

- **`BB`** — oriented bounding box. `BB.from(instance)` / `fromPart` / `fromModel` / `fromModels` / `fromBBs` /
  `fromRegion3`, then `withCenter`, `withSize`, `toAxisAligned`, `getRotatedSize`, `isPointInside`, `isBBInside`.
  Use it rather than hand-rolling `GetBoundingBox` maths.
- **`Instances`** — `findChild`, `waitForChild`, `waitClientOrCreateServer`, `pathOf`, `relativePathOf`.
- **`JSON`** (`fixes/Json.ts`) — `serialize` / `deserialize` that round-trip Roblox datatypes (CFrame, Vector3,
  Vector2, UDim, UDim2, Color3, EnumItem). The built-in `HttpService:JSONEncode` cannot.
- **`Keys`** — `isKey`, `isKeyGamepad`, `isKeyGamepadDPad`, `toReadable` for a display string.
- **`MathUtils`** — `round(value, step)`, `clamp`, `e`.
- **`Arrays.intersect` / `Sets.intersect`** (`fixes/Arrays.ts`) — plain functions, separate from the macros.

### The two `Colors` namespaces

Both export a namespace named `Colors`, so only the import path distinguishes them. This is a leftover from
the engine being merged into the game codebase, not a designed split — both carry the same nine base colours
with identical values, and `toInt` / `lightenPressed` are duplicated verbatim.

**Use `shared/Colors`.** It is the game's own copy and the only one with the palette (`accent`, `accentDark`,
`accentLight`, `accentBlack`, `staticBackground`, `newGui`). `engine/shared/Colors` is the older file; the one
thing unique to it is `grayscale(b)`.

The exception is code under `engine/`, which is the framework layer and does not import from `shared/` — it
has to keep using its own copy. Game-side files still importing the engine one are migration candidates, not
examples to follow.

### Client propmacros

Code-side helpers for GUI components — distinct from building the player-facing instances themselves, which
belong in Studio:

- `engine/client/component/Component.propmacro` — `parentGui`, `buttonComponent`, `addButtonAction`,
  `addButtonActionSelf`, `setButtonText`, `setButtonInteractable`, `visibilityComponent`, `show`/`hide`
- `engine/client/gui/ComponentEvents.propmacro` — `onPrepare` / `onPrepareDesktop` / `onPrepareTouch` /
  `onPrepareGamepad`, `onInputBegin`/`onInputEnd`, `onKeyDown`/`onKeyUp`, `subInput`
- `engine/client/gui/TooltipComponent.propmacro` — `tooltipComponent`, `setTooltipText`
- `client/Action.propmacro` — `initKeybind(registration, config?)`
- `client/Theme.propmacro` — `themeButton`

### Deprecated macros

- `Vector3.min(v)` / `Vector3.max(v)` — use the Roblox built-ins
- `ObservableValue.createBased` — use `fCreateBased`
- Anything tagged `@deprecated Internal use only` / `@hidden` in `t.propmacro` and
  `FakeObservableValue.propmacro` is plumbing, not API

## Rojo / Project Structure

`default.project.json` maps `out/` subdirectories to Roblox services. All `$path` entries point to `out/`, not `src/`. File type mappings:

| File | Roblox instance |
|---|---|
| `*.lua` / `*.luau` | `ModuleScript` |
| `*.server.lua` | `Script` |
| `*.client.lua` | `LocalScript` |
| `init.lua` in a folder | folder becomes `ModuleScript` |

`lune run assemble` must be run once to generate `place.rbxl` before opening Studio. During development, `npm run dev` keeps the TypeScript compiler and Rojo server running together.

## Dependency Injection

The DI system lives in `src/engine/shared/di/` and is transformer-powered — resolution keys are TypeScript type paths injected at compile time, not strings written by hand.

Any class that receives `@inject` parameters in its constructor must be decorated with `@injectable` directly above the class definition — without it, the DI transformer will not wire up the parameters correctly.

**Resolving:**
```ts
const svc = di.resolve<MyService>(); // no string argument needed — transformer fills it
const svc = di.tryResolve<MyService>(); // returns undefined if not registered
```

**Registering** (via `DIContainerBuilder`):
```ts
builder.registerSingletonClass(MyClass)        // instantiated once, reused
builder.registerTransientClass(MyClass)        // new instance per resolve
builder.registerSingletonValue(existingObj)    // pre-built instance
builder.registerSingletonFunc(di => new X(di)) // factory, result cached
```

Registrations chain: `.as<OtherType>()` / `.asSelf()` expose one registration under additional type paths, `.withArgs(...)` supplies constructor args (the singleton variant also accepts `(di) => args`), `.onInit(fn)` runs after construction, and `.autoInit()` constructs a singleton eagerly at container build instead of on first resolve. Singletons are otherwise lazy and cached, and circular resolution is detected and thrown.

**Services** (`HostedService extends Component`) are long-lived singletons that cannot be disabled. Register them via `GameHostBuilder.services.registerService<T>(MyService)`. They are parented to the `GameHost` automatically.

**Scoped containers:**
```ts
const child = di.beginScope((builder) => {
    builder.registerSingletonValue(x);
});
```
Child containers inherit all parent registrations and override only what they add.

**Resolution is by exact type path, not structure.** `tryResolve` is a string-key lookup that walks parent scopes; a value registered under one type is invisible under any other type, however identical the shape — registering `PlayerDataStorage` does not make a `PlayerConfig` injection resolvable. Expose extra paths explicitly with `.as<T>()`.

**`@tryInject`** marks a constructor parameter as optional injection — it resolves to `undefined` instead of throwing when nothing is registered under the type. This is the standard way shared block logic reaches client-only services (`PlayerDataStorage`, `LogControl`): on the server the parameter is simply `undefined` (see WingsBlocks, GravitySensorBlock, LuaCircuitBlock).

**`resolveForeignClass(Clazz, [args])`** instantiates a class that isn't registered in any container, resolving its decorated parameters from this one — this is how `SharedMachine` constructs block logic (`di.resolveForeignClass(logicctor, [block])`). Positional `args` fill the non-decorated parameters; `@inject`/`@tryInject` parameters come from the container.

**Decorators only fire on the class DI instantiates.** A base class reached through `super(...)` never sees the
container — that call is plain Lua with the arguments the subclass wrote, and `di` exists only inside the
generated `_depsCreate`. So decorate the leaf and forward the value up (`ServerBlockLogic` and its 13 subclasses
are the pattern), or, for a dependency the base alone uses, take it in the base with `$onInjectAuto`.
`@injectable` on the base is worse than useless: `isDeps` is an `_depsCreate ~= nil` index that follows
`__index = super`, so a subclass without its own would inherit one built for the *base's* parameter list and
receive every argument shifted.

**Constructor parameter when the dependency is required and read unconditionally; `$onInjectAuto` / `@tryInject`
when it is optional or side-specific.** `$onInjectAuto` resolves after the constructor returns and before
parenting, so the field is genuinely `undefined` for that window — fine for a value already read with `?.`,
wrong for one called bare from three places, where the failure is a nil call inside one block rather than a
compile error.

**An optional `$onInjectAuto` parameter (`x?: T` or `T | undefined`) resolves through `tryResolve`** and arrives
`undefined` when nothing is registered, instead of throwing. This is how shared code reaches a client-only
service without a constructor parameter. A non-optional one uses `resolve` and throws.

**`@pathOf("T")` decorator** on a parameter is a transformer macro — it replaces the parameter's runtime value with the string path of TypeScript type `T`. This is how `resolve<T>()` works without an explicit string argument.

**`$autoResolve`** wraps a function so all its parameters are resolved from a `DIContainer` automatically.

## Code Conventions

- **Search before writing a helper.** This repo has a deep utility layer and most "small helpers" already
  exist, often under a name you would not guess. Before adding one, check in this order: the **Utility APIs**
  section above, the propmacro index (a method on the type is often the answer where a free function seems
  needed), `engine/shared/fixes/Objects.ts`, and the ambient globals in `engine/shared/fixes/Types.d.ts`.
  Then grep for a verb — `grep -rn "deepCombine\|intersect\|applyToAllDescendants" src`.

  Real misses from one session: a nested spread chain rebuilt what `Objects.deepCombine` does; a new shared
  module was started for a cross-block signal that belonged as one `ArgsSignal` on the consumer; a static
  `VectorUtils.apply(v, f)` was used where the `v.apply(f)` macro reads better. A duplicated helper is worse
  than a missing one — it drifts, and `Colors` is the standing example of what that costs.

  The same applies to *reaching into* another component's state: prefer a protected method following an
  existing pattern (`tryProvideDIToChild`, `markChildDestroying`) over a direct field write, which
  `protected` will refuse across the hierarchy anyway.

  **Never restate production logic inside a test, check or tool.** A check that reimplements the rules it
  checks stops testing the real thing the moment either side moves, and it fails silently — it still passes.
  `tests/assetcheck.luau` is the pattern to copy: rather than porting the block rules into Luau it loads the
  actual compiled `BlockAssertions` through lunit's Lune shim, so there is one source of truth and no way for
  the two to disagree. If the real module cannot be loaded from where you are, that is the problem to solve —
  not a reason to write a second copy of it.
- **Imports**: absolute only (no relative paths). `baseUrl` is `src`. Runtime values: `import { X }`. Types only: `import type { X }`. Import order: builtin → external → internal, alphabetical within groups (enforced by ESLint).
- **Formatting**: tabs, 120-char lines, double quotes, trailing commas, LF line endings (Prettier-enforced).
- **Minimize comments — default to none.** The code is expected to explain itself; a comment is what you write when it cannot. That bar is met by magic values (where a constant came from), maths, and engine quirks that would otherwise read as a mistake (`//nan check` on a self-comparison) — plus the occasional key or name that no longer conveys its purpose (`//a.k.a. rewrite value`). Everything else, leave out. Keep what survives to one line and to the bare minimum for surface-level understanding: a reader who needs more detail reads the code. Never narrate what the code does (`//set value`), and trim a comment that has grown longer than the logic it guards. There is no target density to hit — fewer is always better.

    **Before keeping a comment, delete it and re-read the line.** If the code still tells you the same thing, it was narration — leave it deleted. The default pull is to explain; resist it. Two forms show up most:
    - *Restating an identifier that already names itself* — `// defaults come from the config definition` above `const df = PlayerConfigDefinition.terrain.config`.
    - *Explaining a bug the code no longer has* — the fix is the explanation; a reader of the current code does not need the history.

    Write only what the code cannot say: where a magic constant came from, an ordering that looks arbitrary but is not, an engine quirk that would otherwise read as a mistake. Existing commented-out code is there for a reason — leave it; never comment out code yourself unless explicitly asked. JSDoc is common on `engine/` APIs but not a blanket requirement — add it where a method is frequently used or its name is abbreviated enough to need explaining; game code (`shared/`, `client/`, `server/`) rarely uses it.
- **Avoid metaphors.** In comments and explanations, describe the mechanism literally rather than through analogy — say what the code does in technical terms, not "keep the pool warm", "swallow the event", "starve the queue". A plain description is clearer to the next reader and does not assume they share the figure of speech.
- **Declare instances in Studio, not in code.** Visual/audio instances — parts, lights, particles, sounds, GUI templates — belong in Studio as prefabs/assets synced through Rojo and fetched via `ReplicatedAssets` / a cloned template, not built with `new Instance(...)` in logic. Inlining them scatters tunable values across code, takes them out of designer control, and bypasses the asset pipeline. If you genuinely must inline-create something that should be a Studio asset (a quick placeholder), mark it `// fixme: <should be a Studio asset>` so it's findable. `// fixme:` in general flags known-suboptimal code to revisit — grep-able, distinct from a permanent rationale comment.
- **No `public`** keyword on class members (`@typescript-eslint/explicit-member-accessibility`).
- **No `any`** except rest args.
- **`as const satisfies T`** is the standard pattern for block definitions, config objects, and type maps.
- **`.propmacro.ts` files** declare global augmentations for the custom transformer. They must be imported to activate their macros. Each opens with a hoist — `const _ = () => [SomeMacros, OtherMacros];` above everything else — which forces the macro tables to be emitted before anything references them. It is not dead code and not stylistic: removing it, reordering it, or moving declarations above it breaks how the transformer emits the module. Leave it exactly where it is.
- **Short-circuit condition ordering** — in `||`/`&&` expressions, put the cheapest operand first. A plain boolean variable should come before an object comparison so it short-circuits before the heavier check when possible.
- **Never define before a guard if the guard can make it unused.** Defining a variable (especially one that allocates) before a guard that may skip its only use is always wrong — move the definition past the guard.
- **`static readonly` scope in blocks** — values referenced inside `definition` must be module-level constants (definition is declared before the class). `static readonly` is for class-associated data only used within the class itself (e.g. derived constants, lookup tables). **Exception: `events`.** Blocks that have server middleware use a module-level `const events = { ... }` (e.g. Screen, Button, Speaker) — this is the established pattern. `static readonly events` appears in Particle/Tracer but those share one lineage; `const events` is the convention for middleware blocks.
- **`Vector3.zero` over `new Vector3(0, 0, 0)`** — prefer the static property for variable initialization. In block config defaults (`config: new Vector3(...)`) use `new Vector3` directly — the value is meant to be changed and the explicit constructor makes that intent clear.
- **Non-null assertion `!`** — acceptable when a guard earlier in the same scope makes the value's presence obvious to the reader but TypeScript cannot track it (e.g. inside a closure that captures an `| undefined` variable). Do not introduce an extra `const` alias just to satisfy the type checker in these cases.
- **`initializeInputCache` — `get()` vs `tryGet()`.** The two are *identical at runtime* — both return the value or `nil`; they differ only in the declared TypeScript type, so `get()` merely claims the result is non-optional. It does not assert. Use `get()` only where `nil` is harmless (`if (!cache.get()) return`), and `tryGet() ?? fallback` everywhere the value is consumed — for arithmetic an unset cache yields `nil` and crashes the math one line later, and in a payload it silently becomes a missing field. A `get() ?? fallback` is not wrong at runtime, but the type checker believes the fallback is dead code and a later cleanup will delete it.
- **Config tables with a `Default` entry — fall back to the `Default`, not a literal.** When reading an optional property from a table that defines a `Default` (e.g. `Materials.Properties` in `engine/shared/data/Materials`), use that entry's value as the `??` fallback (`Materials.Properties[name]?.field ?? Materials.Properties.Default.field!`), so the fallback stays in sync with the source of truth instead of drifting from a hand-written constant.

- **Reading inputs every tick** — a side-effect block that acts every tick (weapon hold-to-fire, motor) takes one `initializeInputCache(key)` per needed input, then reads them inside `onTicc(ctx => …)` via `cache.get()` (guarded/boolean) or `cache.tryGet() ?? fallback` (arithmetic). Prefer this over reading `this.input[key].get(ctx)` directly (which returns a `garbage`/`availableLater` sentinel you must guard) and over caching one combined object via `on`. For PID-style logic that needs all inputs **plus `dt`** in lockstep, the combined `on`-cache is still fine: type it `AllInputKeysToObject<(typeof definition)["input"]> | undefined` (from `blockLogic/BlockLogic`), declare it `undefined` (no zero-filled dummy), let `on` populate it, and guard `if (inputValues === undefined) return` at the top of `onTicc`.

## Performance

There can be hundreds of active block instances simultaneously. Performance is a hard requirement, not a preference.

- **Avoid unnecessary per-tick allocations.** They cost GC churn — a performance tradeoff to weigh, not a correctness failure. Prefer to pre-allocate arrays, params objects, and closures outside tick callbacks and reuse them; use `table.clear(arr)` to reset a pre-allocated array rather than reassigning to `[]`. The thing actually worth avoiding is *wasteful* allocation — memory allocated unconditionally every tick regardless of work done. Allocation **proportional to real work that dominates it** is an acceptable trade, not something to contort around: a frontier/priority queue whose entries are dwarfed by the instance generation they schedule, or one native `table.clone` snapshot beating a hand-written element-copy loop into a reused buffer, are both fine. Memory/GC churn is generally the cheaper currency than CPU; still, prefer a design that allocates only on change rather than unconditionally every tick.
- **Parallel arrays over nested tables.** When buffering pairs of values per iteration (e.g. segment origins and ends), use two flat pre-allocated arrays instead of an array of 2-element tuples. Each tuple is a separate Lua table allocation; flat arrays eliminate this entirely.
- **Limit loops to active range.** When only a slice of an array is active (e.g. beams 0 to `nextBeam`), loop that range rather than the full array.
- **A closure allocates per evaluation only if it captures something.** Luau emits `DUPCLOSURE` for a function with no upvalues and caches it on the prototype, so `(v) => math.clamp(v, -100, 100) / 100` written inside a tick callback is the *same* object every tick and costs nothing — verified by identity comparison. One that captures a local, a parameter, or `this` gets `NEWCLOSURE` and is freshly allocated on every evaluation. Hoist the capturing case out of the callback; leave the non-capturing case wherever it reads best.
- **`time()` over `DateTime.now()`** — `DateTime.now()` allocates a `DateTime` object on every call. `time()` (Roblox global) returns elapsed seconds as a plain number with no allocation. Always use `time()` for elapsed-time arithmetic in tick callbacks.
- **Scale per-tick rates by `dt`.** Logic in a `PostSimulation`/`Heartbeat` loop that decays or accumulates per tick (heat, cooldowns, probabilities) is frame-rate-coupled if it ignores `dt` — it speeds up/slows down with the server frame rate. Multiply rates by `dt`; if the constants were tuned per-tick at 60 Hz, normalise with `dt * 60` to keep the same feel. Pair this with sending state to clients only on a meaningful change (a step threshold), not every frame — the client interpolates between, so per-frame sends are wasted bandwidth.
- **Drop map entries once they're inert.** Per-tick loops over a `Map` (e.g. blocks still cooling) should `delete` an entry when it reaches its resting state, not leave it at `0` — otherwise every settled entry is re-scanned every frame forever. Collect keys to remove during the loop and delete them after (removing the current key mid-`pairs` is safe in Luau, but the collect-then-delete pattern is clearer).
- **Instance property access crosses the Luau↔engine boundary** (~100ns+ per write, even when the value is unchanged); a pure-Luau number compare is nanoseconds. Don't write Instance properties (`Parent`, `Transparency`, `CFrame`) every tick when they rarely change — track the state in Luau and write only the delta. E.g. when visible parts always form a prefix `[0, n)`, store last tick's `n` and unparent only `[n, prevN)`. Initialize such trackers to the prefab's real starting state: a model's own template part starts parented, so the initial "shown" count may be 1, not 0.
- **Gate visual updates on change; render on `PreRender`.** For a block that derives visuals from per-tick state (see `LaserBlock`): keep the computation and logic outputs on the tick, move all appearance writes into a client-guarded `PreRender` subscription gated by a `needsRedraw` flag. Detect change by comparing the world-space results themselves (Vector3 `===` is exact value equality), cheapest checks first. When the render gate reads a snapshot (`lastX ||`), the tick's diff must compare `x !== lastX` rather than testing `x` directly — the toggle itself must count as a change, or the snapshot never refreshes and the gate sticks on.
