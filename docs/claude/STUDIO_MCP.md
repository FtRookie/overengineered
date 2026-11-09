# Driving a live Studio (MCP and computer use)

Read this before testing anything in a running Studio: a playtest, a Server & Clients session, or the GUI. For
anything pure, the headless path in [BUILD_AND_TOOLING.md](BUILD_AND_TOOLING.md) is faster and needs no Studio.

## Setup

- **Studio side, once per window:** Assistant > Manage MCP Servers > "Enable Studio as MCP server". In a Server &
  Clients session every window is its own Studio process and must have it on.
- **Agent side:** the `Roblox_Studio` server is registered at local scope (`claude mcp add --scope local Roblox_Studio
  -- cmd.exe /c "cd /d %LOCALAPPDATA%\Roblox && .\mcp.bat"`). Its tools load only when a session starts, so a session
  that registered it, or one where they did not load, uses `scripts/studio-mcp.js` instead — it talks to the same
  `StudioMCP.exe`. Registering with `add-json` from Git Bash fails ("Invalid input"); use PowerShell and `mcp add`.

## `scripts/studio-mcp.js`

```bash
node scripts/studio-mcp.js studios                     # every window and what it is: edit / server <players> / client <player>
node scripts/studio-mcp.js luau server  < probe.luau   # Luau from stdin or a file; every return value printed, one per line
node scripts/studio-mcp.js luau client:Player1 file.luau
node scripts/studio-mcp.js console server               # console output of that window
node scripts/studio-mcp.js play | stop                  # solo playtest in the edit window
node scripts/studio-mcp.js tool <name> '<json>' [target]
```

- Targets are roles, not ids: `edit`, `server`, `client`, `client:<PlayerName>`. Window ids change with every
  playtest and every Studio restart, so never reuse one from an earlier run.
- A solo playtest is one window that answers as edit, server and client at once.
- `luau` packs every return value into JSON (a raw `execute_luau` returns only the first); Instances and datatypes come
  back through `tostring`, arrays as lists. A Luau error prints `ERROR: <message>` and exits 1.
- Keep scripts in files in the scratchpad and fill parameters with `sed` (`%UUID%` → value) rather than escaping Luau
  into shell strings.
- Do not use operators-ts's `studio-mcp.js play`/`scenario`: they stamp an `AgentSession` value into the edit copy of
  Workspace, which is meaningless here.

## How the console relates to the game

- **`execute_luau` runs in its own VM.** It sees instances, not module state: the DI container, a controller's maps
  and `LocalInstanceData` are out of reach. Drive the game the way a player does — fire the real remotes from a
  client — and read results from instances (`Humanoid.Health`, a `Motor6D`'s `Enabled`, attributes, a GUI control's
  `Interactable`).
- Compiled shared modules can be `require`d from a console (`ReplicatedStorage.TS.building.BlocksSerializer`); the
  console gets its own copy, so only pure functions are useful.
- **Stop every playtest you start** (`studio-mcp.js stop`) once testing is done, and confirm `studios` shows only
  `edit`. With a write token set, a running session keeps writing to production and saves again on exit.
- **A running playtest keeps the code it started with.** Rojo syncs into the edit place, not into a running session.
  After a change, stop and start the playtest, and confirm the client has it with a source search, e.g.
  `LocalPlayer.PlayerScripts:FindFirstChild("PlayerSettingsGeneral", true).Source`.
- **A reopened Studio may not be syncing with Rojo.** Running code can still be current (it came from the place file),
  so test the sync itself: a new file under `out/` that never appears in the place means Rojo is not connected. Then
  put what a test needs into the edit place directly, with `luau edit`, while no playtest runs. Set a module's
  `Source` from its compiled `out/` file (what Rojo would write), or create a temporary `LocalScript` in
  `StarterPlayer.StarterPlayerScripts`. Keep a backup of anything you patch, and remove it all afterwards.
- **To reach module state, run code in the game's own VM.** A `LocalScript` shares the client's module cache, so a
  temporary one can `require` a module and act on it (for instance, watch for an attribute a console script sets and
  apply it). Put it in gitignored `out/client/zz*.client.luau` when Rojo syncs, or in the edit place when it does not.
- **Detecting a yield:** `task.defer` a check of a flag cleared right after the call. The deferred function only runs
  while the call is still in progress if the call yielded; comparing `time()` misses a yield that resumes in the same
  frame. This found the HTTP request behind a `debug.profileEnd() - No active profile annotation` warning (a
  `profilebegin`/`profileend` pair whose middle yielded).

## Testing a block with a configured value

A block's config is not an attribute on its model. It lives in `BlockConfigStore`, which is authoritative on the
server and, on the owner's client, a cache seeded only from the slot-load reply and the owner's own edits. A console
script can update neither copy the way the game reads it, and loading a slot to seed it writes to the database when a
write token is set. What works:

1. Place the block in build mode with `building_place` and no `config`.
2. Send the config as the config tool does: `building_updatecfg:InvokeServer({ plot, configs = {{ block, scfg = json }} })`.
3. Put the same JSON into the client store through a temporary `LocalScript` that requires
   `ReplicatedStorage.TS.building.BlockConfigStore` and calls `BlockConfigStore.set(block, decoded)`.
4. Ride, and read the result from instances (a weld's `C0`/`C1`, a constraint's target).

A config entry per input is `{ type, config, controlConfig? }`. Inputs with a keybind control (the servo's `angle`,
the slider's `targetPos`) have it enabled by default, with a `startValue` of its own. The fixed-value tests here sent
`controlConfig` with `enabled = false` (the rest copied from the definition); what an enabled control feeds instead of
`config` was not checked.

## Reading output

- Every Studio process writes its own `%LOCALAPPDATA%\Roblox\logs\*_Studio_*_last.log`: a solo playtest goes to the edit
  window's log, a Server & Clients session gives the server and each client a file of their own. Pick by timestamp.
- The log file is written behind the game. For something that just happened, read `studio-mcp.js console <target>`.
- `client:<PlayerName>` lookups fail now and then with several windows open; retry the same call.
- Without computer use, a client can leave with `LocalPlayer:Kick(...)` from its own console. That is not the exit
  button the user prefers, so say which one was used.

## Before pressing Play

- **Check `.studioconfig.json`'s `writetoken` is empty** (generated from `.env`'s `WRITETOKEN`). Empty means
  read-only against production; a token makes the playtest write to the live database.
- A 4xx from the external database (a route not deployed yet) only warns; a 5xx marks it down for the session.
- **Starting a Server & Clients session:** the test controls are at the top left of the edit window (mode dropdown,
  player count, play button). The server answers within seconds; the clients take about a minute to load and only
  then appear in `studios` (the server lists no players until they join).

## Remotes worth knowing

All from a client unless noted. Per-player remotes live under `LocalPlayer.PlayerGui.Remotes`; find them by name
with `FindFirstChild(name, true)`.

| Purpose | Call |
|---|---|
| Change play mode | `ReplicatedStorage.md_set:InvokeServer({ mode = "ride" \| "build" })` |
| Report damage | `ReplicatedStorage.block_damage:FireServer({{ block = model, damage = { heatDamage, impactDamage, explosiveDamage, impulseHeat } }})` — `impulseHeat` is a boolean; any other shape kicks the sender |
| Change a setting | `player_updsettings:FireServer({ replication = { pvp = false } })` — PvP is fixed at ride start, so re-ride (build, then ride) for it to apply |
| Detonate own TNT | `ReplicatedStorage.explode:FireServer({ part, epicenter, affected = {}, at = workspace:GetServerTimeNow() })` |
| Spawn a shell | `ReplicatedStorage.shell_spawn_c2s:FireServer({ originPart = marker, baseDamage = 0, modifiers, blast })` |
| Claim a shell impact | `ReplicatedStorage.explode_at:FireServer({ position })` |
| Place blocks (build mode) | `building_place:InvokeServer({ plot = <plot folder>, blocks = {{ id, location, color = { color, alpha }, material }} })` |
| Load a real slot | `player_init_admin:InvokeServer(ownerUserId)` → `.remotes` → `slots_load:InvokeServer({ index = n })` |

**Watching the outcome from another client:** what reaches other players arrives as `*_s2c` remotes — `ph_blast`
(explosion push), `shell_spawn_s2c`, `bullet_spawn_s2c`, `plasma_spawn_s2c`, `laser_beam_s2c`,
`explosion_effect_s2c` (unreliable, carries `radius`). Start a listener in the watching client in the background
(`node scripts/studio-mcp.js luau client:Player2 listen.luau > out &`), act from the other client, then read `out`.
Keep a listener short: an `execute_luau` call that runs 90 s fails with "Request timeout" and reports nothing, while
14 s works. For a longer window, run several short listeners back to back.

**Locating a lost relay:** run the same counter on the server, connected to each effect's `*_c2s` `OnServerEvent`,
and on the receiving client's `*_s2c`. Nothing on the server means the sender never sent; server but not client means
a relay check or the effect filter refused. Counts that differ by one at the end are the two windows not starting
together. `b_weapon_fire_s2c` (the firing sound) is server-sent and has no `c2s` side.

## Multi-player tests

- Studio's test accounts are `Player1`, `Player2`, ... with UserIds `-1`, `-2`. Their rows are fresh, so settings are
  the definition defaults (PvP on). A plot may still auto-load a build from the Studio DataStore.
- Character limbs are convenient targets: damageable while their owner rides and is mortal. Limb max health is 100;
  a break leaves the `Motor6D` disabled with `Dismembered` set, a detach also disables the `<joint> Socket` in
  `ConstraintsFolder`.
- The spawn vehicle (`Workspace.Obstacles.Spawn.VehiclePlot.Blocks`) is built in every session; its blocks are unowned.
- **Blacklists cannot be tested in Studio.** `PlayerRank.isMod`/`isDev` return true under `RunService.IsStudio()`,
  and a moderator bypasses every blacklist.
- **Plots:** a plot is the `Workspace.Plots` folder whose `ownerid` attribute is the player's; place blocks relative to
  its `BuildingArea`. Plots sit around Y = -16380, so that height is not a block falling out of the map. A block
  model's name is its uuid; its type is the `id` attribute.
- **Loading a real build** through `player_init_admin` + `slots_load` runs the real loader (slot routing,
  `upgradeSave`, `deserializeFromObject`). It resolves the slot the way the game does, so it can differ from the
  external database's copy of the same index. To find a slot holding particular blocks, query the external database
  read-only (`sqlite3 "file:...?mode=ro"`, `instr(data, 'cannonbreech')` on `saves`) and load it this way.
- **Test setup from the server console** — moving a character with `Character:PivotTo`, anchoring a part — is fine
  when it is not what is being tested.
- **Fire:** a server-side burn is visible only through what clients render: a burning part holds clones of
  `ReplicatedStorage.Assets.Effects.Fire`'s children, so find the burning block from a client. A burn lasts about 25 s;
  act within that.
- **Shells:** a relayed shell's impact is accepted within `speed × elapsed × 2` of the muzzle, and the speed comes from
  its modifiers. A forged shell with no `speedModifier` has speed 1, so its `explode_at` must be within a stud or two;
  pass a real chain's `{ speedModifier = { value = 1000 } }`. A muzzle is a module's `moduleMarkers.output1`. To test
  the cooldown, fire twice from one muzzle within half its reload (heavy: 6 s).
- Another player loading a slot onto a plot mid-run replaces the blocks a test holds; re-find blocks by `id` each step.

## Computer use (desktop app only)

- Grant only Roblox Studio; everything else is masked in screenshots.
- **Tell the windows apart by labelling them:** a `ScreenGui` with a `TextLabel` per client, created through
  `luau client:<Player>`. Window titles are all "Place1". The labels go when the playtest stops.
- **Clicks on small controls miss.** A settings toggle is about 32×16 px. Read the control's state over MCP
  (`Interactable`, `AbsolutePosition`) instead of inferring it from a click that changed nothing — an unchanged
  toggle after a click proves nothing on its own.
- `Interactable = false` does not change how a settings toggle looks.
- The game's settings are behind the ≡ button in the top bar (first icon in build mode, left of the blue bar while
  riding). The square beside it opens Slots and the gear opens the spawn picker. A popup's close button sometimes
  needs a second click.
- Computer-use clicks and held keys reach the game: a held F fires a riding player's weapons. A
  `UserInputService.InputBegan` listener run from the console sees none of it, so it cannot confirm input; count the
  effects on another client instead.
- Lowering Studio's graphics quality keeps three windows responsive.
