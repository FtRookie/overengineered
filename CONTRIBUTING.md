# Contributing

We appreciate your interest in contributing. This document provides guidelines for contributing to the project.

## Prerequisites

Four things, installed once. They are separate programs — get all four before starting.

| | what it is |
| --- | --- |
| [**Git**](https://git-scm.com/downloads) | downloads the code and tracks your changes |
| [**Node.js 20 or newer**](https://nodejs.org/) | runs the compiler and the project's commands |
| [**Rokit**](https://github.com/rojo-rbx/rokit) | fetches the two Roblox tools this project pins, at the right versions |
| [**Roblox Studio**](https://create.roblox.com/) | where the game runs |

There are **two different things called Rojo** and you need both. The Rojo *command* is installed by Rokit in
step 2 below and runs on your machine. The Rojo *Studio plugin* is installed into Studio itself and is what
receives the synced code — that one is step 6.

<details>
<summary><strong>Installing Rokit</strong></summary>

**Linux / macOS**

```bash
curl -sSf https://raw.githubusercontent.com/rojo-rbx/rokit/main/scripts/install.sh | bash
```

**Windows** — PowerShell, run as Administrator

```powershell
Invoke-RestMethod https://raw.githubusercontent.com/rojo-rbx/rokit/main/scripts/install.ps1 | Invoke-Expression
```

Close the terminal and open a new one afterwards, then check it worked: `rokit --version`.

</details>

## Installation

Steps 1 to 5 are commands. Run them in order, from a terminal — the order matters, because `assemble` bundles
whatever `build` produced.

```bash
git clone https://github.com/FtRookie/overengineered.git
cd overengineered

npm install          # 1. project dependencies
rokit install        # 2. lune and rojo, at the versions this project pins
npm run build        # 3. compile TypeScript into out/
lune run assemble    # 4. bundle out/ and the game assets into place.rbxl
npm run dev          # 5. leave this running while you work
```

### 6. Install the Rojo Studio plugin

Only needed once per machine. The easiest way is from VS Code, if you have the
[Rojo extension](https://marketplace.visualstudio.com/items?itemName=evaera.vscode-rojo) installed:

1. Open the command palette — **Ctrl+Shift+P**, or **Cmd+Shift+P** on macOS. A box appears at the top of the
   window with a `>` already in it.
2. Type **`Rojo: Open Menu`** and press Enter.
3. Click **Install Plugin**.

Studio picks it up the next time it starts.

Not using VS Code? Either of these works just as well:

- Install it from the [Creator Store](https://create.roblox.com/store/asset/13916111004/Rojo) — click **Install**
  and it appears in Studio.
- Or open Studio, go to the **Toolbox**, switch to **Plugins**, and search for **Rojo**.

### 7. Connect Studio

Open **`place.rbxl`** in Roblox Studio, then click **Plugins → Rojo → Connect**.

That's it. Edit code in your editor and it appears in Studio as you save.

<details>
<summary><strong>If a command fails</strong></summary>

**`rokit: command not found`** — Rokit is installed but your terminal hasn't picked it up. Open a new
terminal. If it still fails, Rokit did not install; try again.

**`The following tool has not been marked as trusted`** — Rokit asks permission before downloading a tool the
first time. Answer yes to the prompt. If there is no prompt, approve them by hand and retry:

```bash
rokit trust lune-org/lune
rokit trust rojo-rbx/rojo
rokit install
```

**`lune: command not found`** after step 2 — step 2 did not finish. Step 4 needs `lune`, so fix this before
going on. Run `rokit list` to see what Rokit found, then `rokit install` again.

**Studio shows nothing after connecting** — check `npm run dev` is still running in its terminal. It has to
stay open the whole time you are working.

</details>

> **Note:** While `npm run dev` is running, saving assets inside the place automatically organises models into
> their respective folders.

## CLI

| command | what it does |
| --- | --- |
| `npm i` | install node dependencies |
| `npm run dev` | everything at once: compiler watch, Rojo server, and the place asset watcher |
| `npm run devopen` | same as `dev`, but opens `place.rbxl` in Studio first |
| `npm run build` | compile TypeScript to `out/` once |
| `npm run watch` | compiler only, in watch mode |
| `npm run rojo` | Rojo server only |
| `node ./scripts/lunewatch.js` | place file asset watcher only |
| `npm run publish` | **maintainers only — publishes to production.** Runs `checkassets`, then uploads `place.rbxl` via Roblox Open Cloud (needs `PUBLISH_KEY`). Refuses if the checks fail, if there is no key, or if `place.rbxl` is older than `out/` |
| `npm run dbrelay` | local database relay — only needed if Studio cannot reach the backend |
| `npm run check` | all headless checks (`checkassets` + `checklogs`) |
| `npm run checkassets` | every model parses, and every registered block resolves to a model |
| `npm run checklogs` | every update log entry has a date `DateTime.fromIsoDate` can parse |
| `lune run assemble` | build `place.rbxl` from `out/` plus the assets in `game/` |
| `lune run savechanges` | save changed assets from `place.rbxl`; not needed while the asset watcher is running |
| `lune list` | list the available lune scripts |

Linting and formatting are ESLint + Prettier: `npx eslint src`.

## Project Layout

```
src/
  engine/          framework layer — components, DI, events, utilities. Not game-specific
  shared/          game logic shared between client and server
    blockLogic/    the block logic runtime
    blocks/        every block definition and implementation
  client/          GUI, rendering, input
  server/          database, anti-exploit, player data
game/              Studio assets (.rbxmx / .rbxm) that `lune run assemble` pulls into the place
lune/              place assembly and tooling scripts
tests/             headless checks that run under lune, outside Studio
docs/              reference notes and README screenshots
```

Tests come in two kinds. Anything needing the engine — physics, the tick loop, block logic — is a file named `*.test.ts` and runs **inside Roblox Studio** via `TestFramework`, with block-specific tests using `BlockTesting` and `BlockTestRunner` from `src/shared/blocks/testing/`. Anything that can be checked without the engine lives in `tests/` and runs headlessly under lune, so it works in CI. `npm run check` runs them all: `checkassets` parses every model asset and verifies that each block which is not built from a prefab resolves to a model of its own, and `checklogs` verifies every update log entry has a date `DateTime.fromIsoDate` can parse — the update log GUI asserts non-null on that call, so a malformed date takes the whole GUI down at runtime.

## Configuration (`.env`)

Everything machine-specific lives in **`.env`** at the repo root. Copy the template and fill in only what you need:

```bash
cp .env.example .env
```

**An empty `.env` is a working `.env`.** Every key is optional, and the defaults are the safe ones: the game runs read-only against the production database, which is what you want almost all of the time.

The two keys carrying credentials — `PUBLISH_KEY` and `WRITETOKEN` — are **maintainers only**. Contributors never need either, and neither is required to build, run or test anything.

| key | read by | what it does |
| --- | --- | --- |
| `PUBLISH_KEY` | `npm run publish` | **maintainers only.** Roblox Open Cloud API key. Nothing else touches it |
| `WRITETOKEN` | the game, in Studio | **maintainers only — ⚠️ live write path to production**, see below. Empty = read-only |
| `DB_BASEURL` | the game, in Studio | where Studio looks for the database. Empty = production |
| `RELAY_PROXY` | `npm run dbrelay` | proxy for the relay to tunnel through. Empty = go direct |
| `RELAY_TARGET`<br>`RELAY_PORT` | `npm run dbrelay` | upstream and local port. The defaults are almost always right |

`.env` is gitignored and **never commit it**. `npm install` and `npm run dev` generate `.studioconfig.json` from it — that is the file Rojo actually syncs into Studio, since Roblox cannot read `.env` itself. It is generated, not edited, and gitignored too.

## Saves and the external database

Player builds live in an **external database**, not in the Roblox DataStore. The DataStore is now only an outbox (for when the backend is unreachable) and a fallback for old saves. This matters for local development, because **loading a slot in Studio hits the real backend over HTTP**.

**Most people need to change nothing.** Loads work out of the box; saves stay in the DataStore and never leave your session. `npm run dev` tells you which mode you are in:

```
[main] DB is read-only (no WRITETOKEN in .env)
```

and so does the server on startup:

```
[db] base url ...: https://www.ftrookie.com/overengineered
[db] writes .....: off (read-only)
[db] http enabled: true
```

Every request is then traced, so a bad URL, a slow link and a dead backend stop looking alike:

```
[db] GET https://www.ftrookie.com/overengineered/save/123/4/0
     -> HTTP 200, 237758 bytes (572ms)
```

<details>
<summary><strong>⚠️ WRITETOKEN is a live write path to production</strong></summary>

There is no staging database. `WRITETOKEN` in your `.env` means your Studio session writes to the **real** one.

And it is not only the Save button: a Studio session **autosaves every 5 minutes** and snapshots your plot when you leave. So a token sitting in `.env` will overwrite your real slots without you ever pressing anything. **Leave `WRITETOKEN` empty unless you are specifically testing writes, and clear it when you are done.**

You get told twice. Once by the watcher:

```
[main] DB WRITES ARE LIVE: WRITETOKEN is set in .env, so this session saves to PRODUCTION
```

and once by the server:

```
[ExternalDatabase] WRITES ARE LIVE: this Studio session will save into https://www.ftrookie.com/overengineered
```

**A token also ends up inside anything `rojo build` produces.** The normal publish path is safe — `npm run publish` uploads `place.rbxl`, which `lune run assemble` builds, and that ignores JSON entirely — but a place you hand-built with `rojo build` carries your token in it. Don't publish one.

</details>

<details>
<summary><strong>If loads fail or time out (HttpError: NetFail / Timedout)</strong></summary>

Studio makes its HTTP requests straight from your machine and **cannot be given a proxy**. On some connections the path to the backend is throttled: small responses arrive, anything past a few kilobytes crawls to a few hundred bytes per second and then dies. Nothing in the game code can fix that — the data simply does not arrive.

If you already have a working proxy, relay through it. Put it in `.env`:

```bash
RELAY_PROXY=http://127.0.0.1:8118   # your proxy. Empty = go direct
```

run the relay, and leave it running while you work:

```bash
npm run dbrelay
```

then point Studio at it — also in `.env` — and restart `npm run dev`:

```bash
DB_BASEURL=http://localhost:1367/overengineered
```

Studio now talks plain HTTP to localhost, so there is nothing left in the middle to strangle. The relay reads the **real** database — it stores nothing itself, and killing it puts you straight back on production.

**The relay has two ends, and the settings belong to opposite ones.** `RELAY_PORT` is not a port on `ftrookie.com`; nothing here ever produces an address like `https://ftrookie.com:1367`.

```
           the game talks to THIS end                   the relay talks out THIS end
                       │                                             │
                       ▼                                             ▼
    Studio ──► http://localhost:1367/overengineered ──► [proxy] ──► https://ftrookie.com  (:443)
                       ▲            ▲          ▲                     ▲
                  (localhost)  RELAY_PORT   the path            RELAY_TARGET
                                            the game asks for,
                                            forwarded as-is
```

| key | which end | notes |
| --- | --- | --- |
| `RELAY_PORT` | yours | where the relay **listens**. Nothing to do with the upstream |
| `RELAY_TARGET` | upstream | where the relay **connects out** to. Its scheme decides the port (`https` → 443). Origin only — no path |
| `DB_BASEURL` | yours | what you point Studio at. The one URL that carries host, port and base path together, because the game requests it like any other URL |

Change `RELAY_PORT` and you must change `DB_BASEURL` to match, or Studio dials a port nobody is listening on.

</details>

## Using AI

**Agents are allowed here, and encouraged.** If you are new to the codebase one can genuinely speed you up —
there is an established pattern for nearly everything, and agents are good at finding and following it. Large
PRs usually get an agent pass before a human reads them anyway.

They are not a substitute for understanding, though. Test what you submit, and read what the agent wrote
closely enough to learn from it. You are the author of your pull request, and "the model wrote it" is not an
answer to a review comment.

**Start with [CLAUDE.md](CLAUDE.md).** Claude Code loads it automatically, and it is worth pasting into any
other agent. It is not only for agents, either — it is one of the quickest ways to learn how this codebase
fits together, because it collects the conventions and the tripwires: mistakes that cost hours because nothing
in the toolchain catches them.

**Run it, don't reason about it.** This separates AI code that survives review from AI code that doesn't.
`npm run check` and the harness in `tests/` exercise compiled game code without a running game, so a question
about how something behaves is usually one short script away from an answer. A model asserting that a function
returns `false` is worth nothing next to three lines proving it.

**Watch for confident, plausible and wrong.** Models are fluent about APIs they only half-remember, and will
invent a tidy reason for anything. If something doesn't sound right, it probably isn't right.

**Push back on what the model asserts.** Ask it for citations, and for how it reached the conclusion. Evidence
you have read yourself is worth more than an agent's word for it. Two habits catch most of what slips through:

- Check engine claims against the [Creator Docs source](https://github.com/Roblox/creator-docs) instead of
  taking the model's word. CLAUDE.md gives the URL pattern for looking up any single API.
- Never let a comment explain *why* unless the why was verified. An unverified rationale is confidently
  misleading, which does more damage than leaving the question unanswered.

**Know what is expensive to get wrong.** A handful of mistakes here are silent — they compile, they pass lint,
and they surface much later as a broken save or a branch that never runs. A model writes them without
hesitation, because nothing about them looks wrong on the page. CLAUDE.md keeps a short list of exactly these;
read it before your first PR rather than after.

**Keep the diff reviewable.** An agent will restructure five files when you asked about one. If you can't
explain every hunk in your own words, it isn't ready, and neither is the PR.

## Pull Request Process

1. Implement your changes and test them.
2. Run `npm run build` and `npm run check` — they must both pass, and `npx eslint src` must be clean.
3. Commit your changes with clear, descriptive messages.
4. Push your changes and create a Pull Request.
5. Await review.

## What PRs will never be accepted

- Systems for transferring/sharing slots
- "Unrealistic" or game-breaking changes, such as switchable anchors
- Trivial changes to comments

Note: There is a distinction between our proprietary database version and the public GitHub version. Slot limitations differ significantly; our database accommodates up to 16 megabytes of data, while Roblox's conventional method is restricted to 4 megabytes. This disparity influences capacity and may pose current challenges.

## Contributor Licensing

By opening a pull request you choose how your contribution is licensed. Say which option you want in the pull
request description. **If you say nothing, Option B applies.**

**Option A — keep it open.**
Your contribution is licensed under the Apache License 2.0, the same terms as the upstream project. Anyone may
use it, including other forks of OverEngineered.

**Option B — project licensed (default).**
Your contribution is licensed to this project under the terms in [LICENSE](LICENSE), and the maintainer decides
whether and how it may be used elsewhere.

Under either option you keep the copyright to what you wrote. You also confirm that you wrote it, that you are
entitled to submit it, and that no employer, client or other party has a claim on it.

**What Option B does not do.** This project is a fork of an Apache 2.0 work. Option B covers the new material in
your contribution and nothing else — the upstream code your patch sits alongside remains under Apache 2.0 for
everyone. Choosing Option B does not withdraw that grant, and any fork may still take the upstream base.

## Reporting Issues

Utilize GitHub Issues to report bugs or suggest features.

## Code of Conduct

Maintain respectful and constructive communication.

