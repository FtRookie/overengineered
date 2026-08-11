# Build & Tooling

Headless checks, Studio tests, running compiled game code from the console, and the Rojo mapping.

> Extracted from `CLAUDE.md`, which keeps the tripwires and routes here for detail.

## Checks that run without Studio

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

## Tests in Studio

Tests (files named `*.test.ts`) execute inside Roblox Studio via `TestFramework`, which walks `ReplicatedStorage` and the script services for `*.test` ModuleScripts. Existing tests are namespace-style — `export namespace Tests.XTests { export function name() { … } }` using `Assert` from `engine/shared/Assert`. Block-specific tests use `BlockTesting` and `BlockTestRunner` from `src/shared/blocks/testing/`.

Anything touching Roblox services or instances is Studio-only: lunit's Lune shim resolves the game's own modules but not `@rbxts/services`, so a test importing `Workspace` or creating instances cannot run headlessly.

## Running compiled game code from the console

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

## Rojo / Project Structure

`default.project.json` maps `out/` subdirectories to Roblox services. All `$path` entries point to `out/`, not `src/`. File type mappings:

| File | Roblox instance |
|---|---|
| `*.lua` / `*.luau` | `ModuleScript` |
| `*.server.lua` | `Script` |
| `*.client.lua` | `LocalScript` |
| `init.lua` in a folder | folder becomes `ModuleScript` |

`lune run assemble` must be run once to generate `place.rbxl` before opening Studio. During development, `npm run dev` keeps the TypeScript compiler and Rojo server running together.
