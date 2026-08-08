# Cooperative ride mode — analysis

Scope: the host rides and holds network ownership of the machine; whitelisted guests sit in seats on the same
machine and give inputs that drive it. Companion to `MULTIPLAYER_BUILDING.md`, which covers co-op building
and treats ride as owner-only "for now" — this is the "later".

**Verdict: feasible, and the input model is a better fit than expected — but it is a networking feature, not
a permissions one.** Co-op building works by widening a check. None of that applies here: nothing needs
un-gating, because guests' inputs do not currently exist on the host at all. The work is a new input channel
plus a decision about who may drive what.

## How control actually works today

This is the fact everything else follows from. `ClientMachine.initializeControls()` walks every block config,
and for each input that has an enabled `control` config it builds a `ClientBlockControl` which writes
**straight into the logic value storage**:

```ts
const set = (newValue: boolean) => value.set("bool", (val = newValue));
this.event.onKeyDown(config.key, () => set(!config.reversed));
```

So the path from key to machine is:

```
keypress → ClientBlockControl → logic input storage → BlockLogicRunner (same client)
```

**There is no network hop anywhere in it.** Block logic runs only on the owning client, and its inputs are
set locally on that same client. Physics then replicates outward from the owner because ride mode gave them
network ownership of every part.

Two consequences:

- The host needs no changes at all. Their inputs already work exactly as they do today.
- A guest's keypress has no path to the machine. Their client is not running the logic, so a local write
  would go into a logic graph that nothing ticks.

### Control is already gated on seat occupancy

Also in `initializeControls()`:

```ts
this.event.subscribeObservable(this.occupiedByLocalPlayer, (enabled) => {
    if (enabled) control.enable(); else control.disable();
}, true);
```

`occupiedByLocalPlayer` is set by `VehicleSeatBlock` from the seat's `Occupant`. So **"you may drive because
you are sitting" is already the rule** — it is simply evaluated locally, for one player. That is the exact
semantic the feature wants, which makes the seat the natural authority for guest input too.

## What has to be built

### 1. An input relay

A remote carrying "this control changed to this value", guest → server → host, with the host applying it to
the corresponding `ClientBlockControl` input. Addressing is the first design question: controls are created
per `(block uuid, input key)`, and both are already stable and known to every client, so
`(blockUuid, inputKey, value)` is a sufficient and validatable identity.

Type-wise this is the well-trodden path in this codebase — `BlockSynchronizer` is the standard tool for block
state crossing clients, with runtime type-checking and a kick on mismatch. The payload here is small and
frequent, which points at an `A2SRemoteEvent`-style channel with tight validation rather than a
`RemoteFunction`.

### 2. Server validation

Cheap, and the pieces exist:

- Sender is whitelisted on the target plot — same check as co-op building.
- Sender is **currently seated** on that machine. The server can see `VehicleSeat.Occupant`, so this is
  authoritative, not client-claimed. This is the check that stops a guest driving from across the map.
- The value type-checks against the input's declared primitive and clamp. `t.numberWithBounds` already
  carries the bounds; the block definition already declares them.

### 3. Applying inputs on the host

The host's `ClientBlockControl` for that input is the natural target, but the controls are stateful — `Bool`
tracks toggle state, `Number` runs smoothing and speed ramps. Feeding a relayed value in has two options:

- **Write the resolved value directly into the logic input storage**, bypassing the control. Simple, and
  matches what the control ultimately does, but skips smoothing — a guest's analogue-ish inputs (motor speed
  ramps) would step rather than ease.
- **Drive the control as if the key were pressed** — relay key *events* rather than values, so the host's
  existing control object produces identical behaviour for guest and host. More faithful; requires exposing
  a "simulate this key" entry point on the controls.

The second is better for feel and keeps one implementation of every control's semantics. It also means the
guest sends far less: a keydown/keyup pair rather than a value stream.

## The difficulties

### Latency is the real cost, and it is unavoidable

The host's own input is instantaneous — local write, same-frame. A guest's is:

```
guest keypress → server → host → logic tick → physics → replicate → guest sees it
```

That is roughly one guest→host round trip *plus* normal physics replication before the guest sees a result.
On the links measured elsewhere in this codebase (`REPLICATION_PIPELINE` was fitted at ~92 ms of replication
lag alone, with message delivery at 14–19 ms), a guest should expect well over 100 ms between pressing a key
and seeing the machine respond.

**This is inherent, not a bug to optimise away.** Roblox part ownership is single-holder; if the guest owned
anything, the host would see *their* inputs late instead. The only real mitigations are presentational:
client-side prediction of purely visual effects, and not pretending the guest is the driver — which argues
for the co-pilot framing below.

### Who may drive what

Today one player drives every keybound input on the machine, because there is one driver. With two seated
players the options diverge sharply:

- **Everyone drives everything.** Simplest, matches the current model, and conflicts resolve as last-write-
  wins per tick. Two players holding opposite steering keys fight; a toggle pressed by both flickers. Fine
  for "friend helps with the guns", bad for anything both players instinctively grab.
- **Per-seat control assignment.** Each seat owns a subset of inputs — the natural mental model for a
  gunner's seat, and a real feature rather than a workaround. But it needs new per-seat configuration UI and
  a way to express "these inputs belong to that seat", which does not exist in any form today.
- **Driver seat drives, passengers get a declared subset.** Middle path that leans on blocks that already
  exist: `VehicleSeatBlock` is `limit: 1` ("Driver seat") and there is a separate `PassengerSeatBlocks`
  family. The distinction is already in the block set, and currently only the driver seat sets
  `occupiedByLocalPlayer`.

The block limit is worth noting explicitly: **there is exactly one driver seat per machine.** Co-op driving
therefore already implies either passenger seats gaining control rights, or that limit changing.

### Seat mechanics carry hidden state

`VehicleSeatBlock` locks the occupant's jump (`UseJumpPower = false; JumpHeight = 0`) and restores it on
exit, keyed per humanoid in a static map. That logic runs on the client whose logic instance it is — with
guests seated, the block's `lock` input is evaluated on the host's client, but the humanoid to lock belongs
to the guest. Today it guards with `player === Players.LocalPlayer`, so **a guest in a locked seat would
simply not be locked in**. Making seat locking work for guests needs the lock to travel, or to be applied
by whoever owns that character.

Similarly `machine.occupiedByLocalPlayer` currently means "am *I* in the driver seat" and drives both the
control gating and the ride HUD's visibility. Co-op needs it split into "is this machine occupied" versus
"am I the one driving", which are currently the same boolean.

### Death, respawn and unseating

A guest dying or respawning mid-ride unseats them, and their controls must release — otherwise a held key
stays latched in the host's logic forever. The relay needs an explicit "input released" on unseat, and the
server should clear a guest's inputs when `Occupant` goes nil rather than trusting a final message that may
never arrive. Same for a guest leaving the server mid-ride.

Note the existing `MortalityController` arms limbs on ride start for the rider; whether seated guests are
mortal on someone else's machine is a policy question that co-op building's host-priority rule does not
answer.

### Interaction with the building feature

- A guest in a seat is in **ride** state on a plot they do not own, which the building document currently
  forbids outright. That gate becomes "may not build while riding" rather than "may not ride".
- Ride start currently reassigns network ownership of every block to the rider. With guests aboard this must
  stay pinned to the host, including across a guest sitting or standing.
- Exiting ride regenerates every block model. Guests must be released cleanly first.

## Recommended shape

1. **Frame it as co-pilot, not co-driver.** The host drives; guests operate. Latency then reads as intended
   rather than broken, and it sidesteps the input-conflict problem entirely for v1.
2. **Relay key events, not values**, so the host's existing controls produce identical behaviour for both
   players and the wire payload stays tiny.
3. **Authorise on seat occupancy, server-side.** The server can read `Occupant`; the guest cannot lie about
   sitting down.
4. **Split `occupiedByLocalPlayer`** into occupancy and driving-authority before anything else — it is small,
   and everything downstream depends on the distinction.
5. **Defer per-seat control assignment.** It is the feature people will eventually want, but it needs config
   UI and a seat→inputs model, and none of the rest is blocked on it.

## One-line summary

The seat-gated, direct-write input model is a good match for what co-op ride wants, and the host side needs
no changes at all — but guests' inputs have no path to the host today, so this is a networking feature whose
real costs are latency and deciding who drives what, not permissions.
