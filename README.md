<div style="display: flex; align-items: center; justify-content: center;">
  <img src="images/icon.png" alt="OverEngineered Logo" width="30" style="margin-right: 10px; margin-bottom: 3px; border-radius: 5px;">
  <h1 style="border-bottom: none; margin: 0;">OverEngineered 🚀</h1>
</div>

---

<p align="center">
  <a href="https://discord.gg/raax9xUMDc">
    <img src="https://discord.com/api/guilds/1053774759244083280/widget.png?style=shield" alt="Join our Discord" />
  <a href="https://join.anywaymachines.com">
    <img src="https://img.shields.io/badge/Roblox-Play-blue?style=flat-square&logo=roblox" alt="Play on Roblox" />
  </a>
  <a href="https://github.com/Maks-gaming/OverEngineered">
    <img src="https://img.shields.io/github/stars/anywaymachines/overengineered?style=flat-square" alt="GitHub Stars" />
  </a>
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

---

## 🤝 Contributing

We welcome community contributions! Feel free to open an issue or submit a pull request.

> **Repository Submodule Notice:**
> This repository contains a submodule with proprietary services for our official database and anti-exploit protection. These components are exclusive to our infrastructure and are **not required** for local development or community contributions.

---

## 📝 License

This project is licensed under a custom non-commercial license. See the [LICENSE](LICENSE) file for details.
