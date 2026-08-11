# Remotes / Client-Server Communication

Read this for any traffic between client and server, or between clients. Covers every remote class (including
the client-to-client relay), `BlockSynchronizer`, server block logic, middleware, and how tight a validator
must be.

> Extracted from `CLAUDE.md`, which keeps the tripwires and routes here for detail.

All remote types are in `engine/shared/event/PERemoteEvent.ts`. Pick the right class for the direction:

| Class | Direction | Use case |
|---|---|---|
| `C2SRemoteEvent` | Client → Server | Client action that server must handle |
| `S2CRemoteEvent` | Server → Client(s) | Server pushing state to one or all clients |
| `BidirectionalRemoteEvent` | Both (wraps `.c2s` + `.s2c`) | Two-way communication on a single named channel |
| `C2S2CRemoteFunction` | Client → Server → Client (response) | Client requests something and awaits a server response |
| `S2C2SRemoteFunction` | Server → Client → Server (response) | Server asks a client something and awaits a response |
| `C2CRemoteEvent` | Client → all other Clients (via server relay) | Broadcast from one client to others |
| `A2SRemoteEvent` | Anyone → Server | Fires from either side, always received by server |
| `A2OCRemoteEvent` | Anyone → a specific owner Client | Targeted client delivery from any context |

**`BlockSynchronizer`** is the standard tool for syncing block state across all clients. When a client calls `.send(arg)`:
1. Fires `.invoked` locally so the sender updates immediately
2. Sends to server via `c2s`; server validates with runtime type-checking (kicks the player on failure) and runs any middleware
3. Server broadcasts to all other players via `s2c`
4. Newly joined players automatically receive saved state

Use `BlockSynchronizer` for any block property that must be consistent across all clients. Attach it to the block's `logic.events` in the `BlockBuilder`. Because state changes originate from the client and are relayed by the server rather than computed server-side, processing load is shifted to clients — the server acts only as a validator and broadcaster, keeping server overhead low.

**`BlockSynchronizer` API:**

- `.send(arg)` — send from either side; on client fires `.invoked` locally then sends to server; on server broadcasts to all loaded players
- `.sendOrBurn(arg, block)` — like `.send` but calls `block.disableAndBurn()` if `arg` fails the type check
- `.invoked` — read-only signal fired on the client when state arrives (both from local `.send` and from server broadcast)
- `.sendBackToOwner = true` — also send the server-processed value back to the invoking client; use when server middleware transforms the value (e.g. text censoring) and the sender needs the result
- `.getExisting = (stored) => TArg` — override what's replayed to newly joined players; defaults to the last stored value as-is

**Middleware** (server-only; all registered middleware runs in order; return `"dontsend"` to suppress or `{ success: true, value: arg }` to pass through, optionally with a modified `arg`):

- `.addServerMiddleware((invoker, arg) => ...)` — global gate; runs once per send before broadcasting. `invoker` is `undefined` when the server calls `.send()` directly. Use to block the entire broadcast based on the sender's state (e.g. sender's setting is off).
- `.addServerMiddlewarePerPlayer((invoker, player, arg) => ...)` — per-recipient filter; runs once per player per send. Use to suppress or transform delivery for individual recipients (e.g. recipient's setting is off, or either party has blacklisted the other).

See `src/server/blocks/logic/TracerBlockServerLogic.ts` for a canonical two-tier middleware example.

**Server block logic** — blocks that need server-side behaviour (middleware, anti-cheat, server-only services) get a companion class extending `ServerBlockLogic<TBlockLogicCtor>`:

1. Create `src/server/blocks/logic/MyBlockServerLogic.ts`, decorated `@injectable`. The constructor receives the block's client logic class as its first parameter (injected by the controller), then any `@inject` server services. Call `super(logic, playModeController)`.
2. Wire middleware or other server behaviour in the constructor via `logic.events.<synchronizer>.addServerMiddleware(...)`.
3. Import the class in `src/server/blocks/ServerBlockLogicController.ts` and add an entry to `serverBlockLogicRegistry` keyed by the block's id string.

`ServerBlockLogicController` automatically registers a global `addServerMiddleware` on every `logic.events` entry for all blocks that validates the block exists in the workspace and the invoker is in ride mode — this runs before any block-specific middleware, so individual server logic classes don't need to repeat that check. `protected isValidBlock(block, player)` is also available on the base class for ad-hoc checks.

**Anti-spoofing guard in `.invoked` handlers** — the global middleware check covers `addServerMiddleware` handlers only. Direct `.invoked.Connect` listeners (used when the server needs to react to a client event beyond just broadcasting) are NOT covered and must guard manually: always call `if (!this.isValidBlock(block, player)) return;` at the top of any such handler. See `PropellantBlockServerLogic.ts` for the canonical example.

**`isValidBlock` proves ownership, not block type.** It checks that the model exists in the workspace, that the sender is in ride mode, and that the block is on their plot — nothing about *which* block it is. A handler that then indexes children the payload's block type is assumed to have (`WaitForChild("Screen")`, `block.MainPart`) will hang or throw on any other block the sender owns. Resolve rather than index, or validate the type.

## Choosing a remote for block state

**`A2SRemoteEvent` performs no validation whatsoever.** `OnServerEvent` fires `_invoked` with the raw client payload — no type check, no kick, and none of the global block-validity middleware. It is only appropriate for events with no untrusted fields. **Prefer `BlockSynchronizer` for anything carrying block state**: `handleC2S` runs the payload through its `t.Type` and kicks the sender on mismatch, applies the global block-validity middleware, broadcasts to other clients, and replays to players who join later.

**Write the validator as tightly as the input.** A field typed `t.number` where the block's own input clamps to 0–10, or `t.string` where only a handful of values are legal, hands a crafted payload straight to whatever consumes it — and a synchronizer's callback runs on **every receiving client**, so one bad send breaks the block for everyone in the server, not just the sender.

- Mirror input clamps with `t.numberWithBounds(min, max, step?)`. Its bounds ride along as `additional` so a caller can read them back. (Note the guards are `if (min && …)`, which works for `min: 0` only because `0` is truthy in Luau.)
- Never index an enum or lookup table with a loosely-typed field. `Enum.Whatever[payload.field]` yields `nil` for an unknown name, and assigning `nil` to an Enum property raises.
- `t.any.as<T>()` is a **compile-time cast with no runtime effect** — it validates nothing. Neither does `.as<>()` on any other checker.
- Constraints spanning two fields (a buffer whose length must match a `size` field) cannot be expressed in the type; check them at the top of the handler and return.

The codebase carries exactly one deliberate `t.any` (`RadioTransmitterBlock`'s `value`): whether the value is
valid depends on the payload's `valueType` field, which no single-field type can state. It is sound only because
**every receiver checks `t.typeCheck(value, radioValueCheckers[valueType])` before use**
(`RadioReceiverBlock.ts`). Copying the `t.any` without copying the receiver-side check reopens the hole — if you
add a consumer of `RadioSendData`, it must run the same check.

**Every `send` must carry the complete state.** A synchronizer keeps one payload per block and replaces it wholesale rather than merging, and that single payload is all a joining player is replayed. A send carrying only the field that changed leaves late joiners without the rest. Use one `sendAll()`-style helper that always emits the full object, called from every path — `SpeakerBlock` and `LedDisplayBlocks` both do this and say why. For the same reason, prefer one synchronizer carrying complete state over several carrying parts of it: split state also makes replay order depend on declaration order.

**The callback runs on clients, never on the server.** `func` is wired only inside `BlockSynchronizer`'s `IsClient()` branch, and a client's own `send()` fires it locally *before* the round trip — so the sender updates immediately. Put the work that builds or mutates instances there and the server does none of it, which is both the performance argument and the reason a malicious payload cannot make the server do work on its behalf.

**Avoid raw Roblox instances.** The codebase wraps everything — use the provided abstractions rather than reaching for raw Roblox APIs. `ArgsSignal` (a fully custom pure-Lua signal, not a `BindableEvent` wrapper) is the standard for events; `PERemoteEvent` subclasses wrap `RemoteEvent`/`RemoteFunction`; helpers in `engine/shared/` cover most common needs.

**Block damage is server-authoritative.** Block HP lives on the server (`ServerBlockDamageController`); clients never store health. Deal damage by calling `BlockDamageController.instance.applyDamage(block, damage)` on the **owning client** — it accumulates per block and flushes one batched `CustomRemotes.damageSystem.damage` send per frame. Never use a blocking `C2S2CRemoteFunction` for high-frequency events like this (a laser hits every tick) — a fire-and-forget `C2SRemoteEvent`, batched per frame, is the pattern. The server decides breaks and broadcasts `damageSystem.broken`; subscribe to that for client reactions (e.g. TNT chains).

**C2C effects run on every client.** A projectile/effect spawned via `C2CRemoteEvent` is created on the sender *and* every other client. Any side effect that must happen once — applying damage, triggering an explosion — must be gated to the owner (`if (Players.LocalPlayer === this.owner)`), or the server receives it once per player. Thread an `owner: Player` through and gate on it (see `WeaponProjectile`).

**Weapon damage modifiers are sequential, not override (Balatro-style).** `applyModifiers(base, modifiers, key)` in `BaseProjectileLogic.ts` folds an *ordered* list left-to-right: for each modifier carrying that `key`, `value *= mv.value` when `isRelative`, else `value += mv.value`. Order matters — `+5` then `×2` is `(base + 5) * 2`, not `(base + 5×2)`. Each stat (`impactDamage`, `heatDamage`, `explosiveDamage`, `speedModifier`, `lifetimeModifier`) is reduced **independently** over the same ordered list. The per-output list is assembled by `ModuleCollection.recalc` from the module graph in path order: the emitter's own modifier → connected upgrades → the `1/N` split-ratio for multiple outputs. It is *not* a collapse-to-one-value override — an older `calculateTotalModifier` did that and was a bug.

**Server-sent effects need a network-ownable host part.** `ServerEffect.send(part, …)` silently no-ops for anchored parts (`CanSetNetworkOwnership` is false). Prefer an already-replicated part (e.g. the source block). For a position-only effect, create a throwaway part **unanchored**, send, then anchor it in the same synchronous block (no physics step runs between) so it neither falls nor is skipped — a freshly-created part can otherwise arrive `nil` on clients before replication catches up.

**`ChildAdded` fires before a block's descendants replicate.** When a block model is added to a plot's `Blocks` folder, its `PrimaryPart` (and other children) may not exist yet. Don't read them in the `ChildAdded` handler — use `model:GetPivot()` for position, or react to the placement remote's client-side `placeBlocks.completed` signal, which carries the placed models after the round-trip (and only fires for real placements, not world load / ride→build regeneration).
