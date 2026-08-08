# Multiplayer building & plot whitelist — feasibility

Scope studied: a plot owner (**host**) whitelists other players (**guests**). A guest inside the host's plot
bounds builds on it as an extension of the host client — host's block limits, tool calls performed on the
host's behalf — and cannot ride it. Findings are from the code as it stands; nothing here is implemented.

**Verdict: feasible.** The "extension of the host" framing removes the largest obstacle rather than working
around it, because the server already keeps a fully-formed per-player building context; a guest's request
just needs to be executed against the host's one. What remains is a handful of policy decisions and one
lifecycle question (host leaves) that has no answer today.

## Decisions

Settled, so they are not relitigated:

- **The host outranks the guest.** Wherever two actions cannot both happen, the host's wins. This is the
  tiebreak for every case below and for any not yet found.
- **Ride stays owner-only for now.** Multiplayer control is a separate, later feature; the engine's
  single-holder network ownership means it cannot be built the way co-op building is (§4).
- **Host's limits apply.** One plot, one budget.
- **Whitelist is handled exactly like the blacklist** — same settings page, same player-picker control, same
  remote shape, same lifetime (session-only, cleared on plot claim and release). No storage work, no config
  field, no new UI patterns.
- **Losing access resets you to your own plot.** Host leaving, revocation and walking out of the bounds are
  all the same path — see §3.
- **Achievements credit the host.** Guests earn nothing on someone else's plot; needs no code (§7).
- **`devOnly` keys off the host.** A guest on a developer's plot may place developer-only blocks. Chosen for
  consistency — with achievements and `devOnly` both host-keyed, essentially everything keys off the host and
  the sender/host split nearly disappears (§2).
- **A host may load a slot while guests build.** Guests are notified rather than blocked (§7).
- **The shared placement throttle ships as-is.** Revisit only if players report it (§6).

## Player experience

### The host adds someone

Settings → Permissions, where Isolation mode and Blacklist already live. A **Whitelist** list sits beside
them, using the same `PlayerSelectorColumnControl` picker: pick a player from the server, they appear in the
list, remove them to revoke. `ConfigControlBlacklist` already takes its label as a parameter and is otherwise
generic, so this is the same control with `"Whitelist"` passed in, bound to `plot.whitelistedPlayers` and
submitting through a `permissions.updateWhitelist` remote that mirrors `updateBlacklist` line for line.

The list is empty again next session. That is the same rule as the blacklist and needs no explanation in the
UI beyond what the blacklist already sets.

Two states to present carefully, since a player can appear in both lists: a whitelisted player who is also
blacklisted, and a whitelist while **Isolation mode** is on. The blacklist UI already hides itself when
isolation is enabled (`blacklist.setVisibleAndEnabled(!value)`) — the whitelist should do the same, so
"blacklist everyone" visibly means everyone.

### The guest builds

There is no invite to accept and no mode to enter. **The guest walks into the host's plot and their tools
retarget to it.** Walking out puts them back on their own. That is the whole interaction — no button, no
handshake, matching how everything else on a plot works.

While inside, the guest builds exactly as they would at home: same tools, same hotbar, same placement. Three
differences they will notice, and each needs to be visible or it reads as a bug:

1. **Whose plot am I on?** A toast on every switch — **"Switched to \<player\>'s Plot"**, and the matching
   message on the way back. `LogControl.instance.addLine(text, color)` is the existing channel and needs
   nothing new. Decided: a transient toast rather than persistent on-screen ownership UI, so the switch is
   announced without cluttering the build HUD.
2. **The block limits are the host's.** The counter must show the host's usage and the host's caps while on
   their plot, or the guest will be refused placements the UI says are available.
3. **Ride is unavailable — for now.** Pressing it must say so plainly, otherwise the guest rides their own
   empty plot and it looks like the game lost their work. This is an **interim** restriction: multiplayer
   control support is planned separately (see §4), so the refusal should read as "not yet" rather than
   "never".

The guest cannot save. Their work lives in the host's slots and is written by the host's save and autosave.

### Things that happen *to* the guest

Every one of these is the host exercising priority, and each needs a notice or it reads as a malfunction:

| Event | What the guest sees | What they should be told |
|---|---|---|
| Host leaves the server | Blocks vanish, tools snap back to own plot | "\<host\> left — you're back on your own plot" |
| Host un-whitelists them | Same reset, plot still there | "\<host\> removed your build access" |
| Host loads a save | Every block replaced under them; selection empties | "\<host\> loaded a save" |
| Host enters ride mode | Building refused while the machine runs | "\<host\> is testing — building paused" |
| Guest walks out of bounds | Tools return to own plot | Quiet; this one is self-explanatory |

The first three are the same code path (§3): access lost → reset to own plot. Only the message differs.

### What it feels like when it goes wrong

Worth stating plainly, because these are the reports to expect:

- **"Building is slow when my friend is on my plot."** The placement throttle is shared per plot (§6),
  accepted for now.
- **"My friend deleted everything."** Whitelisting is full trust by definition, including delete-all.
  Revocation is instant, but nothing is undone.
- **"I lost my work when they left."** Guest work is unsaved work until the host saves. The notice above is
  the only mitigation.

## The model, and why it fits the code

The server builds a DI scope per player in `ServerPlayerController`, registering that player's id, their
`SharedPlot`, and their `BuildingPlot`:

```ts
builder.registerSingletonValue(asPlayerId(playerId));
builder.registerSingletonValue(plot);
builder.registerSingletonFunc((ctx) => ctx.resolve<ServerPlotController>().blocks);
```

`ServerBuildingRequestController` resolves all three, and every handler does its work against them. Under
"guest acts on behalf of host", a guest's request is simply executed against **the host's** context instead
of the guest's — which is exactly the object graph that already exists and is already correct. Limits, target
plot, blocks folder and welder all come along for free, because they are all reached through the host's
scope.

This is a much smaller change than making the building controller plot-agnostic.

## What is already in place

### Permission is a single function

```ts
isBuildingAllowed(playerId: number): boolean {
    return this.ownerId.get() === playerId;
}
```

All eleven server handlers (place, delete, edit, logicConnect, logicDisconnect, paint, updateConfig,
updateCustomData, resetConfig, weld, recollide) call it, as does `BuildingManager.serverBlockCanBePlacedAt`.
It lives in `shared/`, so widening it to "owner or whitelisted" is one line inherited by client and server
alike.

### The replicated player-list pattern exists verbatim

`blacklistedPlayers` is a JSON plot attribute exposed as an observable:

```ts
this.blacklistedPlayers = this.event.observableFromAttributeJson<readonly number[]>(instance, "blacklisted");
```

A `whitelistedPlayers` attribute is a direct copy: replicates to every client automatically, readable from
shared code, and `ServerPlotController` already clears the analogous field on both plot assignment and
release. `PlayerSettingsBlacklist.ts` is a ready-made settings UI to clone, and `ServerPlots.ts` already has
the owner-mutates-own-list remote handler shape.

### The client is already plot-parameterized

`BuildingMode` holds `readonly targetPlot = new ObservableValue<SharedPlot>(plot)` — an observable, not a
constant — and **every** tool reads through it: Build, Delete, Edit, Config, Wire, Weld, Triangle. Every
`ClientBuilding` argument type carries an explicit `readonly plot: SharedPlot`, and every request sends
`plot: plot.instance`.

So "entering the plot switches you to it" is genuinely just setting that observable. No tool changes.

### Plot-entry detection has its primitive

`SharedPlot.bounds` is a `BB` covering the build area plus the 400-stud height limit, and `BB.isPointInside`
exists and is unit-tested (`shared/test/BB.test.ts`). Detection is a position check against a handful of
plots; nothing like it exists yet, but nothing needs inventing.

### Per-player remotes are genuinely private

`ServerPlayerDataRemotesController.create` parents the remotes folder to `player.PlayerGui`, which Roblox
replicates only to its owning client. **A guest cannot fire the host's building remotes even if they try** —
they are not replicated to them. This is worth stating because it forces the right design: the delegation
must happen server-side, and the sender's identity is never in doubt.

## The difficulties

### 1. Delegation has to be wired into all eleven handlers

Every handler currently reads its context from injected singletons rather than the request:

```ts
private placeBlocks(request: PlaceBlocksRequest): MultiBuildResponse {
    if (!this.plots.isBuildingAllowed(request.plot, this.playerId)) return errBuildingNotPermitted;
    return this._placeBlocks(this.plot, this.blocks, request.blocks);   // <- this.plot, not request.plot
}
```

**Widening `isBuildingAllowed` on its own would not enable multiplayer building — it would silently corrupt
it**, placing the guest's blocks onto the guest's own plot. The permission check and the work must be changed
together, or neither.

The shape of the fix is small: resolve `(plot, buildingPlot, hostId)` once at the top of each handler, from
the request's plot rather than from `this`. `_placeBlocks` is *already* parameterized on `(plot, bplot,
blocks)`, so placement barely changes; the other handlers need the same parameterization. The host's
`BuildingPlot` is reachable through `ServerPlayersController.controllers.get(hostId).plotController.blocks`,
which already exists — no new registry state, just a lookup.

### 2. Some checks must follow the host, others must follow the sender

This is the subtle part of "acting on behalf of", and getting it wrong is a privilege-escalation bug rather
than a visible failure. Within a single handler:

| Check | Should key off | Why |
|---|---|---|
| Block limits (`database.get(id).blocks`) | **host** | One plot, one budget; per-guest budgets would let N players stack N budgets on one plot and defeat the caps entirely |
| Target plot / blocks folder | **host** | It is the host's plot being built on |
| `devOnly` block gate (`PlayerRank.isDevById`) | **host** | Decided: consistency over the narrow escalation. A guest on a developer's plot may place developer-only blocks |
| Achievements | **host** | Decided: guests earn nothing on someone else's plot |
| Whitelist membership | **sender** | It is the sender being authorised |
| Ban / moderation state | **sender** | Acting through a host must not launder a restricted account |

Today all of these read `this.playerId`, which is both. With `devOnly` and achievements both host-keyed, the
split collapses to a simple rule: **the delegation swaps `this.playerId` for the host's id wholesale**, and
only the two authorisation checks — is this sender whitelisted, is this sender allowed to play — are
evaluated against the sender, *before* delegating. That is much less error-prone than a per-check split.

### 3. Host departure — decided, and the trigger already replicates

**Decision: the host leaving revokes building for guests, handled by the same path as walking out of the
bounds — the guest's controls reset to their own plot.** No eviction, freeze or ownership transfer.

This falls out of state that already exists. `ServerPlotController.onDestroy` does
`plot.ownerId.set(undefined)`, and `ownerId` is a replicated attribute exposed as an observable, so every
guest client sees it change without a new signal. That collapses four separate cases into one rule:

> If the target plot stops being one I may build on — host left, whitelist revoked, isolation mode enabled —
> or I leave its bounds, reset `targetPlot` to my own plot.

Both halves are observable-driven (`ownerId`, `whitelistedPlayers`, `isolationMode`, position), so a single
subscription covers all of it, and the tool-state clearing from §5 is shared too.

Accepted consequences, worth stating so they are not rediscovered as bugs:

- **A guest's unsaved work dies with the host's departure.** `onDestroy` destroys the blocks folder. This is
  inherent to the plot being the host's, and is accepted.
- **Guests cannot save.** `ServerSlotRequestController` serialises the injected own-plot `BuildingPlot` into
  the host's slot, and autosave runs on the host's timer. Correct under this model — the build is the
  host's — but it means a guest building alone while the host is idle relies entirely on the host's autosave.

Still open, and *not* covered by the above because the host is present throughout:

- `loadSlot` runs `deleteOperation.execute("all")` and rebuilds. A host loading a slot under a working guest
  deletes the blocks the guest's next request references. **Decided: the host proceeds and guests are
  notified** — host priority. Requests are per-uuid so this fails loudly rather than corrupting, and with the
  §7 selection pruning plus a client notice it reads as an event rather than a bug.

### 4. Ride mode excludes itself for now, and multiplayer control is a separate problem

`RideMode.rideStart` hands **network ownership of every block** to the rider
(`switchDescendantsNetworkOwner(block, player)`), unanchors them, arms mortality and seats the player. Part
ownership is single-holder, so two riders on one plot would silently steal simulation from each other.

**Multiplayer control is planned as a later feature, and this constraint shapes it.** Co-op riding cannot be
built by relaxing a permission the way co-op building can — ownership is exclusive at the engine level, so it
will need a different shape entirely: one player keeps simulation ownership and the others send inputs to be
applied on the owning client, rather than each driving their own copy. Notably, block logic already runs only
on the owning client, so that architecture is closer to what exists than it might look — but it is a physics
and input problem, not a permissions one, and nothing in this document covers it.

Until then the exclusion stands, and the guest's refusal message should read as "not yet".

It needs an explicit refusal, though: `PlayModeController.changeModeForPlayer` resolves the *sender's* own
controller, so a guest pressing Ride today would ride their own (empty) plot rather than being told no.

Conversely, guests must not build on a plot whose host is riding — the blocks are unanchored and simulated on
the host's client. The server already tracks play mode, so this is a cheap gate.

### 5. Plot-entry switching needs care at the edges

- The check must be **guest-side and advisory only**; the server authorises per request regardless. A client
  that lies about its position gains nothing, since the whitelist check is independent.
- Leaving the bounds must switch `targetPlot` back, and the transition should clear tool state (current
  selection, mirror settings, in-progress placement) — those hold `SharedPlot` references and block instances
  from the old plot.
- Overlapping cases: standing in your own plot while whitelisted elsewhere, being whitelisted on two adjacent
  plots, or being inside a plot whose owner just left. Precedence rules needed; "own plot wins" is the
  obvious default.
- Revocation while a guest is inside takes effect on the next request automatically (the check is
  per-request), but the guest's UI should react too.

### 6. The placement throttle is per-plot, and guests will interfere with each other

`ServerPlotController` installs two rate limiters on the plot's `BuildingPlot`:

```ts
this.blocks.initializeTimeBasedDelay();                       // yields once per second of activity
this.blocks.initializeDelay(10, 64, 64);                      // public server: yield every 10 placements
```

Both keep a **single counter on the plot**, not per player. Cooperative building therefore shares one budget:
the counter that makes player B's request yield is incremented by player A's placements. A mass operation —
paste, mirror, a big blueprint — will visibly stall everyone else building on that plot, and the effective
per-player placement rate falls as builders are added.

This is not a correctness bug and nothing breaks, but it is the most likely source of "co-op building feels
laggy" reports.

**Decided: ship it shared and revisit only on player feedback.** The throttle exists to protect the server,
and per-sender counters would multiply the work one plot can demand by the number of builders. If it does
need revisiting, host priority applies: the host's requests should be served ahead of a guest's when the
budget is contended, rather than splitting the budget evenly.

### 7. Cooperative runtime hazards

- **Stale tool state across players — needs new code.** Nothing currently prunes a selection when its blocks
  are destroyed: `EditTool` clears only on its own operations and on disable. That is safe today because the
  *local* player causes every destruction — their own delete, their own slot load, and ride→build
  regeneration, which disables the tool anyway. Co-op adds the case that cannot happen today: a **remote**
  player destroying blocks while your tool is live, leaving selection, config panel and highlighters holding
  destroyed instances. One subscription pruning destroyed instances from the selection observables covers it;
  it is not per-tool work.
- **Concurrent edits to one block resolve host-first.** Requests land in arrival order today, which under
  host priority is wrong when both touch the same block — the host's edit should stand. Cheapest form: hold
  the guest's request behind any in-flight host request for the same uuid. Either way the loser's config
  panel keeps showing the value it submitted, so the panel should follow the block's replicated config
  rather than its local copy.
- **Limit display is the guest's own.** Whatever UI shows "blocks remaining" reads the local player's
  limits, which under §2 are not the ones being enforced. It must read the host's while on their plot.

**Checked and *not* a problem:**

- **Block uuids cannot collide.** `BuildingPlot` generates them server-side with
  `HttpService.GenerateGUID(false)` when the request omits one, so two builders cannot produce the same id.
- **Achievements need no special handling (decided).** The placement achievement guards with
  `if (p !== player) return;` on `placeBlocks.processed`, so passing the host through the delegation simply
  credits the host and silently skips the guest — which is the accepted behaviour. No extra code.

### 8. Smaller, but real

- **`plot.version`** drives client change notification; confirm nothing assumes a single writer.
- **Client-side undo/history**, if any tool keeps it, becomes wrong when another player mutates the plot —
  a guest's undo could revert the host's work.
- **`AutoPlotWelder`** is per-plot and not player-aware, so it should carry over unchanged; worth confirming
  under concurrent placement.
- **Anti-grief is out of scope by definition** (whitelisting is full trust, including
  `deleteBlocks({ blocks: "all" })`), but instant revocation matters, and it works per-request already.
- **`isBlacklisted`** is unrelated to building (it gates effects and rendering) and needs no change — but a
  player who is both whitelisted and blacklisted is a state worth rejecting at the UI.

## Suggested order

1. `whitelistedPlayers` attribute + settings UI (clone the blacklist trio). Inert on its own.
2. Server delegation: resolve `(plot, buildingPlot, hostId)` per request, apply the check split from §2, and
   widen `isBuildingAllowed`. **Steps 1 and 3 must not ship without this** — the failure mode is silent
   misplacement, not refusal.
3. Client: one subscription driving `targetPlot` in both directions — entering the bounds of a plot you may
   build on selects it; leaving them, or losing permission for any reason (§3), resets to your own. Clear
   tool state on every switch.
4. Explicit ride refusal for guests; block guest building while the host rides.

## One-line summary

"Guest as an extension of the host" fits the existing architecture unusually well — the per-player DI scope
already *is* the context a guest needs to borrow, and losing access is already a replicated state change the
client can watch. The real work is threading that context through eleven handlers and splitting host-checks
from sender-checks correctly; everything else is a small amount of client plumbing.
