# Game ↔ Bot Integration

How the Roblox game, the Discord bot, and the database backend talk to each other — the constraints that
shaped it, the contract, and the alternatives that were considered and rejected.

Companion doc: `GAME_INTEGRATION.md` at the root of the `discord-bot` repo. The theory is shared, the code
map differs.

---

## 1. The shape

Three nodes, six directed channels:

| Channel | Transport | Status |
|---|---|---|
| **Bot → Game** | Open Cloud `publishMessage` → MessagingService | ✅ built (commands) |
| **Game → Bot** | outbound HTTP → Cloudflare → nginx → Elysia | ✅ built (acknowledgements) |
| **Game → Backend** | outbound HTTP (`ExternalDatabase`) | ✅ pre-existing (saves) |
| Backend → Game | game polls, or Open Cloud | ⬜ not built |
| Bot → Backend | HTTP | ⬜ not built |
| Backend → Bot | HTTP, or bot polls | ⬜ not built |

### The constraint everything follows from

**A Roblox game server has no inbound HTTP.** It can only make outbound requests, or receive via
MessagingService. Bot and Backend are both ordinary HTTP servers and can be called at any time.

So the six channels collapse into three mechanism classes:

- **Into the game** — MessagingService push, or the game polling. No other option exists.
- **Out of the game** — plain outbound HTTP. Trivial.
- **Between bot and backend** — HTTP either way.

Anything that needs to *reach* a game server is therefore either a topic broadcast or a pull. There is no
unicast: **`PublishAsync` delivers to every subscriber of a topic**, never to one chosen server.

---

## 2. Transport: Game → Bot

```
game server ──HTTPS──► Cloudflare ──HTTPS──► nginx :4434 ──HTTP──► Bun 127.0.0.1:1368
              (Full strict)   │ origin rule    │ SNI: bot.ftrookie.com     Elysia
                              │ port → 4434    │ Cloudflare origin cert
```

Layered so each control does one job:

| Layer | Role |
|---|---|
| Cloudflare (Full strict) | public TLS, DDoS, hides the origin |
| ufw (4434 ← Cloudflare ranges only) | origin unreachable except through the edge |
| nginx | TLS termination, SNI vhost routing, reverse proxy |
| Bun bound to `127.0.0.1` | never internet-facing, even if the firewall lapsed |
| `Authorization: Bearer` | proves the caller is the game |
| Elysia schema | rejects malformed payloads at the boundary |

The bot's secret lives in `/etc/discord-bot.env` (root-owned `0600`), injected by systemd's
`EnvironmentFile=` before it drops to the service user — so the process never needs read access to the file.
The game's copy is a `ConfigService` value (`BOTTOKEN`), never in the source tree.

**Ack-only by design.** The endpoint accepts acknowledgements and nothing else. If the secret leaks, the worst
outcome is a forged acknowledgement — never a triggerable action.

---

## 3. The contract

### Command (bot → game, `COMMAND` topic)

```jsonc
{ "id": "<uuid>", "name": "restart", "issuedAt": 1784850639123, "args": { "ttl": 60 } }
```

- `id` — `crypto.randomUUID()`, the bot is the sole issuer, so uniqueness needs no coordination.
- `issuedAt` — **bot-stamped**, so the poll watermark never compares clocks across machines.
- `args` — **nested, not flat.** Per-command payload; each handler narrows its own.
- **Unknown `name` is ignored, never an error** — mid-rollout an old server will receive commands a newer bot
  has just learned to send.

### Acknowledgement (game → bot, `POST /ack/<commandId>`)

```jsonc
{ "jobId": "…", "ok": true, "response": "Warned 7 player(s)", "roster": ["jobId", …] }
```

Uniform for **every** command — status plus a human-readable result — which is why it needs no discriminated
union while the command does. This is the **only** side with a runtime schema, because it is the only place
bytes from outside cross into the bot.

### Roster (`SERVERS` topic)

Each server publishes **only its own jobId**, on boot and every 45s. Receivers stamp arrival time locally and
drop entries unheard for three intervals.

- **Receiver-stamped**, so nothing depends on clocks agreeing between Roblox hosts.
- **Nobody gossips anyone else's list**, so a stale view cannot propagate — an entry survives only while its
  owner keeps asserting it.
- **Discovering a new peer queues one announce, debounced.** A server joining an N-server universe hears N
  unfamiliar jobIds in a burst; announcing per discovery would publish N times in a second.
- **A server whose COMMAND subscription failed does not announce at all** — better invisible than counted and
  unreachable, which would make the bot wait on a server that can never answer.

---

## 4. Delivery guarantees

MessagingService is explicitly best-effort. Three mechanisms compensate, in order of cost:

1. **Push** — normal path, ~1s.
2. **Catch-up poll** — every 30s the game asks `GET /commands?since=<newest issuedAt it holds>`. Anything the
   push dropped arrives late rather than never. **The first successful poll only seeds the watermark** — a
   server that just started must not execute a restart issued before it existed.
3. **Reissue** — at the half-way mark the bot compares acknowledgements against the union of reported rosters
   and re-pushes **the same envelope** once if short.

Two properties make reissue safe and useful:

- **Dedupe suppresses execution, not acknowledgement.** A repeat id re-sends the *cached* result. So a reissue
  repairs a lost acknowledgement as well as a lost command — which is the more common failure.
- **Exactly one reissue.** A wedged or departed server must never block every future command.

The watermark tracks the newest command **received**, not executed — otherwise a command deliberately ignored
(unknown name, or targeted elsewhere) would return on every poll forever.

---

## 5. Decisions, and what was rejected

| Rejected | Why |
|---|---|
| **One topic for roster + commands** | Violates separation of interests and concentrates rate-limit pressure. |
| **Ring / "check your partner" polling** | MessagingService has no unicast — a targeted ping is still a broadcast, so a ring costs **2N** publishes against **N** for plain self-announce, and needs servers to agree on ordering, which is the very roster being built. |
| **Gossiping full rosters** | One server's stale view infects everyone's map, and expiry stops working because peers keep re-asserting ghosts. Also the one place the 1 KiB cap genuinely binds. |
| **Intersection for the head count** | Breaks on *legitimate* asymmetry before any attacker: a server that started seconds ago reports `[self]`, collapsing the denominator to 1. Union is correct here — over-counting costs one wasted reissue, under-counting silently skips a live server. |
| **Registering servers from who polls** | Anyone with the token (or any malformed jobId) would mint phantom servers, each inflating the denominator forever. Existence is attested by **peers**; delivery is pulled by the server. Faking the second gets you nothing. |
| **Flat command fields** | Byte savings were ~9 bytes against 1024 — a non-argument. Nested `args` has no collision surface with envelope fields and lets the envelope be parsed without knowing any command. |
| **Shutting down a populated unreachable server** | `restartServers()` doesn't use MessagingService, so such a server is restarted anyway; killing it delivers the same harm, more often, and even when no restart is pending. Fail-closed *at startup* remains open for discussion. |
| **Publisher-stamped roster times** | Clock skew between hosts causes premature expiry or lingering ghosts. |
| **`maxItems` on the roster array** | A cliff, not a slope: crossing it makes *every* acknowledgement 422. Bounded by request **body size** instead — caps the resource without inventing a limit on how many servers you may run. |

---

## 6. Where the code lives (this repo)

| File | Role |
|---|---|
| `src/server/CommandController.ts` | `SERVERS` roster (announce, debounce, expiry), `COMMAND` subscribe with retry, dispatch + dedupe + ack cache, ack POST, catch-up poll |
| `src/server/AnnouncementController.ts` | Renders announcements to players, countdown text, replay to late joiners. Display only — it no longer decides anything |
| `src/shared/Remotes.ts` | `AnnouncementPayload` (`ttl` drives the countdown and the replay window) |
| `src/server/SandboxGame.ts` | Service registration |

**Command handlers** live in the `handlers` table in `CommandController`. Adding one is a single entry that
narrows its own `args` and returns `{ ok, response? }`. `restart` is the only one so far; it calls
`AnnouncementController.announce(text, display, ttl)` and reports the player count.

Everything is skipped under `RunService.IsStudio()` — Studio must never join the production roster or answer
real commands.

---

## 7. Not built

- **Group C commands** — player-data operations (wipe, migrate, `updateMeta`). These belong on Bot → Backend
  directly; routing them through a live game server is wrong, since the player need not be online.
- **Targeted commands** — the envelope supports them (a command carrying a `userId` is implicitly targeted;
  only the hosting server acts). No handler uses it yet. Expect exactly one acknowledgement, or none if the
  player is offline — a case indistinguishable from delivery failure.
- **Retiring the `announcement` topic.** `/announce` from Discord is now an `announce` command, but the topic
  is still in use: the in-game admin panel (`adminAnnounce` → publish) uses it to fan an announcement out to
  peer servers. That is game→game traffic and does not belong on the bot's command channel — a game-minted
  command id would be unknown to the bot, so every server's acknowledgement would come back `409`.
- **Bot ↔ Backend**, and the logging/telemetry channel that will route through the database backend.
