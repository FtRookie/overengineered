# Utility APIs

**The first place to look whenever you are about to write a helper.** The utility layer is deep and most "small
helpers" already exist, often under a name you would not guess — a method on the type where a free function
seemed needed. The propmacro index and every shared namespace are below.

> Extracted from `CLAUDE.md`, which keeps the tripwires and routes here for detail.

## Where the macros live

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

## Collection macros (Array / Set / Map)

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

## Vector3 macros

Injected by `engine/shared/fixes/Roblock.propmacro.ts`:

- `v.with(x?, y?, z?)` — new Vector3 with selective axis override, e.g. `v.with(undefined, 0)` zeros only Y
- `v.apply(func)` — maps a function over each axis: `v.apply((n) => math.abs(n))`
- `v.findMin()` / `v.findMax()` — min/max scalar across all three axes

**Prefer the macro over `VectorUtils`.** `shared/utils/VectorUtils` carries a static `apply(v, func)` and
friends (`round`, `normalize`, `roundVector3To`, `areCFrameEqual`); those exist for static contexts where there
is no receiver to call a method on. When you have a `Vector3` in hand, `v.apply(f)` is the idiom.

## Color3 macros

Injected by `engine/shared/fixes/Color3.propmacro.ts` — the same shape as the Vector3 macros:

- `c.apply(func)` — maps over each channel; the callback receives `(value, "R" | "G" | "B")`
- `c.with(r?, g?, b?)` — new Color3 with selective channel override
- `c.mul(n)` — scalar multiply

## String macros & Strings namespace

Injected by `engine/shared/fixes/String.propmacro.ts`:

- `str.contains(s)`, `str.startsWith(s)`, `str.trim()`, `str.fullLower()`, `str.fullUpper()`
- `Strings.pretty(value)` — recursive pretty-printer for any value
- `Strings.prettyNumber(value, step)` — formats with step-based decimal places
- `Strings.prettySecondsAgo(s)` / `Strings.prettyTime(s)` — human-readable time
- `Strings.prettyKMT(n)` / `Strings.prettyKMB(n)` — abbreviate large numbers (k/M/G/T or k/M/B/T)

## ComponentEvents helpers

`this.event` (a `ComponentEvents`) provides subscription helpers that auto-disconnect on disable/destroy:

- `this.event.subscribe(signal, callback)` — registers through `onEnable`, so it disconnects on disable and **reconnects on every enable**; one made while disabled still arrives on the next enable rather than being lost
- `this.event.subscribeObservable(observable, callback, executeOnEnable?, executeImmediately?)` — subscribe to an `ObservableValue`
- `this.event.subscribeObservablePrev(observable, callback, ...)` — same but receives previous value
- `this.event.subscribeCollection` / `subscribeCollectionAdded` / `subscribeMap` — collection/map subscriptions
- `this.event.subscribeRegistration(func)` — register a custom `SignalConnection`
- `this.event.loop(interval, func)` — **preferred over manual `task.spawn` loops**; only runs `func` while enabled, checks `isDestroyed()` internally, returns a `SignalConnection` to stop it
- `this.event.observableFromInstanceParam(instance, param)` — two-way `ObservableValue` bound to an instance property
- `this.event.addObservable(fakeObservable)` — registers a `FakeObservableValue` for auto-destroy

## ObservableValue macros

- `obs.subscribe(func, executeImmediately?)` — shorthand for `obs.changed.Connect`
- `obs.subscribePrev(func, executeImmediately?)` — callback receives `(value, prev)`
- `obs.subscribeWithCustomEquality(func, equalityCheck, executeImmediately?)` — skip callback when equal
- `obs.waitOnceFor(predicate, action)` — fires action once when predicate is true, then disconnects
- `obs.connect(other)` — two-way sync between two observables
- `obs.createBothWayBased(toOld, toNew)` — derived two-way observable with transform functions
- `obs.toggle()` — boolean only; flips and returns the new value

## Runtime type checking (`t`)

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

## Component macros

From `engine/shared/component/Component.propmacro.ts`:

- `setEnabled(bool)` / `switchEnabled()` — instead of branching on `enable()`/`disable()` by hand
- `onEnabledStateChange(func, executeImmediately?)` — one subscription for both directions
- `with(func)` / `withParented(child)` — configure and return `this`, for chaining at a parent call
- `asTemplate(object, destroyOriginal?)` — turns an instance into a `() => T` clone factory
- `parentDestroyOnly(child)` — sugar for `parent(child, { enable: false, disable: false })`
- `getAttribute<T>(name)`

## Derived observables

`engine/shared/event/FakeObservableValue.propmacro.ts` builds observables *from* other observables, so a
derived value never needs its own subscription bookkeeping:

- `obs.fCreateBased(funcTo, funcFrom)` / `obs.fReadonlyCreateBased(funcTo)` — map to a new observable
- `obs.fWithDefault(value)` / `obs.fReadonlyWithDefault(value)` — substitute a default for `undefined`
- `obs.asArray()` — `ObservableValue<ReadonlySet<T>>` viewed as an array

## Transforms

`engine/shared/component/Transform*.ts` plus `Transform.propmacro` / `SecondaryTransform.propmacro` are the
animation/tweening system (`Transforms`, `TransformBuilder`, `Easing`). It is a large builder API — read the
source before using it rather than guessing the shape.

## `Objects` namespace

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

## Global type helpers

`engine/shared/fixes/Types.d.ts` is ambient — **no import needed**, and these are easy to reimplement by
accident:

`Replace<T, K, V>`, `ReplaceWith<T, Props>`, `MakePartial<T, K>`, `MakeRequired<T, K>`, `OmitOverUnion<T, K>`,
`ConstructorOf<T, Args>`, `AbstractConstructorOf<T, Args>`, `InstanceOf<T>`, `ArgsOf<T>`,
`ConstructorToFunction<T>`, `PartialThrough<T>`.

## Remaining `engine/shared/fixes`

- **`BB`** — oriented bounding box. `BB.from(instance)` / `fromPart` / `fromModel` / `fromModels` / `fromBBs` /
  `fromRegion3`, then `withCenter`, `withSize`, `toAxisAligned`, `getRotatedSize`, `isPointInside`, `isBBInside`.
  Use it rather than hand-rolling `GetBoundingBox` maths.
- **`Instances`** — `findChild`, `waitForChild`, `waitClientOrCreateServer`, `pathOf`, `relativePathOf`.
- **`JSON`** (`fixes/Json.ts`) — `serialize` / `deserialize` that round-trip Roblox datatypes (CFrame, Vector3,
  Vector2, UDim, UDim2, Color3, EnumItem). The built-in `HttpService:JSONEncode` cannot.
- **`Keys`** — `isKey`, `isKeyGamepad`, `isKeyGamepadDPad`, `toReadable` for a display string.
- **`MathUtils`** — `round(value, step)`, `clamp`, `e`.
- **`Arrays.intersect` / `Sets.intersect`** (`fixes/Arrays.ts`) — plain functions, separate from the macros.

## The two `Colors` namespaces

Both export a namespace named `Colors`, so only the import path distinguishes them. This is a leftover from
the engine being merged into the game codebase, not a designed split — both carry the same nine base colours
with identical values, and `toInt` / `lightenPressed` are duplicated verbatim.

**Use `shared/Colors`.** It is the game's own copy and the only one with the palette (`accent`, `accentDark`,
`accentLight`, `accentBlack`, `staticBackground`, `newGui`). `engine/shared/Colors` is the older file; the one
thing unique to it is `grayscale(b)`.

The exception is code under `engine/`, which is the framework layer and does not import from `shared/` — it
has to keep using its own copy. Game-side files still importing the engine one are migration candidates, not
examples to follow.

## Client propmacros

Code-side helpers for GUI components — distinct from building the player-facing instances themselves, which
belong in Studio:

- `engine/client/component/Component.propmacro` — `parentGui`, `buttonComponent`, `addButtonAction`,
  `addButtonActionSelf`, `setButtonText`, `setButtonInteractable`, `visibilityComponent`, `show`/`hide`
- `engine/client/gui/ComponentEvents.propmacro` — `onPrepare` / `onPrepareDesktop` / `onPrepareTouch` /
  `onPrepareGamepad`, `onInputBegin`/`onInputEnd`, `onKeyDown`/`onKeyUp`, `subInput`
- `engine/client/gui/TooltipComponent.propmacro` — `tooltipComponent`, `setTooltipText`
- `client/Action.propmacro` — `initKeybind(registration, config?)`
- `client/Theme.propmacro` — `themeButton`

## Deprecated macros

- `Vector3.min(v)` / `Vector3.max(v)` — use the Roblox built-ins
- `ObservableValue.createBased` — use `fCreateBased`
- Anything tagged `@deprecated Internal use only` / `@hidden` in `t.propmacro` and
  `FakeObservableValue.propmacro` is plumbing, not API
