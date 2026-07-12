<h1 align="center">OverEngineered 🚀</h1>

<p align="center">
  <a href="https://join.anywaymachines.com">
    <img src="https://img.shields.io/badge/Roblox-play-blue?style=flat-square&logo=roblox" alt="Play on Roblox" />
  </a>
  <a href="https://github.com/Maks-gaming/OverEngineered">
    <img src="https://img.shields.io/github/stars/anywaymachines/overengineered?style=flat-square" alt="GitHub Stars" />
  </a>
  <a href="https://github.com/anywaymachines/overengineered/network/members">
    <img src="https://img.shields.io/github/forks/anywaymachines/overengineered?style=flat-square" alt="GitHub Forks" />
  </a>
  <a href="https://discord.gg/raax9xUMDc">
    <img src="https://img.shields.io/discord/1053774759244083280?color=blue&label=community&logo=discord&style=flat-square" alt="Join our Discord" />
  </a>
  <a href="https://github.com/anywaymachines/overengineered/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/anywaymachines/overengineered/build.yml?style=flat-square" alt="Build Status" />
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
| 🛡️ | **Safety Disclaimer**<br>OverEngineered is a virtual sandbox for creative experimentation. All in-game actions are fictional and should **never** be attempted in real life. Please play responsibly! |
| 🔗 | **Game Access & DMCA**<br>Due to frequent false DMCA takedowns, the official place may be unavailable. Always use our **[verified link](https://join.anywaymachines.com)** to find the latest working version. |
| 💾 | **Automatic Saves**<br>Your progress is protected by an automatic save system every 5 minutes, so your creations remain as safe as possible even during disruptions. |

---

## 🚀 Getting Started: Development Setup

Get up and running with the OverEngineered development environment in a few steps.

### Prerequisites

- [**Git**](https://git-scm.com/downloads)
- [**Node.js v20 LTS**](https://nodejs.org/)

### Installation

1. **Clone the Repository**

    ```bash
    git clone https://github.com/anywaymachines/overengineered.git
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

### Saves and the external database

Player builds live in an **external database**, not in the Roblox DataStore. The DataStore is now only an outbox (for when the backend is unreachable) and a fallback for old saves. This matters for local development, because **loading a slot in Studio hits the real backend over HTTP**.

Configure it in **`.env`** (gitignored, same file as `PUBLISH_KEY`). Both keys are **Studio-only** — nothing here can affect a live server.

```bash
WRITETOKEN=            # empty = read-only. Read the warning below before filling this in
DB_BASEURL=            # empty = production
```

`npm run dev` copies these into `src/server/database/studiotoken.json`, which is what Studio actually reads — Roblox cannot read `.env`, so the values have to arrive as a Rojo-synced ModuleScript. That file is **generated, not edited**: it is rewritten on every run.

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

</details>

---

## 🤝 Contributing

We welcome community contributions! Feel free to open an issue or submit a pull request.

> **Repository Submodule Notice:**
> This repository contains a submodule with proprietary services for our official database and anti-exploit protection. These components are exclusive to our infrastructure and are **not required** for local development or community contributions.

<p align="center">
  <img src="https://contrib.rocks/image?repo=anywaymachines/overengineered" alt="Contributors" />
</p>

---

## 📊 Project Stats

<p align="center">
  <a href="https://star-history.com/#anywaymachines/overengineered&Date">
   <picture>
     <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=anywaymachines/overengineered&type=Date&theme=dark" />
     <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=anywaymachines/overengineered&type=Date" />
     <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=anywaymachines/overengineered&type=Date" />
   </picture>
  </a>
</p>

---

## 📝 License

This project is a fork of [OverEngineered](https://github.com/anywaymachines/overengineered), which is licensed under Apache 2.0 — see [LICENSE.UPSTREAM](LICENSE.UPSTREAM).
All modifications and additions in this fork are governed by a custom non-commercial license — see [LICENSE](LICENSE).
