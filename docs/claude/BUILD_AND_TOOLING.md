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

### Step 6, and the 22 definitions it cannot read

Steps 1–5 only ever hand `BlockAssertions` a model, so the definition-only assertions never fired.
`checkDefinitionOrder`, `checkNoSameNamesInLogicDefinition` and `checkLowercaseAlias` need no model, so step 6
runs them per block id — which also reaches the prefab-stamped blocks that own no model file and were therefore
invisible to step 4.

**The block builders cannot be loaded outside Roblox.** Block files (`AESARadar`, `RadarWarningReceiver`,
`RadarSectionBlock`) transitively import `SharedPlots`, whose *module scope* spin-waits on the place's `Plots`
folder reaching its `count` attribute. Under any faked DataModel that loop never exits, so `npm run check` would
hang rather than fail — the reason step 6 is fed generated data instead of live objects. `genBlockValidators`
lifts the key sets and string arrays out of the TypeScript AST into
`tests/generated/BlockDefinitions.generated.json`, and step 6 feeds them to the real assertions, so the *rules*
still live in exactly one place.

A definition is only read when it can be read exactly. **Referring to a variable is fine** — the ordinary
`const definition = { … }` / `logic: { definition }` pattern resolves through identifiers, imports and
`as const satisfies`, which is why the large majority of blocks are covered. A definition is refused when:

| Refused when | Why |
|---|---|
| `logic.definition` is a call, e.g. `Objects.deepCombine(base, { … })` | composed at runtime; no literal to read |
| `input` or `output` contains a spread | the real key set is wider than the literal |
| the object's variable is ever an assignment target (`outputs[k] = …`) | initializer looks complete but the keys are assembled by a loop |

That last rule is why the count matters: `bigdemultiplexer` declares `const demuxBigOutputs = {}` and fills it
in a loop, so following the initializer yields an empty key set and reports a perfectly valid `outputOrder` as
invalid. **Refusing beats guessing** — a wrong key set fails a correct block.

Refused definitions are never silently dropped: the count prints on every run
(`N definitions not statically readable, not checked`) and each one is listed with its reason in the `skipped`
array of the generated JSON. If you need one covered, the fix is on the block's side — give the definition a
literal `input`/`output` — not on the generator's.

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
