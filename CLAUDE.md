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
- `initializeRecalcInputCache(key)` — use with `onkRecalcInputs([], ...)` when you need access to inputs independently of each other (e.g. AND-gate that can short-circuit on `false` without both inputs being ready).
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

`connectorHidden: true` on an individual input prevents the player from wiring that input from the logic system at runtime — the value is treated as a constant set via the config panel only (e.g. `imin`/`imax` on the PID controller).

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

**`next` is a reserved Lua built-in** — never use it as a variable name. roblox-ts will compile it without error but it shadows the Lua `next()` function and causes undefined behaviour. Use a different name (e.g. `nextI`, `nextVal`).

**Never use `for...in`.** It has zero usages in the codebase. In roblox-ts it compiles to Luau behavior that iterates string keys of objects (JavaScript semantics), which is meaningless for typed arrays or maps. Use `for...of` for arrays and `pairs()` for key-value iteration.

**Compiler macros:**
- `$tuple(a, b)` — creates a `LuaTuple` for multiple returns (compiles to `return a, b` in Lua)
- `$trace(...)` / `$debug(...)` / `$log(...)` / `$warn(...)` / `$err(...)` — logging macros that route through `Logger` (→ Lua `print`/`warn`). Output goes to the console/output window. All levels are disabled by default; admins can toggle them in-game via the Developer Switches tab in `AdminGui`. `$warn` and `$err` use Lua's `warn()` when active.
- `$beginScope(name)` — opens a named logging scope (matched with `Logger.endScope()`)
- `$autoResolve(func)` — wraps a function so its parameters are auto-resolved from a `DIContainer`
- `asMap(obj)` — converts a plain object/table to a `ReadonlyMap`
- `asObject(map)` — converts a `ReadonlyMap` back to a plain object

**Write only TypeScript** — never write `.lua`/`.luau` directly. Let the compiler handle the translation. The Roblox Studio debugger will show compiled Luau, not TypeScript source.

**Guards over nesting.** Prefer early returns to flatten control flow rather than nested `if` blocks. This is the dominant style throughout the codebase.

**Ternary operators** are used often for concise conditionals but should not replace every `if` statement — use judgment based on readability.

**`ObservableValue<T>`** is used extensively throughout the codebase. It stores a value and fires a `changed` signal when it changes. Key API: `.get()`, `.set(value)`, `.changed` (signal). Prefer `ObservableValue` over manual signal+field pairs whenever a value needs to be observed.

**Follow existing block files as the reference.** When adding or modifying a block, copy the structure of an existing block file closely — definition shape, constructor wiring, `elseFunc` guard style, `as const satisfies` pattern. If uncertain about a convention, find the nearest existing example and match it exactly.

**GUI config controls** — `ConfigControlBase<T, V>` is the base class for block configuration UI controls. It wraps a `SubmittableValue` (edit state + submit event) backed by an `ObservableValue`, and supports multi-block editing via `Values<V> = { [k: string]: V }`. Subclass it when building a reusable config input. Leave broader GUI work to the user unless the pattern is clearly established.

**External reference:** https://create.roblox.com/docs — Roblox Creator documentation for engine APIs, services, and instance types.

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

**Services** (`HostedService extends Component`) are long-lived singletons that cannot be disabled. Register them via `GameHostBuilder.services.registerService<T>(MyService)`. They are parented to the `GameHost` automatically.

**Scoped containers:**
```ts
const child = di.beginScope((builder) => {
    builder.registerSingletonValue(x);
});
```
Child containers inherit all parent registrations and override only what they add.

**`@pathOf("T")` decorator** on a parameter is a transformer macro — it replaces the parameter's runtime value with the string path of TypeScript type `T`. This is how `resolve<T>()` works without an explicit string argument.

**`$autoResolve`** wraps a function so all its parameters are resolved from a `DIContainer` automatically.

## Code Conventions

- **Imports**: absolute only (no relative paths). `baseUrl` is `src`. Runtime values: `import { X }`. Types only: `import type { X }`. Import order: builtin → external → internal, alphabetical within groups (enforced by ESLint).
- **Formatting**: tabs, 120-char lines, double quotes, trailing commas, LF line endings (Prettier-enforced).
- **No `public`** keyword on class members (`@typescript-eslint/explicit-member-accessibility`).
- **No `any`** except rest args.
- **`as const satisfies T`** is the standard pattern for block definitions, config objects, and type maps.
- **`.propmacro.ts` files** declare global augmentations for the custom transformer. They must be imported to activate their macros; the hoisting guard at the top of each file is load-order boilerplate — do not remove it.
- **Short-circuit condition ordering** — in `||`/`&&` expressions, put the cheapest operand first. A plain boolean variable should come before an object comparison so it short-circuits before the heavier check when possible.
- **Never define before a guard if the guard can make it unused.** Defining a variable (especially one that allocates) before a guard that may skip its only use is always wrong — move the definition past the guard.
- **`static readonly` scope in blocks** — values referenced inside `definition` must be module-level constants (definition is declared before the class). `static readonly` is for class-associated data only used within the class itself (e.g. derived constants, lookup tables). **Exception: `events`.** Blocks that have server middleware use a module-level `const events = { ... }` (e.g. Screen, Button, Speaker) — this is the established pattern. `static readonly events` appears in Particle/Tracer but those share one lineage; `const events` is the convention for middleware blocks.
- **`Vector3.zero` over `new Vector3(0, 0, 0)`** — prefer the static property for variable initialization. In block config defaults (`config: new Vector3(...)`) use `new Vector3` directly — the value is meant to be changed and the explicit constructor makes that intent clear.
- **Non-null assertion `!`** — acceptable when a guard earlier in the same scope makes the value's presence obvious to the reader but TypeScript cannot track it (e.g. inside a closure that captures an `| undefined` variable). Do not introduce an extra `const` alias just to satisfy the type checker in these cases.
- **`initializeInputCache` — use `tryGet()`, never `get()`** in tick callbacks. `tryGet()` returns `T | undefined`; `get()` asserts non-undefined but the cache may have no value yet, causing a nil arithmetic error at runtime. Pattern: `cache.tryGet() ?? fallback`.

- **Input value caching pattern** — blocks that need both input values and `dt` (time-based logic like PID) use `on` to cache inputs and `onTicc` for the tick computation. Type the cache as `AllInputKeysToObject<(typeof definition)["input"]> | undefined` (imported from `blockLogic/BlockLogic`) and guard with `if (inputValues === undefined) return` at the top of `onTicc`. Do not initialize with a zero-filled dummy object — declare as `undefined` and let `on` populate it.

## Performance

There can be hundreds of active block instances simultaneously. Performance is a hard requirement, not a preference.

- **No per-tick allocations.** Pre-allocate arrays, params objects, and closures outside tick callbacks and reuse them. Use `table.clear(arr)` to reset pre-allocated arrays rather than reassigning to `[]`.
- **Parallel arrays over nested tables.** When buffering pairs of values per iteration (e.g. segment origins and ends), use two flat pre-allocated arrays instead of an array of 2-element tuples. Each tuple is a separate Lua table allocation; flat arrays eliminate this entirely.
- **Limit loops to active range.** When only a slice of an array is active (e.g. beams 0 to `nextBeam`), loop that range rather than the full array.
- **Arrow functions defined outside callbacks** are allocated once at construction and closed over — this is correct and adds no per-tick cost. Arrow functions defined *inside* a tick callback allocate a new closure every tick.
- **`time()` over `DateTime.now()`** — `DateTime.now()` allocates a `DateTime` object on every call. `time()` (Roblox global) returns elapsed seconds as a plain number with no allocation. Always use `time()` for elapsed-time arithmetic in tick callbacks.
