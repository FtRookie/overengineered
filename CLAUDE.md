# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install               # install dependencies
lune run assemble         # generate place.rbxl (required before opening Studio)
npm run dev               # run all watchers: rbxtsc + rojo + asset watcher
npm run build             # compile TypeScript once (rbxtsc)
npm run watch             # TypeScript compiler watch only
npm run rojo              # Rojo sync server only
node ./scripts/lunewatch.js  # place file asset watcher only
lune list                 # list available lune toolchain scripts
```

There is no standalone test runner. Tests (files named `*.test.ts`) execute inside Roblox Studio via `TestFramework`. Block-specific tests use `BlockTesting` and `BlockTestRunner` from `src/shared/blocks/testing/`.

To verify the build pipeline compiles and assembles cleanly, use the `/run-overengineered` skill (runs rbxtsc → lune assemble → eslint).

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

Blocks that access named model children (e.g. `VehicleSeat`, `GreenLED`) must use `InstanceBlockLogic<typeof definition, TModel>` where `TModel extends BlockModel` declares those children as typed readonly fields. Do **not** use `BlockLogic` with `block.instance?.FindFirstChild(...)` — the optional chain hides a guaranteed crash when `instance` is undefined, and the cast to a concrete type discards the type safety.

```ts
type MyModel = BlockModel & {
    readonly SomePart: BasePart;
};
class Logic extends InstanceBlockLogic<typeof definition, MyModel> { ... }
// access: this.instance.SomePart (typed, non-optional)
```

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

`HostedService` extends `Component` but cannot be disabled — it lives for the entire session.

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

Player settings (camera, graphics, terrain, etc.) are versioned the same way. Each version is a `const vN` implementing `UpdatablePlayerConfigVersion<TCurrent, TPrev>` with an `update(prev)` method.

To add a new config version:
1. Define `type PlayerConfigVN = PlayerConfigVPrev & { readonly newField: T }` (or use `Replace<>` to change an existing field's type).
2. Create `const vN: UpdatablePlayerConfigVersion<PlayerConfigVN, PlayerConfigVPrev>` with `version: N` and `update`.
3. Append `vN` to `versions`.

`update` receives `Partial<TPrev>` (fields may be absent in old saves) and must return `Partial<TCurrent>`. Always spread `prev` first and set `version: this.version`. Use `PlayerConfigDefinition.<field>.config` for new field defaults to stay in sync with the definition source of truth.

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

**`next` is a reserved Lua built-in** — never use it as a variable name. roblox-ts will compile it without error but it shadows the Lua `next()` function and causes undefined behaviour. Use a different name (e.g. `nextI`, `nextVal`).

**Never use `for...in`.** It has zero usages in the codebase. In roblox-ts it compiles to Luau behavior that iterates string keys of objects (JavaScript semantics), which is meaningless for typed arrays or maps. Use `for...of` for arrays and `pairs()` for key-value iteration.

**Compiler macros:**
- `$tuple(a, b)` — creates a `LuaTuple` for multiple returns (compiles to `return a, b` in Lua)
- `$trace(...)` / `$debug(...)` / `$log(...)` / `$warn(...)` / `$err(...)` — logging macros that route through `Logger` (→ Lua `print`/`warn`). Output goes to the console/output window. All levels are disabled by default; admins can toggle them in-game via the Developer Switches tab in `AdminGui`. `$warn` and `$err` use Lua's `warn()` when active.
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

**No single-use methods.** Never define a method with exactly one call site; a handler that exists only to be subscribed goes inline as a lambda at the subscription. Exception: a method that encapsulates a distinct self-contained purpose (a parsing step, an editing operation) may stay named even while it currently has a single caller.

**Ternary operators** are used often for concise conditionals but should not replace every `if` statement — use judgment based on readability.

**`ObservableValue<T>`** is used extensively throughout the codebase. It stores a value and fires a `changed` signal when it changes. Key API: `.get()`, `.set(value)`, `.changed` (signal). Prefer `ObservableValue` over manual signal+field pairs whenever a value needs to be observed.

**Follow existing block files as the reference.** When adding or modifying a block, copy the structure of an existing block file closely — definition shape, constructor wiring, `elseFunc` guard style, `as const satisfies` pattern. If uncertain about a convention, find the nearest existing example and match it exactly.

**GUI config controls** — `ConfigControlBase<T, V>` is the base class for block configuration UI controls. It wraps a `SubmittableValue` (edit state + submit event) backed by an `ObservableValue`, and supports multi-block editing via `Values<V> = { [k: string]: V }`. Subclass it when building a reusable config input. Leave broader GUI work to the user unless the pattern is clearly established.

**External reference:** https://create.roblox.com/docs — Roblox Creator documentation for engine APIs, services, and instance types.

**Verify engine/API behavior against the docs — do not assert it from inference.** When a claim about how a Roblox API behaves is load-bearing (a signal's firing conditions, a method's edge cases, a property's side effects), fetch the relevant Creator Docs page and confirm it before stating it as fact, even when a logical deduction seems obviously correct. A plausible inference is not a citation; present what the docs actually say, and if they are silent, say so rather than filling the gap with reasoning.

## Utility APIs

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

### String macros & Strings namespace

Injected by `engine/shared/fixes/String.propmacro.ts`:

- `str.contains(s)`, `str.startsWith(s)`, `str.trim()`, `str.fullLower()`, `str.fullUpper()`
- `Strings.pretty(value)` — recursive pretty-printer for any value
- `Strings.prettyNumber(value, step)` — formats with step-based decimal places
- `Strings.prettySecondsAgo(s)` / `Strings.prettyTime(s)` — human-readable time
- `Strings.prettyKMT(n)` / `Strings.prettyKMB(n)` — abbreviate large numbers (k/M/G/T or k/M/B/T)

### ComponentEvents helpers

`this.event` (a `ComponentEvents`) provides subscription helpers that auto-disconnect on disable/destroy:

- `this.event.subscribe(signal, callback)` — connects and auto-disconnects on disable
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

**`@pathOf("T")` decorator** on a parameter is a transformer macro — it replaces the parameter's runtime value with the string path of TypeScript type `T`. This is how `resolve<T>()` works without an explicit string argument.

**`$autoResolve`** wraps a function so all its parameters are resolved from a `DIContainer` automatically.

## Code Conventions

- **Imports**: absolute only (no relative paths). `baseUrl` is `src`. Runtime values: `import { X }`. Types only: `import type { X }`. Import order: builtin → external → internal, alphabetical within groups (enforced by ESLint).
- **Formatting**: tabs, 120-char lines, double quotes, trailing commas, LF line endings (Prettier-enforced).
- **Minimize comments — default to none.** The codebase averages ~1 comment line per 60 lines of code; match that density. A comment is warranted only for a non-obvious *why* — a timing subtlety, why a constant has its value, an idiom a reader may not recognize (`//nan check` on a self-comparison), or a key/name that no longer conveys its purpose (`//a.k.a. rewrite value`) — and should be one line, kept to the bare minimum needed for surface-level understanding: a reader who needs more detail reads the code, which explains itself better than any over-explanatory comment. Never narrate what the code does (`//set value`), and trim a comment that has grown longer than the logic it guards. Existing commented-out code is there for a reason — leave it; never comment out code yourself unless explicitly asked. JSDoc is common on `engine/` APIs but not a blanket requirement — add it where a method is frequently used or its name is abbreviated enough to need explaining; game code (`shared/`, `client/`, `server/`) rarely uses it.
- **Avoid metaphors.** In comments and explanations, describe the mechanism literally rather than through analogy — say what the code does in technical terms, not "keep the pool warm", "swallow the event", "starve the queue". A plain description is clearer to the next reader and does not assume they share the figure of speech.
- **Declare instances in Studio, not in code.** Visual/audio instances — parts, lights, particles, sounds, GUI templates — belong in Studio as prefabs/assets synced through Rojo and fetched via `ReplicatedAssets` / a cloned template, not built with `new Instance(...)` in logic. Inlining them scatters tunable values across code, takes them out of designer control, and bypasses the asset pipeline. If you genuinely must inline-create something that should be a Studio asset (a quick placeholder), mark it `// fixme: <should be a Studio asset>` so it's findable. `// fixme:` in general flags known-suboptimal code to revisit — grep-able, distinct from a permanent rationale comment.
- **No `public`** keyword on class members (`@typescript-eslint/explicit-member-accessibility`).
- **No `any`** except rest args.
- **`as const satisfies T`** is the standard pattern for block definitions, config objects, and type maps.
- **`.propmacro.ts` files** declare global augmentations for the custom transformer. They must be imported to activate their macros; the hoisting guard at the top of each file is load-order boilerplate — do not remove it.
- **Short-circuit condition ordering** — in `||`/`&&` expressions, put the cheapest operand first. A plain boolean variable should come before an object comparison so it short-circuits before the heavier check when possible.
- **Never define before a guard if the guard can make it unused.** Defining a variable (especially one that allocates) before a guard that may skip its only use is always wrong — move the definition past the guard.
- **`static readonly` scope in blocks** — values referenced inside `definition` must be module-level constants (definition is declared before the class). `static readonly` is for class-associated data only used within the class itself (e.g. derived constants, lookup tables). **Exception: `events`.** Blocks that have server middleware use a module-level `const events = { ... }` (e.g. Screen, Button, Speaker) — this is the established pattern. `static readonly events` appears in Particle/Tracer but those share one lineage; `const events` is the convention for middleware blocks.
- **`Vector3.zero` over `new Vector3(0, 0, 0)`** — prefer the static property for variable initialization. In block config defaults (`config: new Vector3(...)`) use `new Vector3` directly — the value is meant to be changed and the explicit constructor makes that intent clear.
- **Non-null assertion `!`** — acceptable when a guard earlier in the same scope makes the value's presence obvious to the reader but TypeScript cannot track it (e.g. inside a closure that captures an `| undefined` variable). Do not introduce an extra `const` alias just to satisfy the type checker in these cases.
- **`initializeInputCache` — `get()` vs `tryGet()`.** `get()` asserts the value is set; it's safe in a boolean/guarded read (`if (!cache.get()) return`). For arithmetic use `tryGet() ?? fallback` — the cache can be unset on the first ticks and `get()` returning `nil` crashes the math.
- **Config tables with a `Default` entry — fall back to the `Default`, not a literal.** When reading an optional property from a table that defines a `Default` (e.g. `Materials.Properties` in `engine/shared/data/Materials`), use that entry's value as the `??` fallback (`Materials.Properties[name]?.field ?? Materials.Properties.Default.field!`), so the fallback stays in sync with the source of truth instead of drifting from a hand-written constant.

- **Reading inputs every tick** — a side-effect block that acts every tick (weapon hold-to-fire, motor) takes one `initializeInputCache(key)` per needed input, then reads them inside `onTicc(ctx => …)` via `cache.get()` (guarded/boolean) or `cache.tryGet() ?? fallback` (arithmetic). Prefer this over reading `this.input[key].get(ctx)` directly (which returns a `garbage`/`availableLater` sentinel you must guard) and over caching one combined object via `on`. For PID-style logic that needs all inputs **plus `dt`** in lockstep, the combined `on`-cache is still fine: type it `AllInputKeysToObject<(typeof definition)["input"]> | undefined` (from `blockLogic/BlockLogic`), declare it `undefined` (no zero-filled dummy), let `on` populate it, and guard `if (inputValues === undefined) return` at the top of `onTicc`.

## Performance

There can be hundreds of active block instances simultaneously. Performance is a hard requirement, not a preference.

- **No per-tick allocations.** Pre-allocate arrays, params objects, and closures outside tick callbacks and reuse them. Use `table.clear(arr)` to reset pre-allocated arrays rather than reassigning to `[]`. Exception: an allocation that saves thread time is the better trade — e.g. one native `table.clone` snapshot beats a hand-written element-copy loop into a reused buffer. Memory/GC churn is the cheaper currency than CPU; still, prefer a design that needs neither, and allocate only on change, never unconditionally every tick.
- **Parallel arrays over nested tables.** When buffering pairs of values per iteration (e.g. segment origins and ends), use two flat pre-allocated arrays instead of an array of 2-element tuples. Each tuple is a separate Lua table allocation; flat arrays eliminate this entirely.
- **Limit loops to active range.** When only a slice of an array is active (e.g. beams 0 to `nextBeam`), loop that range rather than the full array.
- **Arrow functions defined outside callbacks** are allocated once at construction and closed over — this is correct and adds no per-tick cost. Arrow functions defined *inside* a tick callback allocate a new closure every tick.
- **`time()` over `DateTime.now()`** — `DateTime.now()` allocates a `DateTime` object on every call. `time()` (Roblox global) returns elapsed seconds as a plain number with no allocation. Always use `time()` for elapsed-time arithmetic in tick callbacks.
- **Scale per-tick rates by `dt`.** Logic in a `PostSimulation`/`Heartbeat` loop that decays or accumulates per tick (heat, cooldowns, probabilities) is frame-rate-coupled if it ignores `dt` — it speeds up/slows down with the server frame rate. Multiply rates by `dt`; if the constants were tuned per-tick at 60 Hz, normalise with `dt * 60` to keep the same feel. Pair this with sending state to clients only on a meaningful change (a step threshold), not every frame — the client interpolates between, so per-frame sends are wasted bandwidth.
- **Drop map entries once they're inert.** Per-tick loops over a `Map` (e.g. blocks still cooling) should `delete` an entry when it reaches its resting state, not leave it at `0` — otherwise every settled entry is re-scanned every frame forever. Collect keys to remove during the loop and delete them after (removing the current key mid-`pairs` is safe in Luau, but the collect-then-delete pattern is clearer).
- **Instance property access crosses the Luau↔engine boundary** (~100ns+ per write, even when the value is unchanged); a pure-Luau number compare is nanoseconds. Don't write Instance properties (`Parent`, `Transparency`, `CFrame`) every tick when they rarely change — track the state in Luau and write only the delta. E.g. when visible parts always form a prefix `[0, n)`, store last tick's `n` and unparent only `[n, prevN)`. Initialize such trackers to the prefab's real starting state: a model's own template part starts parented, so the initial "shown" count may be 1, not 0.
- **Gate visual updates on change; render on `PreRender`.** For a block that derives visuals from per-tick state (see `LaserBlock`): keep the computation and logic outputs on the tick, move all appearance writes into a client-guarded `PreRender` subscription gated by a `needsRedraw` flag. Detect change by comparing the world-space results themselves (Vector3 `===` is exact value equality), cheapest checks first. When the render gate reads a snapshot (`lastX ||`), the tick's diff must compare `x !== lastX` rather than testing `x` directly — the toggle itself must count as a change, or the snapshot never refreshes and the gate sticks on.
