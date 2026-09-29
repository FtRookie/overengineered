<h1 align="center">Underengineered 🚀</h1>

## ⚡ Install in one line

Copy the line for your computer, paste it, press Enter. It downloads the game, builds it and opens it in Roblox
Studio. You do not need to install anything first.

**Windows** — paste into Command Prompt or PowerShell:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; irm https://raw.githubusercontent.com/FtRookie/overengineered/main/scripts/install.ps1 | iex"
```

**macOS / Linux** — paste into Terminal:

```bash
(if command -v curl >/dev/null; then curl -fsSL https://raw.githubusercontent.com/FtRookie/overengineered/main/scripts/install.sh; else wget --no-hsts -qO- https://raw.githubusercontent.com/FtRookie/overengineered/main/scripts/install.sh; fi || echo "Could not download the installer. Check your internet connection." >&2) | bash
```

**To update**, paste the same line again: it pulls the latest version and rebuilds.

**To put it somewhere else** than the `overengineered` folder in your home folder, use this line instead, with
your folder in place of the example one (a folder name without spaces or apostrophes).

Windows:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::SetEnvironmentVariable('OE_DIR', 'D:\Games\overengineered'); [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; irm https://raw.githubusercontent.com/FtRookie/overengineered/main/scripts/install.ps1 | iex"
```

macOS / Linux:

```bash
(if command -v curl >/dev/null; then curl -fsSL https://raw.githubusercontent.com/FtRookie/overengineered/main/scripts/install.sh; else wget --no-hsts -qO- https://raw.githubusercontent.com/FtRookie/overengineered/main/scripts/install.sh; fi || echo "Could not download the installer. Check your internet connection." >&2) | OE_DIR=~/Games/overengineered bash
```

**What it changes on your computer:** only the project folder and Roblox Studio. If Node.js, Git or Lune is
missing, or your Node.js is too old, a temporary copy is downloaded for the build and deleted when it finishes,
whether it worked or not. Roblox Studio is installed if you do not have it. Studio has no Linux version, so on
Linux it installs [Vinegar](https://vinegarhq.org) from Flathub instead (and Flatpak first if needed, which asks
for your password); Vinegar needs a 64-bit Intel/AMD processor.

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
| 🤖 | **AI-Assisted Development**<br>Parts of this codebase are written with AI assistance, under human review and fully tested before release. See [Why we use AI](#why-we-use-ai) below. |

### Why we use AI

Overengineered has a strong, consistent codebase, and that is precisely what makes agents effective here:
there is an established pattern for nearly everything, and a way to verify against it. So we get to spend our
time on feature design rather than on syntax and structure.

Getting to that point took deliberate effort. We trained Claude early to drop bad habits and pick up the ones
this codebase wants, and [CLAUDE.md](CLAUDE.md) is the accumulated result, refined until we were happy with it.

Nothing is committed until it is fully tested, so features don't ship half-finished. That cuts both ways: a bug
you run into was missed, not knowingly left in, so it is genuinely worth
[reporting](https://github.com/FtRookie/overengineered/issues).

---

## 🚀 Getting Started

Underengineered is written in [roblox-ts](https://roblox-ts.com/) and synced into Studio with
[Rojo](https://rojo.space/). You need [Git](https://git-scm.com/downloads),
[Node.js 20.19+, 22.12+ or 24+](https://nodejs.org/) (odd-numbered releases up to 25 are not supported), [Rokit](https://github.com/rojo-rbx/rokit)
and Roblox Studio. To skip all of that, use the [one-line install](#-install-in-one-line) at the top.

### Manual install

```bash
git clone https://github.com/FtRookie/overengineered.git
cd overengineered

npm install          # project dependencies
rokit install        # lune and rojo, at the versions this project pins
npm run build        # compile TypeScript into out/
lune run assemble    # bundle out/ and the game assets into place.rbxl
```

Then open `place.rbxl` in Studio and press play. That is a complete, working build — no sync server needed.

To develop against it, run `npm run dev` instead of `npm run build`: it watches your code and syncs into Studio
live over Rojo.

The full setup guide — installing Rokit and the Rojo Studio plugin, the complete command list, the project
layout, `.env` configuration and how saves reach the external database — is in
**[CONTRIBUTING.md](CONTRIBUTING.md)**.

---

## 🤝 Contributing

We welcome community contributions! Feel free to open an issue or submit a pull request.

> **New here?** Read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and how your contribution is licensed, then pick up an [open issue](https://github.com/FtRookie/overengineered/issues) or hop in the [Discord](https://discord.gg/ys6nKtuwWY) to say what you're working on.
>
> Working with an AI agent? That is encouraged — see [Using AI](CONTRIBUTING.md#using-ai) for how to get good results out of one here.

<p align="center">
  <img src="https://contrib.rocks/image?repo=FtRookie/overengineered" alt="Contributors" />
</p>

---

## 📊 Project Stats

<p align="center">
  <a href="https://www.star-history.com/?repos=FtRookie%2Foverengineered&type=date&legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=FtRookie/overengineered&type=date&theme=dark&legend=top-left" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=FtRookie/overengineered&type=date&legend=top-left" />
      <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=FtRookie/overengineered&type=date&legend=top-left" />
    </picture>
  </a>
</p>

---

## 📝 License

This project is a fork of [OverEngineered](https://github.com/anywaymachines/overengineered), which is licensed under Apache 2.0 — see [LICENSE.UPSTREAM](LICENSE.UPSTREAM).
All modifications and additions in this fork are governed by a custom non-commercial license — see [LICENSE](LICENSE).
Attribution for the original authors, and the scope of what each license covers, is in [NOTICE](NOTICE).
