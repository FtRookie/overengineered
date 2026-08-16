# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

It is an index and a routing table, not a manual. It carries three things: rules that apply to every task,
tripwires whose cost is high and whose trigger is easy to miss, and a map of where the real detail lives.
**Read the routed file before working on that subsystem** — the detail there is stronger read at the moment it
applies than remembered from the top of a session.

## Editing consent

- **Changes with no runtime effect need no sign-off.** An edit that cannot change behaviour (renaming, grouping constants into an object, comment or formatting changes) is fine to make unprompted, as long as it benefits the code and does not destroy readability.
- **Behaviour-changing and major edits need consent.** Ask before acting, and wait for the answer.
- **Inform rather than ask when the edit is small and the risk is low.** A one-line change that only *might* alter behaviour is not worth stopping for — make it, then say plainly what changed and why in the same turn.

## Git workflow

The loop is: the user proposes a change, you make it, the user reviews it, and only then does anything land.

- **Never create a branch.** Work on `main`.
- **Do not commit until asked.** Making the edit is where your turn ends — leave the change in the working tree and say what you changed. The user reads the diff or the file before it becomes a commit.
- **Commit and push only on an explicit go-ahead**, and push to `main`. A go-ahead covers the change in front of you, not the next one.

## Verify, don't infer

The always-rule under everything else: when a claim is load-bearing, confirm it against the source of truth
before acting on it — never from inference, however obvious the deduction reads. This is not scoped to engine
behaviour; it applies to syntax, semantics, conventions, method usage, patterns and the reasons you write into
comments alike. A plausible inference is not a citation.

- **Behaviour and Luau semantics — run it, don't reason about it.** `npm run check` and the `/run-overengineered` skill execute the **real** compiled modules headlessly — no Studio, no place file. Utility namespaces, validators, serializers and the pure parts of block logic are directly callable. `driver.sh eval` is the fastest way to settle a throwaway semantics question (truthiness, `string.format`, `math.clamp` argument order, NaN comparison); for a Luau semantics point or engine quirk a guard depends on — the kind you want proven and reproducible, not asserted — generate a lunit unit test in the `tests/` harness and run it (`nil == nil` being true, so a `~= nil` guard is load-bearing, is exactly this shape). Anything importing `@rbxts/services` cannot load this way.
- **Engine/API behaviour — against the docs.** When a claim about a Roblox API is load-bearing (a signal's firing conditions, a method's edge cases, a property's side effects), fetch the relevant Creator Docs page and confirm it, even when a logical deduction seems obviously correct. When the docs are silent — many pages carry a type signature and no description (`InputObject.Position`, `GuiButton.MouseButton1Click`, `GuiObject.Active`), and the roblox-ts typings are undocumented interfaces — use WebSearch next, then `driver.sh eval` for anything pure or a Studio log for anything that needs the engine. Say which the answer rests on; never present a deduction as though it were documented.
- **A convention, a pattern, or a method's usage — grep the codebase.** Find how it is actually used and follow the nearest existing example; read the signature or implementation rather than guessing the shape of it.
- **A reason you are about to write into a comment — confirm it first.** A tidy explanation that inspection disproves (a "prefab yawed 90°" that the prefab's geometry contradicts) is worse than no comment: it manufactures certainty and sends the next reader the wrong way. When the reason cannot be verified, flag it (`// fixme:`), do not fabricate one.

**External reference:** the docs are published at https://create.roblox.com/docs, but that host is unreachable
from some sandboxes. The same content is generated from https://github.com/Roblox/creator-docs, whose raw files
fetch reliably and carry the identical prose — prefer them, and fall back to WebSearch only when neither host
answers. One page per API, at a predictable path, so no search is needed to find one:

```
https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/classes/BasePart.yaml
                                                                                          .../datatypes/Vector3.yaml
                                                                                          .../enums/Material.yaml
                                                                                          .../globals/RobloxGlobals.yaml
```

A class file keys members under `properties`, `methods`, `events` and `callbacks`; a datatype adds `constructors`,
`constants` and `math_operations`. Each carries `summary` and `description`, which is the text the website renders.

## Tripwires

Each of these is silent, expensive, and catches nobody's eye until much later. Nothing in the toolchain stops
them for you.

- **A block `id` is save data.** Renaming one breaks existing saves — including renaming a key in `BuildingBlocks.ts`, where the key *is* the id.
- **An unreachable save backend blocks loads AND automatic writes.** A stale read plus a fresh write stamps the OLD build as newest and the flusher then destroys the real one. Never route around it; manual save is the one exception and goes to the outbox behind a multi-stage confirmation.
- **`0` and `""` are truthy in Luau.** Only `false` and `nil`/`undefined` are falsy, and the `lua-truthiness` ESLint rule that would catch this is disabled in this project.
- **Comparing a `LuaTuple` without destructuring is a dead branch.** It compiles to a fresh table compared to nil — constant `false`, no crash, and the lint rule does not report comparisons.
- **A function returning `LuaTuple<T> | undefined` has dead guards.** Assigning the result packs it, so `undefined` arrives as an empty table.
- **A compiled namespace method needs `:`, not `.`.** `t.typeCheck(5, t.number)` returns `false` because `5` binds to `self` — a wrong answer rather than an error.
- **Never name a variable after a Luau global** (`pairs`, `select`, `table`, `time`, `Enum`, `game`, …). TypeScript does not know they exist; `type` fails only once `rbxtsc` emits.
- **The hoist at the top of a `.propmacro.ts` is not dead code.** Removing, reordering, or writing above it breaks how the transformer emits the module.
- **`t.any.as<T>()` validates nothing.** Neither does `.as<>()` on any other checker — it is a compile-time cast with no runtime effect.
- **A check that reimplements production logic still passes** once the two drift. Load the real module instead; `tests/assetcheck.luau` is the pattern.
- **`WRITETOKEN` in `.env` is a live write path to production**, and a Studio session autosaves and snapshots on exit — it writes with nobody pressing Save.

## Writing code here

Detail and the per-construct conventions: [CODE_STYLE.md](docs/claude/CODE_STYLE.md).

- **Write only TypeScript** — never `.lua`/`.luau` directly.
- **Search before writing a helper.** The utility layer is deep and most "small helpers" already exist under a name you would not guess. Check [UTILITY_APIS.md](docs/claude/UTILITY_APIS.md) first. A duplicated helper is worse than a missing one.
- **Minimize comments — default to none.** Write only what the code cannot say: where a magic constant came from, an ordering that looks arbitrary but is not, an engine quirk that would read as a mistake. Never narrate what the code does, and never announce a fix.
- **Avoid metaphors** in comments and explanations — describe the mechanism literally.
- **Guards over nesting.** Early returns; a guard whose body is only `return`/`continue`/`break` goes on one line without braces.
- **Follow the nearest existing file.** When in doubt about a convention, find the closest comparable example and match it exactly.

Formatting and import order are Prettier- and ESLint-enforced; run `npx eslint src` rather than memorising them.

## The map

Triggers are deliberately wide. Reading a file you turned out not to need costs a moment; missing one of these
costs a silent bug, so err toward opening it.

| Read this | Before |
|---|---|
| [BLOCKS.md](docs/claude/BLOCKS.md) | **any block work at all** — adding, changing or reading a block, its logic, model, id, inputs, outputs or config. Registration, `GARBAGE`/`AVAILABLELATER`, the input-subscription decision tree, `getDebugInfo` |
| [COMPONENTS.md](docs/claude/COMPONENTS.md) | **anything extending `Component` or `HostedService`** — lifecycle, parenting, DI scope, subscriptions, teardown, and any `task.spawn` or long-running loop |
| [REMOTES.md](docs/claude/REMOTES.md) | **anything crossing a machine boundary** — client→server, server→client, client→client, or any state that has to reach another player. Remote classes, `BlockSynchronizer`, middleware, validator tightness |
| [DEPENDENCY_INJECTION.md](docs/claude/DEPENDENCY_INJECTION.md) | **any constructor parameter you did not pass by hand** — `@injectable`/`@inject`/`@tryInject`, `$onInjectAuto`, `resolve`, registering a service. Implementation is `src/engine/shared/di/`; read it directly when the doc does not settle it |
| [SAVE_DATA.md](docs/claude/SAVE_DATA.md) | **anything persisted or loaded** — slot blocks, player settings, serializers, schema or version changes, db/DataStore routing, the `.env`/`.studioconfig.json` keys |
| [UTILITY_APIS.md](docs/claude/UTILITY_APIS.md) | **before writing any function or type helper at all.** The first place to look — most already exist, often under a name you would not guess. The propmacro index and every shared namespace |
| [LUAU_GOTCHAS.md](docs/claude/LUAU_GOTCHAS.md) | **any TypeScript you write in this repo** — the full form of the Luau tripwires above, plus iteration patterns, compiler macros and `RunService` signal names |
| [PERFORMANCE.md](docs/claude/PERFORMANCE.md) | **anything that is not one-shot code** — per-tick, per-frame, loops, or work that repeats at all. Allocation, closure capture, instance-property cost, change-gated rendering |
| [GUI_AND_INPUT.md](docs/claude/GUI_AND_INPUT.md) | **any GUI or input work at all** — keybinds, touch buttons, settings rows, block config controls, and what to leave alone unless the pattern is already established |
| [BUILD_AND_TOOLING.md](docs/claude/BUILD_AND_TOOLING.md) | **before running or verifying anything**, and whenever a question about behaviour could be settled by executing it instead of reasoning about it. Checks, Studio tests, headless game code, the Rojo mapping |
| [CODE_STYLE.md](docs/claude/CODE_STYLE.md) | **any code you write** — the per-construct conventions and the reasoning behind the rules above |

Per-system notes also live in `docs/` — `GRAPHING_TOOL.md`, `BLOCK_1XN_DEPRECATION.md`, `MATERIALS.md`,
`KEYBINDING.md`, `TERRAIN_OPTIMIZATION.md` and others. They are documentation only; nothing there is read by the
build. Read the relevant one before working on that system.

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

`rbxtsc -w` owns `out/` while `npm run dev` is up — never start a second compiler against it.

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
