# Extrapolating other players' machines — analysis

Scope: on a high-ping client, carry another player's machine forward between replication packets by integrating
its velocity (and acceleration), then reset to the replicated position when the next sync arrives. Companion to
`MULTIPLAYER_BUILDING.md`, `COOPERATIVE_RIDE.md` and `PER_PLAYER_COLLISION.md`.

**Verdict: the stated concern is real and worse than expected, and it is not the concern that kills the idea.**
The engine does not overwrite a local position "when a sync is received" — it rewrites remotely-owned
mechanisms **every frame**, so the reset-on-sync design is built on a boundary that does not exist. There is a
way to win that fight, but what it buys is a *visual-only* correction: the machine renders where it should be
while still colliding and taking hits where it currently is. In a game whose weapons raycast locally and whose
damage the server validates against replicated positions, that makes aiming feel right and be wrong — strictly
worse than today for combat, better only for spectating.

## What the engine already does

Roblox interpolates remotely-owned mechanisms; it never extrapolates them. Interpolation is why a remote
machine renders *behind* where it actually is, which is the problem being described.

Two staff statements pin this down:

- On the update mechanism, kleptonaut: *"The client will interpolate network updates as fast as it can handle
  it."* Interpolation Throttling exists precisely because that per-frame work is expensive — it drops distant,
  remotely-owned mechanisms from 60 Hz to 30 Hz and then 15 Hz when the client is over budget. (The
  `Workspace.InterpolationThrottling` property itself was deprecated in 2024; the behaviour is now automatic.)
- On extrapolation, GroupyClumpy in April 2021: *"We've already been experimenting with extrapolation
  internally, but we haven't made any decisions yet. There are a lot of potential pitfalls/issues"*, and again
  in January 2025: *"Unfortunately there's nothing new I can share right now, but we haven't forgotten about
  this!"* — so the feature request is five years open and still unshipped.

**The consequence for the proposed design is decisive.** "Integrate between packets, reset on sync" assumes the
engine only touches the transform when a packet lands. It touches it every frame, because interpolation *is* a
per-frame stepping of the mechanism toward the last received state. A local `CFrame` write is not overwritten
on the next sync; it is overwritten on the next frame.

## Fighting for the transform

Three ways to get the write to stick, in descending order of how much they break.

**Write after the engine, every frame.** The interpolation step runs with physics; `PreRender` runs after it
and before the frame is drawn. A write there plausibly lands last and is what gets rendered — and it has to be
re-applied every single frame, because the engine resets it every single frame. This is the cheapest option and
the one that produces the visual-only outcome discussed below. *Unverified* — the ordering claim needs a Studio
check, not a deduction.

**Anchor the assembly locally.** Documented on the DevForum since 2019: a client that anchors a part and sets
its `CFrame` controls it locally. An anchored assembly is not physics-stepped, so nothing fights the write.
But anchoring is not free even locally — an anchored machine has infinite mass, so *your* machine bouncing off
it, TNT pushing it, and every contact between the two now resolve against an immovable object. That is a worse
artefact than the lag it fixes.

**Hide the real model and render a local clone.** The route the DevForum projectile thread actually took:
leave the replicated model alone, make it invisible per-client (`LocalTransparencyModifier` is
`Not Replicated`, so it is the right tool), and draw a locally-simulated copy. Correct, and completely
detached from collision — plus a clone per remote machine, where a machine here is routinely hundreds of parts.

## The extrapolation itself is the easy part

Worth saying plainly, because it is the only cheap thing here: **a welded machine is one assembly**, so
carrying it forward is one CFrame, one `AssemblyLinearVelocity` and one `AssemblyAngularVelocity` per machine —
not per part. The integration is a few multiplies. Nothing about the maths is a scaling problem.

**This repo already does exactly this, on the server.** `UnreliableRemoteHandler.ts:305-307` dead-reckons a
replicated position to validate a TNT epicenter:

```ts
const lag = age + part.ReceiveAge + REPLICATION_PIPELINE;
const expected = part.Position.add(velocity.mul(lag));
const drift = POSITION_BASE_TOLERANCE + speed * lag * LAG_SLACK;
```

So the technique is in production here, and it was measured rather than guessed. Two numbers from those
measurements matter a great deal to the client-side version.

### The lag is ~80 ms and it is not the network

`REPLICATION_PIPELINE = 0.08`, and the comment above it records how it was fitted: *"a flat ~92 ms of travel at
693, 1665 and 3841 studs/s alike — a fixed time, not anything geometric — while the message itself arrives in
14-19 ms."* The pipeline delay dwarfs message latency by roughly 5×.

This cuts both ways. It confirms the problem is real and large — 80 ms at 1600 studs/s is 128 studs of
divergence, far past a machine's own length. It also means **the feature is not actually about high ping.** A
14 ms link already eats ~80 ms of pipeline. Framing it as a fix for high-ping players will disappoint the
people it is shipped for, because most of what they are seeing is the same delay everyone else has.

### `ReceiveAge` did not measure it

From the same comment: *"ReceiveAge reads 0ms throughout and explains none of it."*

That is the sharpest practical obstacle. `ReceiveAge` is the natural "time since this part last synced"
primitive and the obvious input to a client-side extrapolation — and in this codebase's own measurements it
reported nothing useful. A client would therefore have to extrapolate against a **fitted constant**, which is
systematically wrong on any link that differs from the one it was fitted on, in a way no runtime signal
corrects.

The server tolerates that by adding `LAG_SLACK = 1.5` of headroom, which works for a *tolerance* and is
meaningless for a *position* — you cannot render "somewhere within 1.5× of here". (`ReceiveAge` was read
server-side for a client-owned part; whether it behaves better client-side for a remote-owned one is worth a
direct test before writing it off.)

## Why visual-only is worse than doing nothing

Suppose the `PreRender` write works and remote machines render where they should be. Nothing else moves:

- **Weapons raycast against the real parts.** `BaseProjectileLogic.sweepCollision` casts through
  `Workspace.Raycast`, which sees engine-owned collision geometry at the interpolated position. Aim at the
  visual and the shot passes through empty space where the machine is drawn.
- **Damage is server-validated against replicated positions** — the same lagging positions the extrapolation is
  compensating for. `UnreliableRemoteHandler` widens its tolerance by `speed * lag * LAG_SLACK` precisely
  because everything the server sees lags. Moving the *picture* forward without moving what the server checks
  increases the gap between where a player aims and what the server will accept.
- **Collision response is unchanged.** Your machine still hits theirs where the engine thinks theirs is, so
  contacts happen visibly off the rendered surface.

Today the visual and the hit are consistent and both late — players can and do learn to lead. Extrapolating the
visual alone makes them inconsistent, and an inconsistent world is harder to play than a uniformly delayed one.

## The failure mode dead reckoning always has

Extrapolation is exact under constant velocity and worst at discontinuities: collisions, landings, engine
cut-off, a motor reversing. Those are the moments a builder is watching. A machine that stops during the
extrapolation window is carried straight through the thing it hit and then snapped back — the rubber-band
appears exactly where the player is paying most attention.

Integrating acceleration as well as velocity makes this worse, not better: error grows with `t²`, and the
acceleration of a player-built machine changes every time a block fires. Constant-velocity dead reckoning over
a short window is the defensible version; second-order is not.

## The supported answer

Roblox shipped the thing this proposal hand-rolls. `Workspace.AuthorityMode = Server` makes the server the
single source of truth and gives the engine **client-side prediction with rollback reconciliation**: clients
predict forward, the server corrects, and the client re-simulates from the authoritative state. Physics
properties near the local player are predicted automatically, `RunService:BindToSimulation()` carries the game
logic that must re-run during resimulation, and `RunService:SetPredictionMode()` controls the scope.

It is not a drop-in. It requires six Workspace properties together — `AuthorityMode`,
`NextGenerationReplication`, `PlayerScriptsUseInputActionSystem`, `SignalBehavior = Deferred`,
`UseFixedSimulation` and `StreamingEnabled` — and it **inverts this game's model**. Today the rider is given
network ownership of every block in their machine (`ServerPartUtils.switchDescendantsNetworkOwner`) and block
logic runs only on the owning client; under server authority the server simulates and clients predict. That is
a re-architecture of the whole game, not a latency patch.

The point of raising it is not to recommend it now. It is that a hand-rolled visual extrapolation is a worse
version of a feature the engine already has, and any effort spent on the former is not transferable to the
latter.

## Scope note

Only ride-mode machines are in question. Build-mode blocks are anchored
(`ServerPartUtils.switchDescendantsAnchor`), server-owned and stationary, so there is nothing to extrapolate —
"build positions" here means other players' machines while they are driving them.

## If it is built anyway

The least-bad shape, in order:

1. **Measure first.** Confirm client-side `ReceiveAge` is usable on a remote-owned assembly. If it is not, the
   whole thing rests on a fitted constant and should stop there.
2. **Constant velocity only**, over a window capped at roughly the measured pipeline (~80 ms). No acceleration
   term.
3. **Assembly-level, not part-level.** One transform per machine.
4. **`PreRender` write, re-applied every frame**, never local anchoring — an immovable remote machine is a
   worse bug than a late one.
5. **Ship it as a setting, default off**, next to the existing `replication.*` toggles, and say plainly that it
   moves the picture and not the hitbox.
6. **Do not sell it as a high-ping fix.** The measured delay is ~80 ms of pipeline against 14-19 ms of message
   travel; it affects everyone, and a low-ping player will see the same correction.

## One-line summary

The engine rewrites remotely-owned transforms every frame, not on packet arrival, so "integrate then reset on
sync" has no boundary to reset at; the write can be won in `PreRender` or by locally anchoring, but what it
buys is a picture that moves while the collision geometry and the server's validation stay put — which makes
aiming feel right and be wrong, in a game where the ~80 ms being compensated is pipeline delay that low-ping
players have too.
