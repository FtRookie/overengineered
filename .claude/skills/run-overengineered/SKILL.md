---
name: run-overengineered
description: Build, run, verify, typecheck, lint, smoke-test or asset-check the overengineered Roblox game, and call its compiled game code headlessly. Use when asked to build, compile, assemble, lint, check, run, verify, or test the project, or to execute a block/utility function outside Studio.
---

A Roblox game in roblox-ts (TypeScript → Luau), synced into Studio via Rojo. The game itself cannot be
launched here — the runtime is Roblox Studio. **Everything short of that can be driven from the console**,
including running the real compiled game modules: lunit ships a Lune shim that stubs the Roblox globals a
compiled module expects, so `out/` code can be loaded and called outside Roblox.

All paths below are relative to the repo root. The driver is
`.claude/skills/run-overengineered/driver.sh`.

## Prerequisites

Already present in this container — no `apt-get` was needed:

```bash
node --version    # v22.23.2
lune --version    # 0.10.5
```

## Run (agent path)

```bash
.claude/skills/run-overengineered/driver.sh verify
```

Typecheck → lint → asset integrity. Exits non-zero on the first failure. Ends with:

```
OK  assets parse, every registered block resolves to a model, block models pass their assertions, and match their declared types
    8 warnings — run with npm run checkassets -- -f to list
```

The 8 warnings are pre-existing (`ChainThick` has no `PrimaryPart` and unanchored parts; `plasmaupgrade` has no
model yet; a couple of cosmetic model complaints). A clean run still exits 0 — compare the count, not the
presence.

**`verify` deliberately does not compile.** It typechecks with `tsc --noEmit` and reuses whatever `out/`
already holds, because `npm run dev` usually owns that tree. See Gotchas.

### Calling the real game code

This is the part with no equivalent in the README. `eval` loads compiled modules from `out/` and runs Luau
against them, outside Roblox:

```bash
.claude/skills/run-overengineered/driver.sh eval '
local Objects = rbx("out/engine/shared/fixes/Objects").Objects
local t = rbx("out/engine/shared/t").t
print("deepCombine  ->", Objects.deepCombine({b={c=2}},{b={c=9}}).b.c)
print("t:typeCheck  ->", t:typeCheck(5, t.number))
'
# deepCombine  -> 9
# t:typeCheck  -> true
```

`rbx(path)` is the module loader; `-f <file>` runs a `.luau` file instead of a snippet. This is the right
handle for most changes here — recent commits touch block logic, validators and utility namespaces, all of
which are callable this way without Studio.

List what is loadable — **425 of 634 compiled modules** at time of writing. This attempts a real load of each
rather than guessing from its imports; the old grep-for-services heuristic listed 391 as loadable when only
about 1 in 40 actually was.

```bash
.claude/skills/run-overengineered/driver.sh modules            # all
.claude/skills/run-overengineered/driver.sh modules fixes      # filtered by substring
.claude/skills/run-overengineered/driver.sh modules --failures # what does not load, grouped by reason
```

The 209 that do not load are mostly client input and GUI modules wanting a live client
(`UserInputService.InputBegan`, `Interface:GetMouse`). Two hard boundaries worth knowing: `shared/Modules`
requires `ReplicatedStorage.Modules.vLuau`, a **place-resident Luau module** rather than compiled TypeScript, so
it and everything importing it (including `SandboxBlocks`) cannot load headlessly; and a module that spin-waits
at module scope would hang the listing, which is why `driver.sh` wraps it in a timeout.

`eval` is also the way to settle Luau semantics questions — truthiness, `string.format`, `math.clamp` argument
order, NaN comparison — instead of reasoning about them.

### Inspecting a block model without Studio

`.rbxm`/`.rbxmx` assets are readable headlessly — `@lune/roblox` sniffs binary vs XML and returns a table of
root instances. `assets` wraps that, resolving a **block id** to its file, because models sit in nested
category folders (`Logic/Communication/Beacon.rbxmx`) and guessing a path is the usual way to waste a minute:

```bash
.claude/skills/run-overengineered/driver.sh assets --find radar     # id -> file
.claude/skills/run-overengineered/driver.sh assets beacon           # dump the tree
.claude/skills/run-overengineered/driver.sh assets emitter --assert # + run the real BlockAssertions
```

The dump annotates only what the assertions read — `PRIMARY`, `anchored`, `massless`, `noCollide`,
`group=`, `FLUIDFORCES`, `shape=`, weld `Part0`/`Part1`, tags — so a failure can be explained from the output.
`--assert` gives the full per-block list, where `driver.sh check` only summarises.

It reads `game/Assets` directly, so it needs no `out/` unless `--assert` is passed. Reading, caching and
prepping live in `tests/_assets.luau`, the same module the asset check uses, so there is no second
implementation to drift. Every caller gets an independent copy of a parsed tree: consumers need the same file
in different states (the assertions want `WeldRegions` stripped, the model validators want it present), and a
clone is 41x cheaper than re-parsing.

### Other subcommands

```bash
.claude/skills/run-overengineered/driver.sh check    # asset integrity only, full warning list
.claude/skills/run-overengineered/driver.sh build    # compile + assemble + lint (refuses if dev sync is up)
```

## Run (human path)

`npm run dev` starts the watchers (rbxtsc, Rojo, place-file asset watcher) and `lune run assemble` produces
`place.rbxl` for Studio. Neither shows anything headless — the game only renders in Studio.

## Gotchas

- **`build` refuses while `npm run dev` is running**, by design. `rbxtsc -w` owns `out/` and `lunewatch.js`
  owns `place.rbxl`; a second compiler writing the same trees corrupts what Studio is syncing. The driver
  checks `pgrep -f 'rbxtsc -w'` and redirects you to `verify`. This is why `verify` exists as a separate path.
- **A module that imports `@rbxts/services` cannot be loaded** — the shim stubs `Enum`, `CFrame`, `Vector3`,
  `Color3`, `Instance`, `task`, `game`, but not the services module. `rbx("out/shared/Physics")` fails for
  exactly this reason. `modules` filters these out already, by grepping the compiled output for
  `"@rbxts", "services"`.
- **Compiled namespaces that use `this` become Luau methods — call them with `:`, not `.`.**
  `t.typeCheck(5, t.number)` silently returns `false` because `5` binds to `self`; `t:typeCheck(5, t.number)`
  returns `true`. A `.` call on a method fails *quietly with a wrong answer*, not with an error.
- **`assetcheck` runs the real `BlockAssertions`**, not a Luau reimplementation — that is the point of the
  lunit shim, and why the check is worth trusting. It needs `out/` compiled and current.
- **The raw `.rbxm` differs from the runtime model.** `assetcheck` unparents `WeldRegions` and `MarkerPoints`
  before asserting, because weld init and `BlockCreation.MarkerPositions` do that at runtime.
- `rbxtsc` is not on `PATH` — it lives at `node_modules/.bin/rbxtsc`. `npm run build` resolves it; calling
  `rbxtsc` directly fails.
- `lune run assemble` reads `out/`, not `src/`. On a stale `out/` it silently bakes old code.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `module not found: node_modules/roblox-ts/include/node_modules/@rbxts/services` | That module imports Roblox services and cannot load headlessly. Pick one from `driver.sh modules`. |
| `module not found: out` from lunit's own runner | Its `lunit-root` argument defaults to `out`, meaning *lunit's* build. Pass `node_modules/@rbxts/lunit/out`. |
| `test class "table: 0x…" is not a class` | The repo's `*.test.ts` files are namespace-style (`export namespace Tests.X`), not lunit `@Test` classes. lunit is used here as a runtime shim, not as the test runner. |
| A `t.` check returns `false` for a value that should pass | You called a method with `.` instead of `:`. |
| `verify` reports type errors but the IDE looks clean | `tsc --noEmit` covers all of `src/`; the driver greps for `^src/` to drop the ~8 pre-existing `node_modules` errors from `@rbxts/types` and `@rbxts/net`. |

## Verified

`verify`, `check`, `modules`, `eval` (both forms), the `build` guard and the usage path were all run in this
container. `build`'s success path was not — the dev watcher was live throughout and the guard correctly
refused, which is the behaviour documented above.
