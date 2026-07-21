<h1 align="center">Underengineered 🚀</h1>

<p align="center">
  <a href="https://www.roblox.com/games/86822363308738/Underengineered">
    <img src="https://img.shields.io/badge/Roblox-play-blue?style=flat-square&logo=roblox" alt="Play on Roblox" />
  </a>
  <a href="https://github.com/FtRookie/overengineered/stargazers">
    <img src="https://img.shields.io/github/stars/FtRookie/overengineered?style=flat-square" alt="GitHub Stars" />
  </a>
  <a href="https://github.com/FtRookie/overengineered/network/members">
    <img src="https://img.shields.io/github/forks/FtRookie/overengineered?style=flat-square" alt="GitHub Forks" />
  </a>
  <a href="https://discord.gg/ys6nKtuwWY">
    <img src="https://img.shields.io/badge/Discord-Underengineered-blue?style=flat-square&logo=discord" alt="Join the Underengineered Discord server" />
  </a>
  <a href="https://discord.gg/raax9xUMDc">
    <img src="https://img.shields.io/discord/1053774759244083280?color=blue&label=OverEngineered&logo=discord&style=flat-square" alt="Join the original OverEngineered Discord server" />
  </a>
  <a href="https://github.com/FtRookie/overengineered/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/FtRookie/overengineered/build.yml?style=flat-square" alt="Build Status" />
  </a>
</p>

<p align="center">
  <strong>Roblox sandbox physics game with logic and destruction</strong>
</p>

A sandbox physics game on Roblox centered around constructing mechanical and logical machines. From planes to cars to wild hybrids, from mini-processors to guided missiles — build anything you want, then test it in a dynamic and destructible world.

---

## ✨ Key Features

- 🛠️ **Destruction Physics**: Experience realistic crashes and chaotic destruction.
- 🧩 **Block-Based Building**: Craft vehicles with a flexible, customizable system.
- ⚙️ **Advanced Components**: Use thrusters, motors, hinges, and more to bring your creations to life.
- 🧠 **Powerful Logic**: Wire up logic blocks to make your creations do whatever you want, or even write your own Lua code!
- 💻 **Powered by roblox-ts**: Built with a modified [roblox-ts](https://roblox-ts.com) for a first-class TypeScript development experience.

---

## 📌 Important Information

| Icon | Details |
| :--: | --- |
| 🛡️ | **Safety Disclaimer**<br>Underengineered is a virtual sandbox for creative experimentation. All in-game actions are fictional and should **never** be attempted in real life. Please play responsibly! |
| 💾 | **Automatic Saves**<br>Your progress is protected by an automatic save system every 5 minutes, so your creations remain as safe as possible even during disruptions. |

---

## 🚀 Getting Started: Development Setup

Get up and running with the Underengineered development environment in a few steps.

### Prerequisites

- [**Git**](https://git-scm.com/downloads)
- [**Node.js 20 or newer**](https://nodejs.org/)

### Installation

1. **Clone the Repository**

    ```bash
    git clone https://github.com/FtRookie/overengineered.git
    cd overengineered
    ```

2. **Install Dependencies**

    ```bash
    npm install
    ```

3. **Install Rokit**
    [Rokit](https://github.com/rojo-rbx/rokit) is required for asset and place management. Choose one of the methods below.

    <details>
    <summary><strong>Recommended (No Rust Required)</strong></summary>

    - **Linux / macOS:**

        ```bash
        curl -sSf https://raw.githubusercontent.com/rojo-rbx/rokit/main/scripts/install.sh | bash
        ```

    - **Windows (PowerShell as ADMIN):**

        ```powershell
        Invoke-RestMethod https://raw.githubusercontent.com/rojo-rbx/rokit/main/scripts/install.ps1 | Invoke-Expression
        ```

    </details>

    <details>
    <summary><strong>Alternative (Requires Rust/Cargo)</strong></summary>

    - First, install [Rust & Cargo](https://www.rust-lang.org/tools/install).
    - Then, install Rokit:

        ```bash
        cargo install rokit
        ```

    </details>

4. **Assemble the Place File**
    Before opening Studio, you must generate the `place.rbxl` file:

    ```bash
    lune run assemble
    ```

5. **Start the Development Server**
    This command launches all necessary services, including the TypeScript compiler and Rojo server.

    ```bash
    npm run dev
    ```

6. **Connect Rojo in Roblox Studio**
    - Open the generated `place.rbxl` file in Roblox Studio.
    - Navigate to **Plugins → Rojo → Connect**.
    - Your local code will now sync automatically with the Studio environment.

You're all set! Make changes in your code editor and watch them appear live in Studio.

> **Note:** When the development server is running, saving assets inside the place will automatically organize all models into their respective folders.

### Scripts

| command | what it does |
| --- | --- |
| `npm run dev` | everything at once: compiler watch, Rojo server, and the place asset watcher |
| `npm run devopen` | same as `dev`, but opens `place.rbxl` in Studio first |
| `npm run build` | compile TypeScript to `out/` once |
| `npm run watch` | compiler only, in watch mode |
| `npm run rojo` | Rojo server only |
| `npm run publish` | **publishes to production.** Runs `checkassets`, then uploads `place.rbxl` via Roblox Open Cloud (needs `PUBLISH_KEY`). Refuses if the checks fail, if there is no key, or if `place.rbxl` is older than `out/` |
| `npm run dbrelay` | local database relay — only needed if Studio cannot reach the backend |
| `npm run check` | all headless checks (`checkassets` + `checklogs`) |
| `npm run checkassets` | every model parses, and every registered block resolves to a model |
| `npm run checklogs` | every update log entry has a date `DateTime.fromIsoDate` can parse |
| `lune run assemble` | build `place.rbxl` from `out/` plus the assets in `game/` |
| `lune list` | list the available lune scripts |

Linting and formatting are ESLint + Prettier: `npx eslint src`.

### Project Layout

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

### Configuration (`.env`)

Everything machine-specific lives in **`.env`** at the repo root. Copy the template and fill in only what you need:

```bash
cp .env.example .env
```

**An empty `.env` is a working `.env`.** Every key is optional, and the defaults are the safe ones: the game runs read-only against the production database, which is what you want almost all of the time.

| key | read by | what it does |
| --- | --- | --- |
| `PUBLISH_KEY` | `npm run publish` | Roblox Open Cloud API key. Nothing else touches it |
| `WRITETOKEN` | the game, in Studio | **⚠️ live write path to production** — see below. Empty = read-only |
| `DB_BASEURL` | the game, in Studio | where Studio looks for the database. Empty = production |
| `RELAY_PROXY` | `npm run dbrelay` | proxy for the relay to tunnel through. Empty = go direct |
| `RELAY_TARGET`<br>`RELAY_PORT` | `npm run dbrelay` | upstream and local port. The defaults are almost always right |

`.env` is gitignored and **never commit it**. `npm install` and `npm run dev` generate `.studioconfig.json` from it — that is the file Rojo actually syncs into Studio, since Roblox cannot read `.env` itself. It is generated, not edited, and gitignored too.

### Saves and the external database

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

---

## 🤝 Contributing

We welcome community contributions! Feel free to open an issue or submit a pull request.

> **New here?** Read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and how your contribution is licensed, then pick up an [open issue](https://github.com/FtRookie/overengineered/issues) or hop in the [Discord](https://discord.gg/ys6nKtuwWY) to say what you're working on.

<p align="center">
  <img src="https://contrib.rocks/image?repo=FtRookie/overengineered" alt="Contributors" />
</p>

---

## 📊 Project Stats

<p align="center">
  <a href="https://www.star-history.com/?type=date&repos=FtRookie%2Foverengineered">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=FtRookie/overengineered&type=date&theme=dark&legend=top-left&sealed_token=fSxZ5qFvQ7g31NwN_RogegClv6txYdwn0bga37ghNx8t1S5fLOc3ic8_bEfKNHeSF8K3YgplM3YLaMZ9cYm-X1ca3HutgsRlDrTztbJViLAjJzExXtjgbBT23_kunf9GgOscL39wvTZeSSvMGt2f8aN8LyDOtwHGBpDKKoaaSTm9JHhybk2lTVgCg72Z" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=FtRookie/overengineered&type=date&legend=top-left&sealed_token=fSxZ5qFvQ7g31NwN_RogegClv6txYdwn0bga37ghNx8t1S5fLOc3ic8_bEfKNHeSF8K3YgplM3YLaMZ9cYm-X1ca3HutgsRlDrTztbJViLAjJzExXtjgbBT23_kunf9GgOscL39wvTZeSSvMGt2f8aN8LyDOtwHGBpDKKoaaSTm9JHhybk2lTVgCg72Z" />
      <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=FtRookie/overengineered&type=date&legend=top-left&sealed_token=fSxZ5qFvQ7g31NwN_RogegClv6txYdwn0bga37ghNx8t1S5fLOc3ic8_bEfKNHeSF8K3YgplM3YLaMZ9cYm-X1ca3HutgsRlDrTztbJViLAjJzExXtjgbBT23_kunf9GgOscL39wvTZeSSvMGt2f8aN8LyDOtwHGBpDKKoaaSTm9JHhybk2lTVgCg72Z" />
    </picture>
  </a>
</p>

---

## 📝 License

This project is a fork of [OverEngineered](https://github.com/anywaymachines/overengineered), which is licensed under Apache 2.0 — see [LICENSE.UPSTREAM](LICENSE.UPSTREAM).
All modifications and additions in this fork are governed by a custom non-commercial license — see [LICENSE](LICENSE).
Attribution for the original authors, and the scope of what each license covers, is in [NOTICE](NOTICE).
