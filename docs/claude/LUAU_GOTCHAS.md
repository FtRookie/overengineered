# roblox-ts / Luau Gotchas

Truthiness, LuaTuples, shadowed globals, compiler macros and RunService signals — the traps nothing in the toolchain catches for you.

> Extracted from `CLAUDE.md`, which keeps the tripwires and routes here for detail.

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

## LuaTuple comparisons and returns

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

## Namespace methods compile to Luau methods

**A compiled namespace method is a Luau method — call it with `:`, not `.`.** Any exported function that uses
`this` compiles to `function ns:name(...)`, so reading it back from compiled output (or through the Lune shim)
needs the colon. `t.typeCheck(5, t.number)` returns **`false`** because `5` binds to `self`, where
`t:typeCheck(5, t.number)` returns `true` — it fails with a wrong answer rather than an error, so nothing
flags it.

## Shadowed globals and reserved identifiers

**Never name a variable after a Luau global.** TypeScript has no idea these exist, so nothing warns you, and the two ways it goes wrong look nothing alike.

*Silent* — a local shadows the global for the rest of its scope, and the break lands on whatever calls it next, often in a later edit rather than the one that introduced it: `next`, `pairs`, `ipairs`, `select`, `unpack`, `print`, `warn`, `error`, `assert`, `pcall`, `xpcall`, `require`, `tostring`, `tonumber`, `rawget`, `rawset`, `setmetatable`, `getmetatable`; the library tables `table`, `string`, `math`, `os`, `task`, `coroutine`, `debug`, `utf8`, `buffer`, `bit32`; and the Roblox globals `game`, `workspace`, `script`, `shared`, `Enum`, `Instance`, `tick`, `time`, `wait`, `spawn`, `delay`. Suffix instead — `nextI`, `segmentPairs`, `startTime`.

*Loud* — a few are reserved by the compiler and fail the build with `Cannot use identifier reserved for compiler internal usage`. `type` is one. This only appears when `rbxtsc` emits, so `driver.sh verify` (which is `tsc --noEmit`) passes right up until the watcher rejects it.

**Never use `for...in`.** It has zero usages in the codebase. In roblox-ts it compiles to Luau behavior that iterates string keys of objects (JavaScript semantics), which is meaningless for typed arrays or maps. Use `for...of` for arrays and `pairs()` for key-value iteration.

## Compiler macros

**Compiler macros:**
- `$tuple(a, b)` — creates a `LuaTuple` for multiple returns (compiles to `return a, b` in Lua)
- `$trace(...)` / `$debug(...)` / `$log(...)` / `$warn(...)` / `$err(...)` — logging macros that route through `Logger` (→ Lua `print`/`warn`). Output goes to the console/output window. All levels are disabled by default; admins can toggle them in-game via the Developer Switches tab in `AdminGui`. `$warn` and `$err` use Lua's `warn()` when active.
- **`print` for temporary diagnostics, the macros for anything that ships.** A macro is gated behind the Developer Switches, which means enabling them by hand every test session — pointless for lines that get deleted at the end of it. Use a bare `print` while diagnosing, and remove every one before the work is done; use `$log`/`$warn`/`$err` for logging that stays in the code for monitoring.
- `$beginScope(name)` — opens a named logging scope (matched with `Logger.endScope()`)
- `$autoResolve(func)` — wraps a function so its parameters are auto-resolved from a `DIContainer`
- `asMap(obj)` — converts a plain object/table to a `ReadonlyMap`
- `asObject(map)` — converts a `ReadonlyMap` back to a plain object

## RunService signal names

**RunService event connections** — always use the modern signal names; the old ones are deprecated:

| Deprecated | Use instead | Fires |
|---|---|---|
| `Heartbeat` | `PostSimulation` | After physics, every frame |
| `RenderStepped` | `PreRender` | Before rendering, client only |
| `Stepped` | `PreSimulation` | Before physics, every frame |

Use `PostSimulation` for physics-driven logic and `PreRender` for visual/rendering updates (client-only). `PreRender` is preferred for anything that changes part appearance (Color, Transparency, CFrame overrides).

## TypeScript only

**Write only TypeScript** — never write `.lua`/`.luau` directly. Let the compiler handle the translation. The Roblox Studio debugger will show compiled Luau, not TypeScript source.
