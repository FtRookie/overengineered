# Code Conventions

Helper reuse, comment minimisation, formatting, and the per-construct conventions.

> Extracted from `CLAUDE.md`, which keeps the tripwires and routes here for detail.

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
    - *Announcing a fix* — **a fix is not a comment-worthy event.** The corrected behaviour is what the code was always meant to do, so there is nothing to declare; the diff, the commit message and the reply carry the history. Never contrast the new line with the old (`// continue, not return:`, `// the absolute path, not an append:`), restate the symptom (`// "" is truthy in Luau, so the old guard never fired`), or name the bug being closed. All three describe code that is no longer there, and they read as noise to everyone who arrives after the fix — which is everyone. If the corrected line still needs explaining on its own merits — a magic constant, an engine quirk, an ordering that looks arbitrary — write *that*, phrased as though the bug had never existed.

    Write only what the code cannot say: where a magic constant came from, an ordering that looks arbitrary but is not, an engine quirk that would otherwise read as a mistake. Existing commented-out code is there for a reason — leave it; never comment out code yourself unless explicitly asked. JSDoc is common on `engine/` APIs but not a blanket requirement — add it where a method is frequently used or its name is abbreviated enough to need explaining; game code (`shared/`, `client/`, `server/`) rarely uses it.
- **Avoid metaphors.** In comments and explanations, describe the mechanism literally rather than through analogy — say what the code does in technical terms, not "keep the pool warm", "swallow the event", "starve the queue". A plain description is clearer to the next reader and does not assume they share the figure of speech.
- **Declare instances in Studio, not in code.** Visual/audio instances — parts, lights, particles, sounds, GUI templates — belong in Studio as prefabs/assets synced through Rojo and fetched via `ReplicatedAssets` / a cloned template, not built with `new Instance(...)` in logic. Inlining them scatters tunable values across code, takes them out of designer control, and bypasses the asset pipeline. If you genuinely must inline-create something that should be a Studio asset (a quick placeholder), mark it `// fixme: <should be a Studio asset>` so it's findable. `// fixme:` in general flags known-suboptimal code to revisit — grep-able, distinct from a permanent rationale comment.
- **No `public`** keyword on class members (`@typescript-eslint/explicit-member-accessibility`).
- **No `any`** except rest args.
- **`as const satisfies T`** is the standard pattern for block definitions, config objects, and type maps.
- **`.propmacro.ts` files** declare global augmentations for the custom transformer. No manual import is needed: the transformer rewrites each call site to dispatch through the macro table and injects the import of the `.propmacro` module itself (verify in compiled output — `ColorChooser.luau` imports `SecondaryTransform.propmacro` with no such import in its source). Each file carries a hoist — `const _ = () => [SomeMacros, OtherMacros];` — which compiles to a forward declaration of the macro tables at the top of module scope, so the tables can reference each other and themselves. It is not dead code: removing it breaks how the transformer emits the module. Helper classes may precede it (`SecondaryTransform.propmacro.ts` does), but the hoist itself must list every macro table the file exports.
- **Short-circuit condition ordering** — in `||`/`&&` expressions, put the cheapest operand first. A plain boolean variable should come before an object comparison so it short-circuits before the heavier check when possible.
- **Never define before a guard if the guard can make it unused.** Defining a variable (especially one that allocates) before a guard that may skip its only use is always wrong — move the definition past the guard.
- **`static readonly` scope in blocks** — values referenced inside `definition` must be module-level constants (definition is declared before the class). `static readonly` is for class-associated data only used within the class itself (e.g. derived constants, lookup tables). **Exception: `events`.** Blocks that have server middleware use a module-level `const events = { ... }` (e.g. Screen, Button, Speaker) — this is the established pattern. `static readonly events` appears in Particle/Tracer but those share one lineage; `const events` is the convention for middleware blocks.
- **`Vector3.zero` over `new Vector3(0, 0, 0)`** — prefer the static property for variable initialization. In block config defaults (`config: new Vector3(...)`) use `new Vector3` directly — the value is meant to be changed and the explicit constructor makes that intent clear.
- **Non-null assertion `!`** — acceptable when a guard earlier in the same scope makes the value's presence obvious to the reader but TypeScript cannot track it (e.g. inside a closure that captures an `| undefined` variable). Do not introduce an extra `const` alias just to satisfy the type checker in these cases.
- **`initializeInputCache` — `get()` vs `tryGet()`.** The two are *identical at runtime* — both return the value or `nil`; they differ only in the declared TypeScript type, so `get()` merely claims the result is non-optional. It does not assert. Use `get()` only where `nil` is harmless (`if (!cache.get()) return`), and `tryGet() ?? fallback` everywhere the value is consumed — for arithmetic an unset cache yields `nil` and crashes the math one line later, and in a payload it silently becomes a missing field. A `get() ?? fallback` is not wrong at runtime, but the type checker believes the fallback is dead code and a later cleanup will delete it.
- **Config tables with a `Default` entry — fall back to the `Default`, not a literal.** When reading an optional property from a table that defines a `Default` (e.g. `Materials.Properties` in `engine/shared/data/Materials`), use that entry's value as the `??` fallback (`Materials.Properties[name]?.field ?? Materials.Properties.Default.field!`), so the fallback stays in sync with the source of truth instead of drifting from a hand-written constant.

- **Reading inputs every tick** — a side-effect block that acts every tick (weapon hold-to-fire, motor) takes one `initializeInputCache(key)` per needed input, then reads them inside `onTicc(ctx => …)` via `cache.get()` (guarded/boolean) or `cache.tryGet() ?? fallback` (arithmetic). Prefer this over reading `this.input[key].get(ctx)` directly (which returns a `garbage`/`availableLater` sentinel you must guard) and over caching one combined object via `on`. For PID-style logic that needs all inputs **plus `dt`** in lockstep, the combined `on`-cache is still fine: type it `AllInputKeysToObject<(typeof definition)["input"]> | undefined` (from `blockLogic/BlockLogic`), declare it `undefined` (no zero-filled dummy), let `on` populate it, and guard `if (inputValues === undefined) return` at the top of `onTicc`.

## Additional style rules

**Guards over nesting.** Prefer early returns to flatten control flow rather than nested `if` blocks. This is the dominant style throughout the codebase. A guard whose body is nothing but a `return` (or `continue`/`break`) goes on one line without braces — `if (this.suppress) return;` — except in nested cases where the one-liner would hurt readability.

**No single-use methods.** Inline anything with exactly one call site; a handler that exists only to be subscribed goes inline as a lambda at the subscription. Two reasons to keep one named: inlining would hurt readability, which in practice means a body past roughly ten lines; or the method is plausibly useful to a caller outside the class. `private` settles the second — a private method has already declared it has no external use, so inline it. Check the nearest comparable file before deciding.

**Ternary operators** are used often for concise conditionals but should not replace every `if` statement — use judgment based on readability.

**`ObservableValue<T>`** is used extensively throughout the codebase. It stores a value and fires a `changed` signal when it changes. Key API: `.get()`, `.set(value)`, `.changed` (signal). Prefer `ObservableValue` over manual signal+field pairs whenever a value needs to be observed.

**Follow existing block files as the reference.** When adding or modifying a block, copy the structure of an existing block file closely — definition shape, constructor wiring, `elseFunc` guard style, `as const satisfies` pattern. If uncertain about a convention, find the nearest existing example and match it exactly.
