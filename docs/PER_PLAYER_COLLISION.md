# Per-player collision — analysis

Scope: a player chooses who they do and do not collide with, enforced by the server so the rule is always
symmetric. Raycasts and other queries must keep working through a disabled collision — only physical
pass-through changes. PvP forces collision back on, because opting into combat while opting out of being a
physical object is not a combination to allow. Blacklisting overrides everything: a blacklisted player cannot
interact with you in any way.

Companion to `MULTIPLAYER_BUILDING.md` and `COOPERATIVE_RIDE.md`.

**Verdict: server-side and symmetric is achievable, and the design splits by the *shape* of the rule rather
than by feature.** Rules made of per-player flags — "no player collision", "PvP on" — cost **one collision
group per combination of flags**, not one per player, so the whole flag layer is four groups and scales to any
number of players for free. A genuinely pairwise rule ("not this specific player") cannot be a collision group
at any budget, but `NoCollisionConstraint` expresses it exactly, server-side, with no group cost — affordable
for characters and infeasible for machines. The two layers compose because the only pairwise rule
(blacklist) is also the only unconditional *deny*, and a constraint can only ever deny. Invisibility is the
one part that *cannot* be server-side, because it is per-observer.

## The two mechanisms

|  | Collision group | `NoCollisionConstraint` |
|---|---|---|
| Granularity | group pair — symmetric, place-wide | one specific part pair |
| Budget | **32 place-wide, 12 already used** | none; cost is instance count |
| Authority | server-only to register/configure, replicates | server-created instance, replicates |
| Cost per no-collide relation | zero — any number of players share a group | `partsA × partsB` instances |
| Affects raycasts | only if `RaycastParams.CollisionGroup` names it | **no** |
| Affects `Touched` | **yes** — see below | no |
| Works for machines | yes | no |

The 12 groups in use, decoded from `game/Services/Workspace.rbxmx` (`CollisionGroupData`):

```
Default  Plugin_Unselectable_Group  Blocks  BlockWeld  BlockCollider  StudioSelectable
Projectile  moduleMarker  RadarDetects  BlockRaycast  ColBoxExclusive  PlayerScriptTrigger
```

20 free, against `Players.MaxPlayersInternal` of **60** — so a group *per player* was never possible. What
makes the feature work anyway is that the two common rules are not per-player at all.

## The rule

One predicate, evaluated on the server, read by both the collision path and (see below) the damage path:

1. **Either party blacklists the other** → no collision, and no interaction of any kind.
2. **Both parties have PvP on** → collide, overriding any no-collide preference.
3. **Either party opted out of colliding with the other** → no collision.
4. Otherwise → collide.

Rules 2–4 are functions of two per-player booleans, which is what makes them cheap. Rule 1 is the only
genuinely pairwise one, and it is the only one that denies unconditionally — so it maps onto constraints,
which can only deny. Nothing in the ladder ever needs to *restore* a collision that a lower layer removed,
and that is the property that lets the two mechanisms coexist. There is no `YesCollisionConstraint`; if PvP
had to reinstate collision on top of a group-level denial, none of this would work.

### The flag layer: four groups, any number of players

Because rules 2–4 depend only on `(pvpOn, noCollide)`, one group per *combination* covers every player:

| | `Characters` | `CharactersPvp` | `Ghost` | `GhostPvp` |
|---|---|---|---|---|
| `Characters` | ✓ | ✓ | ✗ | ✗ |
| `CharactersPvp` | ✓ | ✓ | ✗ | **✓** |
| `Ghost` | ✗ | ✗ | ✗ | ✗ |
| `GhostPvp` | ✗ | **✓** | ✗ | ✓ |

All four rows are distinct, so four is the minimum. Everything outside this block mirrors `Default`'s row, so a
ghosted player still stands on the ground, collides with blocks, and takes hits. Total 16 of 32 groups used.

The two bolded cells are rule 2: a player who wants no collisions but has PvP on still collides with other PvP
players, and only with them. Membership is server-assigned, so it replicates and is identical on both clients
— symmetric by construction, with nothing for a client to disagree about — and the cost does not grow with
player count.

`Ghost` covers `isolationMode` ("Blacklist everyone") and a blanket "don't collide with players" toggle alike.

**PvP is taken as mutual here**, matching `ServerBlockDamageController.canDamage`
(`isPvpEnabled(attacker) && isPvpEnabled(ownerId)`) and `PLAYER_MORTALITY.md`'s `mortality || pvp` — PvP is
already a bundle you cannot cherry-pick out of, and collision joins it. Making it unilateral instead ("either
side has PvP on → collide") collapses `GhostPvp` into `CharactersPvp` and saves a group, but it hands a PvP
player the ability to body-block someone who opted out, by turning on a setting that player cannot refuse.
Not worth one group.

**Outside the 4×4 block every one of the four rows has to mirror `Default` exactly, and that is easy to get
wrong** because the existing matrix is authored in Studio and stored as a base64 blob. One concrete cell: the
projectile assets carry `CollisionGroup = "Projectile"` in Studio (`game/Assets/WeaponProjectiles/*.rbxmx`) —
which is why `BaseProjectileLogic.ts:130` has its group assignment commented out, and why the name comparison
at `BaseProjectileLogic.ts:179` reads as "projectiles ignore projectiles" rather than "projectiles ignore
everything". `Projectile` must stay collidable with all four or weapons silently stop hitting players — and a
player who opted out of collisions must obviously still be shootable.

`BlockListBuilder.ts:72` already carries a `fixme` for this class of drift — it assigns `"WeaponMarker"` while
the place registers `moduleMarker`. Register the new groups and their rows **in code** at server startup, so
the names and relationships are greppable instead of living only in the blob.

## The pairwise layer: `NoCollisionConstraint`, characters only

`Part0`/`Part1`, server-created, replicated, and it disables collision between exactly those two parts while
both keep colliding with the rest of the world. No group budget is consumed, and it is the only mechanism that
can express "A and B pass through each other while both still collide with C".

This layer carries rule 1 (blacklist) and the per-target half of rule 3 ("I don't want to collide with *that*
player"). The server evaluates the whole ladder first and creates a constraint only when the answer is "no
collision", so a per-target opt-out that PvP overrules simply never produces one — the additive rule is
resolved before the subtractive mechanism is reached, never against it.

Cost is the product of the two part counts. Both rigs are live here — `RagdollController.ts:83` and
`BackMountBlockServerLogic.ts:22` both branch on `RigType`:

- R6 × R6 → **36** constraints per pair
- R15 × R15 → **256** constraints per pair

Accessory `Handle`s are already `CanCollide = false` and should be skipped; `ProjectileHitboxes` already
identifies them by name for the same reason.

**This is why isolation must use the group and not constraints.** One player isolating against a full server
would be 59 × 256 ≈ 15,000 constraints for one person. The two mechanisms are not alternatives — the blanket
case needs the group and the sparse case needs the constraints.

Lifecycle is the real work: `Part0`/`Part1` must exist, so every pair has to be rebuilt on each respawn and
extended when limbs arrive late. Parent each constraint to one of the two characters so it dies with it rather
than leaking. Roblox has no assembly- or model-level equivalent — that is a standing open feature request, not
an API being missed.

**Machines are out of reach for this mechanism.** A hundred-block machine against another is 10,000 pairs, and
against a character still 1,600. If machine pass-through is wanted it has to be a blanket group rule
(`GhostBlocks` mirroring `Blocks`), not a per-target one. A per-plot group pool is not a way out either: the
plot count is data-driven (`SharedPlots.ts:6` reads it from a `count` attribute on the folder), so it cannot be
assumed to fit in the 20 free slots.

## Raycasts must still pass — where that holds and where it does not

**Constraints: nothing to do.** A `NoCollisionConstraint` is a collision filter only. `CanQuery`, `CanTouch`,
raycasts and overlap queries are all untouched, which satisfies the requirement outright.

**Groups: holds, but as a property to maintain rather than a given.** A raycast is filtered by
`RaycastParams.CollisionGroup`, which defaults to `Default`. Keeping `Ghost × Default` collidable (it is part
of mirroring the row) leaves every existing cast working. The current casts and overlaps:

| Site | Group used |
|---|---|
| `BlockSelect.ts:12` | `BlockRaycast` |
| `WeaponModuleSystem.ts:39` | `Blocks` |
| `SpreadingFireController.ts:14`, `ServerBlockDamageController.ts:69` | `Blocks` |
| `BaseProjectileLogic.ts:56`, `BlastImpulse.ts:9`, `AESARadar.ts:181`, `LaserBlock.ts:328` | none set → `Default` |

None name any of the four character groups, so none break. That is worth stating as an invariant, because a
future cast that filtered on `Characters` would start missing ghosted players.

**The exception is `Touched`.** This place has `TouchesUseCollisionGroups = true` and
`TouchEventsUseCollisionGroups = 2` (`game/Services/Workspace.rbxmx:83-84`), so the matrix gates touch events
as well as physics. `Ghost × Ghost = false` therefore suppresses `Touched` between two ghosted characters —
the one place where "queries still work" does not follow automatically from "raycasts still work".

Nothing currently depends on it: the only character-part `Touched` handler is the ragdoll impact sound at
`RagdollController.ts:229`, whose `canHit` already rejects any hit whose parent has a `Humanoid`
(`RagdollController.ts:219`). Worth re-checking rather than assuming, since it is a place-level setting that
silently widens the blast radius of every matrix edit.

## Blacklist: no collision plus invisibility

The existing blacklist is already effectively symmetric — every middleware pair tests both directions, e.g.
`TracerBlockServerLogic.ts:32-33`, and `SpeakerBlockServerLogic`, `ParticleBlockServerLogic`,
`LaserBlockServerLogic`, `TextToSpeechServerLogic` all repeat the shape. `SharedPlot.isBlacklisted` already
collapses isolation and the per-player list into one predicate, so the collision side can be driven straight
off it with no new state:

- `isolationMode` → the `Ghost` group. Note this must be `Ghost` and never `GhostPvp` — blacklist sits above
  PvP in the ladder, so an isolating player with PvP on must not be pulled back into colliding with other PvP
  players. Isolation is the one case where the flag layer alone gives the right answer for a rule-1 outcome.
- `blacklistedPlayers` entries → constraints per pair.

Note `PlayerRank.isMod` short-circuits `isBlacklisted`, so moderators stay collidable and visible — the
collision path inherits that for free by reading the same predicate.

### "Cannot interact in any way" is not what the blacklist does today

The blacklist currently gates **effects only**. `ServerEffectCreator.ts:46` drops effects whose owner is
blacklisted, and each block's server logic repeats the two-way check for its own channel. **Damage is not
gated at all** — `ServerBlockDamageController` contains no blacklist check anywhere;
`canDamage` (`ServerBlockDamageController.ts:566`) tests ride mode and mutual PvP and stops there.

So a blacklisted player's TNT, lasers and projectiles still damage you right now; you just do not see them do
it. If blacklist is to mean "cannot interact in any way", `canDamage` needs the same predicate the collision
path will read, and it should sit above the PvP test for the same reason isolation maps to `Ghost` rather than
`GhostPvp`. That is a behaviour change to an existing feature, not part of the collision work, but the two
share the predicate and should not be allowed to disagree about what blacklist means.

**Invisibility cannot be server-side, and that is not a compromise — it is the only way it can work.** It is
per-observer: a server-side transparency write hides the player from everyone, including people who have not
blacklisted them. This codebase already documents the mechanism it needs, at `BlockListBuilder.ts:74-76` —
"Setting transparency on a client doesn't replicate" — which is exactly what makes a per-observer effect
possible.

So the feature is necessarily split, and the split is principled rather than arbitrary: **collision is
server-side because a one-sided physical rule is abusable; visibility is client-side because hiding someone
from your own screen is a disadvantage, not an advantage.** There is nothing to gain by faking it.

Both hooks already exist. `OtherPlayersController.ModifyOtherCharacters` is a registered `HostedService` that
already walks every other player's character parts client-side — and carries a commented-out
`instance.CanCollide = false` on the line in between, which is this feature's earlier, blunter draft.
`EnvBlacklistsController` already subscribes to `plot.blacklistedPlayers` and `plot.isolationMode` on the
client and reacts per plot. Invisibility should probably extend to the things that render *about* a player as
well — `BeaconController`, `UsernameGuiController` — or a blacklisted player stays visible as a floating name.

## What "server-side" does and does not buy

The server can guarantee that no *sanctioned* configuration is one-sided: both parties get the same replicated
group membership or the same constraint, so the rule applies identically on both screens.

It cannot stop a client setting `CanCollide = false` or relabelling a part locally — that has always been
possible and this does not widen it. Damage stays server-authoritative and untouched either way. The value of
server-side here is a symmetric, non-abusable *legitimate* path, not a new anti-cheat boundary.

## Recommended shape

1. **One server-side predicate first**, implementing the four-step ladder. Everything else reads it — the
   group assignment, the constraint layer, the client's invisibility pass, and `canDamage`. It is the only way
   blacklist keeps meaning the same thing in all four places.
2. **The four flag groups, registered in code**, driven by `isolationMode`, by `replication.pvp`, and by a
   blanket no-collide toggle added alongside them in `PlayerConfigDefinition.replication` (which already holds
   `pvp` and the `public*` consent flags, and needs no config version bump — `Config.addDefaults` backfills).
3. **`NoCollisionConstraint` for individual blacklist pairs**, characters only, rebuilt per respawn and
   parented to one of the two characters.
4. **Blocks blanket-only, or deferred.** Per-target machine pass-through is not affordable, and phasing
   through anchored build-mode geometry is noclip through the walls the blacklist exists to enforce.
5. **Invisibility client-side**, off the same predicate, extended to beacons and nametags.
6. **Gate `canDamage` on blacklist**, above its PvP test, so "no interaction" is true rather than nearly true.
7. **Verify in Studio** the two things the docs will not settle: whether `Touched` is affected by
   `NoCollisionConstraint` at all, and what the constraint count actually costs at realistic blacklist sizes.

## One-line summary

A rule built from per-player flags costs one collision group per flag combination — four groups, any number of
players — and only the genuinely pairwise rule needs `NoCollisionConstraint`, which is exact and server-side
but quadratic in limbs, so characters only. The layers compose because the pairwise rule is also the only
unconditional deny and a constraint can only deny. Raycasts are untouched, `Touched` is the one query that is
not, and invisibility stays client-side because it is per-observer by nature.
