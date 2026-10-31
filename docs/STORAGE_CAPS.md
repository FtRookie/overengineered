# Storage caps — design

Status: built 2026-10-30 in all three repositories, untested in a live game. The game-side admin route (step 7) was skipped; grants go through the bot's `/storage` command.

## Decisions

| | Value |
|---|---|
| Per-slot cap | **3.5 MB** — `3_670_016` characters of the slot's JSON |
| Per-player cap | **5 MB** — `5_242_880` characters, summed over the player's slots |
| Grandfathering | A save over a cap still goes through **if it does not grow** what it replaces; shrinking always works. On top, a per-player **storage grant** raises the player cap |
| Autosave / Last exit | **Excluded** from the player cap, still held to the slot cap |
| `lastRun` (`-1`) | Exempt from both. Refusing it would break ride → build restore |
| Test slots (`>= 1_000_000`) | Slot cap applies, excluded from the player cap |

### Why these numbers

- **Slot cap.** Roblox limits a DataStore key to 4,194,304 characters (Creator Docs, *Data stores → error codes and limits*). Slots load DataStore-first, and while the external DB is down a save is queued in the DataStore. A slot larger than the key limit cannot be queued at all (the `setAndSave` failure in `SlotDatabase.setBlocks`). 3.5 MB leaves headroom under that limit.
- **Player cap.** Sized against the DB server's disk (116 GB, 33 GB free on 2026-10-30, database 14.5 GB). It assumes every player fills at least 50% of their cap: large legacy slots include block spam, which nobody judges case by case for now.
  - **Rate of new savers:** about 760 distinct players have saved since `savedAt` shipped on 2026-07-12. That is roughly 2,500 new active savers a year at today's 20–30 concurrent players.
  - **Yearly growth without Autosave and Last exit:** 3 MB → 3.75 GB, **5 MB → 6.25 GB**, 10 MB → 12.5 GB. A player base three times larger triples each figure.
  - **Autosave and Last exit** add up to 2 × 3.5 MB per player outside the cap. Under the 50% assumption that is +3.5 MB each. In practice they are small (recent filled slots average about 60 KB), so they stay excluded.

### Measured distribution (2026-10-30)

Read-only queries on `db_files/database.sqlite` over 1 in 20 players (14,610 players, 30,370 slots). Sizes are `length(data)` of the stored JSON.

| Above | Players | Slots |
|---|---|---|
| 1 MB | 85 | 22 |
| 2 MB | 40 | 6 |
| 4 MB | 15 | 1 |
| 5 MB | 7 (2 of them have saved since July) | 1 |
| 10 MB | 4 | 1 |

- **Averages:** 41 KB and 2.1 slots per player. The full table is 615,890 slots, 289,412 players and 13.7 GB of JSON.
- **Players over 5 MB:** the 7 in the sample hold 12.5% of all stored data.
- **Sampling:** multiply by 20 for the whole database.
- **Legacy rows:** rows from before `savedAt` (99.7% of players) carry no date, and they store JSON with spaces after separators, so their sizes read slightly high.

## Rules

`size` is `JSON.serialize(BlocksSerializer.objectToJson(blocks)).size()`, the same measure the DataStore limit uses. `previous` is the slot's recorded size, or `0` when it is unknown.

```
slot cap    refused if  size > SLOT_CAP   and size > previous
player cap  refused if  others + size > PLAYER_CAP + grant   and size > previous
            (others = sum of recorded sizes of the player's other slots that count toward storage)
```

Since `newTotal - oldTotal = size - previous`, "does not grow the player's total" is the same condition as `size <= previous`. So one comparison covers both ratchets.

**Unknown sizes count as 0.** Slots saved before this ships have no recorded size until they are loaded or saved again. Until then the player total is undercounted, which errs in the player's favour. The recorded size fills in on load, which is what makes the ratchet work for the ~20 legacy slots over 3.5 MB: load it, and re-saving it unchanged is allowed.

## Game (overengineered)

1. **Constants:** add `SLOT_SIZE_CAP = 3_670_016` and `PLAYER_STORAGE_CAP = 5_242_880` to [GameDefinitions.ts](../src/shared/data/GameDefinitions.ts) next to `MAX_SLOTS` (125 slots, none for developers: a ceiling against slot spam, since tiny slots cost almost nothing under the storage cap). They are shared, so a later client usage meter can read them.
2. **Slot metadata:** add `readonly size?: number` to `SlotMeta` in [Responses.ts](../src/shared/types/network/Responses.ts). It is optional, so existing rows and `SlotsMeta.defaultSlot` need no change, and `SlotsMeta.withSlot` / `get` spreads carry it through.
3. **Which slots count:** add `SlotsMeta.countsTowardStorage(index)` to [SlotsMeta.ts](../src/shared/SlotsMeta.ts), returning `index >= 0 && !isTestSlot(index)`.
4. **The grant:** add `readonly storage?: number` (extra bytes, added to the cap) to `PlayerDatabaseData` in [PlayerDatabase.ts](../src/server/database/PlayerDatabase.ts). It is additive, like block grants (`base + limits[id]` in `BlockLimits.ts`). `applyPendingChanges` already lays every pending key over the row, so no new pull code is needed.
5. **Load reports the size:** in [ExternalDatabase.ts](../src/server/database/ExternalDatabase.ts), `GetSave` already holds the concatenated `body`. Return `body.size()` with the value; its two callers are in `SlotDatabase.ts`.
6. **[SlotDatabase.ts](../src/server/database/SlotDatabase.ts) changes:**
   - **`setBlocks`:** after the `datastoreOnlySlots` branch (so `lastRun` is exempt) and before `ExternalDatabase.SaveSlot`:
     - Compute the JSON once and reuse it for `SaveSlot`.
     - Measure `size` and run the rules above.
     - On refusal, return `{ ok: false, error }` with sizes in MB to one decimal, for example "This build is 4.1 MB; a slot holds at most 3.5 MB" and "Your saves use 4.8 of 5.0 MB; this save needs 0.6 MB more". The message reaches the player through `ServerSlotRequestController.saveSlot`.
   - **`stampMeta`:** takes `size` and records it. Callers on the external path and the outbox path both pass it.
   - **`resolveBlocks`:** record the size when the slot is in metadata and the recorded size differs. When the external copy wins, use the `GetSave` body size. When the local DataStore copy wins (rare: outbox or legacy), measure it with the same `JSON.serialize`. Go through a private helper that touches metadata only on a change, because `setMeta` on an offline player saves and frees every slot.
   - **`setBlocksFromAnotherSlot`** (Autosave and Last exit) already goes through `setBlocks`, so it gets the slot cap for free.
7. **Admin path.** `ServerPlayersController.adminGrantBlock` and `CommandController`'s `grant` show the block-grant flow (DB call, then `notifyPendingChanges`). A storage grant from the admin panel would mirror that, using a new `ExternalDatabase.SetStorageGrant`. This step is optional; the bot alone is enough.

## Database (overengineered-database-selfhost)

Mirror the block grant in `Classes/DatabaseInteractions.ts`, using `setBlockLimit` (line ~138) as the template:

- **`setStorageGrant(db, playerID, bytes | undefined)`:** writes `storage` on the row and adds it to `pendingChanges` (`{ ...pendingChanges.get(id), storage }`). `reconcilePush` and `getPendingChanges` are already key-agnostic.
- **Bound:** add a `MAX_STORAGE_GRANT` (suggest 50 MB) so a typo cannot grant terabytes.
- **Routes:**
  - `HttpHandler`: `POST /player/storage` with the token, for the game's admin path.
  - `BotApi`: `PUT` / `DELETE /bot/player/:id/storage`.
- **Tests:** next to `testing/blockLimits.test.ts`.

## Bot (discord-bot)

- **Grant helpers:** `GrantStorage` / `GetStorageGrant` in `src/helpers/Grants.ts`, beside `GrantBlock`. A grant is followed by `RefreshPlayer`, so an online player gets it without rejoining.
- **Command:** `/blocks` takes block ids, so a separate owner-only command (for example `/storage grant user:<name> mb:<n>` / `clear` / `show`) reads better. Use `Honeypot.ts`'s subcommand shape.

## Later, not in scope

- **Usage meter:** a client storage meter in the slots UI ("3.2 / 5.0 MB"). `SlotMeta.size` and the shared constants make it straightforward.
- **Back-filling legacy sizes:** one-off, so totals stop undercounting. The fill-on-load above already converges for active players.
- **Block spam:** judging spam slots is out of scope, which is why the sizing assumes 50% fill.
