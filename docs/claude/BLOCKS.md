# Block System Architecture

Ids, registration, definitions, logic classes, value sentinels, and the input-subscription decision tree.

> Extracted from `CLAUDE.md`, which keeps the tripwires and routes here for detail.

The logic block system is the core of the game. Understanding it is required for most work in `src/shared/`.

## Block IDs and save data

The `id` field on a `BlockBuilder` is the stable identifier used to persist player save data. **Renaming an `id` string breaks existing saves.** Two forms:

- **Explicit `id:`** — set directly on the exported `const` in a block's own file (e.g. `id: "tpscounter"`).
- **Key-as-id** — blocks in `src/shared/blocks/blocks/grouped/BuildingBlocks.ts` use `BlockBuildersWithoutIdAndDefaults` (no explicit `id:`). `BlockCreation.arrayFromObject` converts the object's keys into the `id` for each entry. Renaming a key in that object is therefore also a breaking save-data change.

## Registering a block

The `BlockBuilder` export lives at the **bottom of the block's own file** (e.g. `LuaCircuitBlock.ts` exports `LuaCircuitBlock` at the end). Logicless blocks (no `BlockLogic`) go in `src/shared/blocks/blocks/grouped/BuildingBlocks.ts`. Once defined, the export is imported and added to the array in `src/shared/SandboxBlocks.ts` to appear in-game.

## Defining a block

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

## Block logic class

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

## AVAILABLELATER vs GARBAGE

`BlockLogicValueResults` has two sentinels:

- `availableLater` — the source block hasn't produced a value yet this recalc cycle. Also occurs with circular logic (a block wired to itself or any dependency cycle, e.g. a NOT gate feeding back into its own input) — in that case it never resolves.
- `garbage` — unconfigured value by player (e.g. unwired input); will never produce a value.

These are returned by input storage when no value is set, and propagated through `BlockBackedInputLogicValueStorage` from wired sources.

`garbage` means *will never produce a value*, so it covers more than an unwired input: a burned block, and a destroyed one (the runner calls `disableAndBurn()` on any block whose tick throws, and a block whose model was destroyed throws every tick thereafter).

## Reading block state from outside — `getDebugInfo`

`getDebugInfo` is the read-only view of a block used by `LogicVisualizer` and the graphing tool. Three properties it must keep:

- **It never forces a recalculation.** It reads `isGarbage` and the stored value directly rather than calling `getOutputValue`, which recalculates the block as a side effect. A consequence worth knowing when debugging: an output nothing pulls reads as `AVAILABLELATER`, because nothing has asked it to compute.
- **It only trusts a stored output value while the block is enabled.** `OutputLogicValueStorage` retains the last value indefinitely — nothing clears it when a block stops running — so a dead block would otherwise keep reporting a stale value as though it were live.
- **Both inputs and outputs report sentinels.** An output holding nothing emits `GARBAGE`/`AVAILABLELATER` in its `type`, the same as an input.

**Pausing a ride does not disable blocks.** It is `BlockLogicRunner.stopTicking()`, which disconnects the tick loop; `isEnabled()` stays true throughout. Anything gating on enabled state therefore keeps working while paused — which is what makes the paused visualiser readable.

## CalculatableBlockLogic

For pure computation blocks (no side effects, output is a pure function of inputs), extend `CalculatableBlockLogic` instead. It automatically calls `disableAndBurn()` and propagates GARBAGE downstream when any input goes to GARBAGE. Override `calculate()` instead of wiring up handlers.

## elseFunc convention

`garbage` and `availableLater` are handled the same way in `elseFunc` — both mean no valid value is available, so typically just unset the output:

```ts
(result) => {
    this.output.result.unset();
},
```

## Input type definitions

Use `BlockConfigDefinitions` for standard type sets:

```ts
types: BlockConfigDefinitions.any     // bool, number, vector3, string, byte, color, sound
types: BlockConfigDefinitions.number  // number only
types: BlockConfigDefinitions.bool    // bool only
```

For output types, use a plain string array — `types: ["bool"]`, `types: ["vector3"]`, etc. Use `Objects.keys(BlockConfigDefinitions.any)` only when the output must support all types (e.g. memory/passthrough blocks).

## Input display options

`inputOrder: [...]` on the definition controls the order inputs appear in the config UI. List all input keys in the desired display order.

**It is a complete list, not a partial override — every input key must appear in it, and every entry must be a real input key.** Adding an input without extending `inputOrder` throws when the config menu is opened (`Some definition keys were not present in the order`, `BlockConfigControls.ts:1663`); leaving a stale entry behind after removing an input throws the mirror error on the next check. `npm run check` catches both before Studio — `BlockAssertions.checkDefinitionOrder` reports `invalid inputOrder` in either direction. `outputOrder` follows the same rule and the same assertion, but fails silently rather than throwing: an unlisted output simply never appears in the graph picker or `getDebugInfo`.

`connectorHidden: true` on an individual input prevents the player from wiring that input from the logic system at runtime — the value is treated as a constant set via the config panel only (e.g. `imin`/`imax` on the PID controller). Read such an input once with `onkFirstInputs([key], …)` rather than `initializeInputCache` or `onk` (see the input-subscription notes above) — it's set in build mode and constant for the ride, so any per-tick read or change-check after the first delivery is wasted; `onkFirstInputs` delivers once and disconnects.

`configHidden: true` hides the input from the config menu UI, reducing visual clutter for inputs that don't need to be manually configured (e.g. the 16 I/O nodes on LuaCircuit). When `configHidden: true` and `connectorHidden: false`, the connector will still appear on the block face if something is wired to it.

## Client-only handlers in block constructors

Block logic is effectively client-only at runtime, and only runs on the **owning player's client** — not on spectating clients. The server instantiates block logic solely for initialization and test plane purposes — no block in the codebase does meaningful work server-side (confirmed: zero `RunService.IsServer()` calls exist in any block file). Treat the owning client as the only real execution environment when writing block logic.

Any handler that calls a client-only API — `C2SRemoteEvent.send()`, `Players.LocalPlayer`, machine state, etc. — must be registered **after** `if (!RunService.IsClient()) return`, or guard internally with the same check. Calling a client-only API on the server throws at runtime.

## `static readonly` scope in blocks

- **`static readonly` scope in blocks** — values referenced inside `definition` must be module-level constants (definition is declared before the class). `static readonly` is for class-associated data only used within the class itself (e.g. derived constants, lookup tables). **Exception: `events`.** Blocks that have server middleware use a module-level `const events = { ... }` (e.g. Screen, Button, Speaker) — this is the established pattern. `static readonly events` appears in Particle/Tracer but those share one lineage; `const events` is the convention for middleware blocks.

## `initializeInputCache` — `get()` vs `tryGet()`

- **`initializeInputCache` — `get()` vs `tryGet()`.** The two are *identical at runtime* — both return the value or `nil`; they differ only in the declared TypeScript type, so `get()` merely claims the result is non-optional. It does not assert. Use `get()` only where `nil` is harmless (`if (!cache.get()) return`), and `tryGet() ?? fallback` everywhere the value is consumed — for arithmetic an unset cache yields `nil` and crashes the math one line later, and in a payload it silently becomes a missing field. A `get() ?? fallback` is not wrong at runtime, but the type checker believes the fallback is dead code and a later cleanup will delete it.

## Reading inputs every tick

- **Reading inputs every tick** — a side-effect block that acts every tick (weapon hold-to-fire, motor) takes one `initializeInputCache(key)` per needed input, then reads them inside `onTicc(ctx => …)` via `cache.get()` (guarded/boolean) or `cache.tryGet() ?? fallback` (arithmetic). Prefer this over reading `this.input[key].get(ctx)` directly (which returns a `garbage`/`availableLater` sentinel you must guard) and over caching one combined object via `on`. For PID-style logic that needs all inputs **plus `dt`** in lockstep, the combined `on`-cache is still fine: type it `AllInputKeysToObject<(typeof definition)["input"]> | undefined` (from `blockLogic/BlockLogic`), declare it `undefined` (no zero-filled dummy), let `on` populate it, and guard `if (inputValues === undefined) return` at the top of `onTicc`.
