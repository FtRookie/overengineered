# Player Mortality — Unifying Characters into the Block Damage/Fire System

> Plan to make player characters "made of blocks": each rig limb becomes a pseudo-block
> in the existing server damage/fire pipeline, `Humanoid.Health` is driven by collective
> limb HP, and the bespoke player-fire code is deleted.
>
> Core files: `src/server/ServerBlockDamageController.ts`, `src/server/SpreadingFireController.ts`.
> Owner/lifecycle: `engine/shared/PlayerWatcher.ts`, `Players.GetPlayerFromCharacter`.

---

## Why

Player fire today is a **separate, bespoke system** in `SpreadingFireController` (a per-character
timer, `ignitePlayer`/`extinguishPlayer`, a proximity ignite loop). It has repeatedly broken —
fire that never goes out, players igniting each other forever ("HBM Virus"), corpses igniting the
living — because the per-character timer is refreshed every tick and a player's own burning limbs
are ignition sources.

The **block** system already has a correct, finite fire lifecycle: idempotent ignition
(`markBurning` never refreshes), a fixed burn duration, radiative spread, and a terminal state
(HP→0 break, or burnout with the tag cleared). Rather than keep patching the player path to
re-derive that, route characters **through the block system**. Characters currently take **no
damage at all** (they're effectively invincible); doing this also introduces opt-in **mortality**
as a gameplay feature.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Model | Each **rig limb** is a per-limb pseudo-block (not the character Model as one block). |
| Owner | `owner = Players.GetPlayerFromCharacter(limb)?.UserId`. **No reparenting** — nothing uses `Workspace:FindFirstChild(playerName)`, and reparenting risks `Player.Character`/StarterCharacter/camera/streaming assumptions. |
| Health source of truth | **Part-HP is authoritative.** `Humanoid.MaxHealth = Σ limb maxHP`, `Humanoid.Health = Σ limb currentHP` (direct correlation). |
| Death | Driven by `Humanoid.Health → 0`, so the existing `Humanoid.Died` → respawn/ragdoll path is reused, not reinvented. |
| Vital parts | `Head` and `HumanoidRootPart` are `isVital`: their break sets `Humanoid.Health = 0` (blowing a head off kills). Non-vital limbs → dismember. |
| Dismemberment | Non-vital limb HP→0 routes through the **ragdoll path** (unweld + ragdoll), **not** `ImpactBreak` debris. Server-authoritative; the client always follows. |
| Excluded parts | Accessory `Handle`s, accessory/tool parts never register (invisible placement parts must never ignite). |
| Fire visual on limbs | Particle + char-black paint, but **skip `charAndRelease`'s anchor/"release"** — releasing a rig part would break the Motor6D assembly. |
| `forget` trigger | `PlayerWatcher` character-removing/died — **not** `DescendantRemoving` (which fires on every tool/accessory change and would wipe state mid-burn). |
| Regen | Replace Roblox's default `Health` regen (a single value) with a **per-limb** heal applied to each limb's part-HP. |
| Toggle | A player is mortal iff `mortality || pvp`, read from **PlayerConfig** (already sent to the server). PvP forces mortality so a PvP attacker can't be immortal; a non-PvP player opts into survival explicitly. |

## Concern audit (resolved)

- **`Humanoid:TakeDamage` — zero uses** in the codebase. Nothing bypasses the part-HP model via TakeDamage.
- **Direct `Humanoid.Health` writers that must be handled:**
  - `KillPlane.ts:15` (`human.Health -= human.MaxHealth * 0.1`) — the KillPlane **already damages blocks in its area**, which will now include limbs, so the direct Humanoid line is redundant → **delete the line**.
  - `BuildMode.ts:12` (`humanoid.Health = humanoid.MaxHealth`) — full heal on entering build → **redirect to restore every limb's HP**.
- **Death handlers** (`PlayModeController`, `RagdollController` on `Humanoid.Died`) are read-only and preserved — driving `Humanoid.Health → 0` still fires `Died`.

## The seam (soundness)

No `character as BlockModel` cast. The fire/damage core operates on a small **`Damageable`**
descriptor resolved per-instance:

```
Damageable {
  parts: the BasePart(s) this covers      // block: welded parts; limb: itself
  position, size                          // block: PrimaryPart / manager.scale; limb: self / .Size
  thermalProfile                          // block: material's; limb: a fixed "flesh" profile
  ownerId?                                // block: plot ownerid; limb: GetPlayerFromCharacter
  isVital                                 // block: false; limb: Head || HumanoidRootPart
  onBreak()                               // block: ImpactBreak; limb: ragdoll/dismember (or death if vital)
}
```

Blocks get an adapter reproducing today's behavior exactly; character limbs get the limb adapter.
This contains what would otherwise be ~15 scattered `if (isCharacter)` branches, and is where the
**toggle gate**, **Handle exclusion**, and **vital-part rule** all live.

## Phased plan

Ordering is strict: **Phase 0 must land and be verified behavior-neutral for blocks before any
character work**, so a character bug can never surface as a block-damage regression.

**Phase 0 — the seam (no behavior change).** Introduce the `Damageable` descriptor and route
`ServerBlockDamageController`'s block-specific lookups (`material`/`scale`/`PrimaryPart`/`ownerIdOf`/
`forceBreakBlock`) through it. Ship the block adapter alone; confirm blocks burn/break/spread
identically.

**Phase 1 — character adapter (server, toggle-gated).** A server controller near
`ServerPlayersController`, driven by `PlayerWatcher`, registers each rig limb (excluding
Handles/accessories/tools) as a `Damageable`: owner via `GetPlayerFromCharacter`, flesh thermal
profile, `size = limb.Size`, `isVital = Head || HumanoidRootPart`. `forget` on
`PlayerWatcher` character-removing/died. Registration only when `mortality || pvp`.

**Phase 2 — health bridge.** `Humanoid.MaxHealth = Σ limb maxHP`; drive `Humanoid.Health = Σ current`
on change. Limb HP→0: vital → `Health = 0` (death); non-vital → dismember via ragdoll. Delete the
KillPlane Humanoid line, redirect BuildMode heal to limbs, replace default regen with per-limb heal.

**Phase 3 — fire on limbs.** Limbs ignite through the unified radiate/ignite path. Limb fire visual =
particle + char-black, skipping the anchor/"release". Verify the extinguisher area-sweep still puts
limbs out through the unified extinguish.

**Phase 4 — delete the patchwork.** Remove `SpreadingFireController`'s player-specific code
(`burningPlayers`, `ignitePlayer`, `extinguishPlayer`, the ignite loop, the burn-out loop). The
unified path replaces it. Retires the interim `blockBurnedOut`-adjacent player reasoning and the
per-character timer.

**Phase 5 — client reaction.** Update `RagdollController` to prioritize server-driven
ragdoll/dismember/death state; `OtherPlayersController`-class controllers apply char/fire visuals.

## New config field

`mortality: boolean` in `PlayerConfig` (likely alongside `replication.pvp`). **No save version bump**
— `Config.addDefaults` backfills new fields on load (see CLAUDE.md "Adding a field needs no version").

## Risks / open items

- **Regen replacement** — confirm the default `Health` script is a single-value regen and replace it
  cleanly with per-limb healing; don't leave both writing health.
- **Network ownership on dismember** — character limbs are client-network-owned; server-authoritative
  unweld/ragdoll must win. `RagdollController` needs the "prioritize server" update (Phase 5).
- **Vital-part edge cases** — Roblox also kills a Humanoid on neck/`RequiresNeck` loss; confirm the
  `isVital` set (Head, HumanoidRootPart) matches Roblox's hardcoded death triggers so the HP model and
  Roblox never disagree on "is this player dead".
- **Extinguisher parity** — the extinguisher's player branch in `extinguishArea` must keep working
  through the unified extinguish once the player patchwork is gone.
- **Toggle read timing** — read `mortality || pvp` from PlayerConfig at character spawn AND on config
  change (a player toggling PvP mid-session should gain/lose mortality without respawning).
