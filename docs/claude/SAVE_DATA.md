# Save Storage & Versioning

External database vs DataStore routing, and how to add a block-save or player-config version.

> Extracted from `CLAUDE.md`, which keeps the tripwires and routes here for detail.

## Save Storage

The **external database** (`src/server/database/ExternalDatabase.ts`, a Bun/SQLite backend) is the source of truth for slot blocks. The Roblox DataStore is an **outbox** (when the backend is unreachable) and a **legacy fallback** (slots not re-saved since the flip). The player row — slot list, settings, achievements — is the other way round: the DataStore is the write target, and the external db gets a coalesced mirror, because the DataStore dies with the experience and the blocks would otherwise be left with no index.

- **`savedAt`** (wall-clock ms, on the save blob) picks the winner. Absent = oldest. On a tie the DataStore wins.
- **Unreachable backend blocks loads AND automatic writes.** A stale read plus a fresh write stamps the OLD build as newest, and the flusher then destroys the real one. Manual save is allowed behind a multi-stage confirmation and goes to the outbox.
- **A player whose row could not be loaded** may play, but every write for them is refused — `lastRun` excepted, since ride→build restores from it.
- **The backend has no DELETE**: deletion writes an empty blob with a fresh `savedAt` as a tombstone.
- **`lastRun` (-1) never leaves the DataStore.** Quit (-2) and autosave (-3) do go external.
- `SlotDatabase.resolveBlocks` / `setBlocks` are the only entry points; routing is derived from the index so no call site can forget it.

**Studio dev config** lives in **`.env`** (see `.env.example`). `npm install` and `npm run dev` generate `.studioconfig.json` from it — Roblox cannot read `.env`, so the values must arrive as a Rojo-synced ModuleScript. That file is generated, never edited, gitignored, and deliberately outside `src/` because it holds a token. Both keys below are Studio-only.

| `.env` key | effect |
|---|---|
| `WRITETOKEN` | empty = read-only. A token is a live write path to **production** — and a Studio session autosaves and snapshots on exit, so it writes without anyone pressing Save. It also lands inside anything `rojo build` produces (`lune run assemble`, the publish path, ignores JSON and is safe) |
| `DB_BASEURL` | empty = production; point at `npm run dbrelay` (`scripts/dbrelay.js`) if your link cannot pull real saves |

## Save Data & Config Versioning

### Block save data (`src/shared/building/BlocksSerializer.ts`)

Building saves are versioned. Each version is a `const vN` implementing `UpgradableBlocksSerializer<SerializedBlocks<TNew>, typeof vPrev>` with an `upgradeFrom(prev, blockList?)` method. The `current` pointer and `latestVersion` export are derived automatically from the last element of the `versions` array.

To add a new save version:
1. Define `interface SerializedBlockVN extends SerializedBlockVPrev { ... }` if the per-block schema changes (only needed when fields are added/removed/replaced).
2. Create `const vN: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockVN>, typeof vPrev>` with `version: N` and `upgradeFrom`.
3. Append `vN` to the `versions` array.

`upgradeFrom` receives the full `SerializedBlocks<TPrev>` and must return `SerializedBlocks<TNew>`. Add a second `blockList: BlockList` parameter only when live block definitions are needed (e.g. to fill in default config values or resolve wire types). No-op migrations still bump the version and return `{ version: this.version, blocks: prev.blocks }` unchanged.

### Player config (`src/server/PlayerConfigVersioning.ts`)

Player settings (camera, graphics, terrain, etc.) are versioned. Each version is a `const vN` implementing `UpdatablePlayerConfigVersion<TCurrent, TPrev>` with an `update(prev)` method.

**Adding a field needs no version.** Every load runs `Config.addDefaults(data.settings ?? {}, PlayerConfigDefinition)` (`client/PlayerDataStorage.ts`), which walks the definition and fills anything the save is missing — `config[key] ??= def.config` for scalars, `{ ...def.config, ...config[key] }` for nested tables. A new field appears with its definition default on the next load, in every old save, for free. Changing a *default* needs no version either: existing saves keep the value they stored, new ones pick up the new default.

**A version is needed when an existing value has to be reinterpreted**, because `addDefaults` cannot do that:
- **Changing a field's type or shape.** `addDefaults` sees the type mismatch and overwrites with the default, silently discarding the player's setting. `v2` exists precisely for this — `beacons` went from `boolean` to a table, and its `update` carries the old value across as `{ plot: prev.beacons ?? true, players: false }`.
- **Renaming or removing a key.** The old key is left in the saved table and nothing reads it; if you need its value moved somewhere, or want the dead key gone, that is the upgrader's job.
- **Changing what a field means** while keeping its type. Nothing can detect this automatically.

To add one:
1. Define `type PlayerConfigVN = Replace<PlayerConfigVPrev, "field", NewType>` (or `& { readonly newField: T }` if a version is being added for another reason anyway).
2. Create `const vN: UpdatablePlayerConfigVersion<PlayerConfigVN, PlayerConfigVPrev>` with `version: N` and `update`.
3. Append `vN` to `versions`.

`update` receives `Partial<TPrev>` (fields may be absent in old saves) and must return `Partial<TCurrent>`. Always spread `prev` first and set `version: this.version`. Use `PlayerConfigDefinition.<field>.config` for defaults so they stay in sync with the definition source of truth.
