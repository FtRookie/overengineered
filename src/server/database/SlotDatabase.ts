import { Players } from "@rbxts/services";
import { Db } from "engine/server/Database";
import { isNotAdmin_AutoBanned } from "server/BanAdminExploiter";
import { ExternalDatabase } from "server/database/ExternalDatabase";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { CustomRemotes } from "shared/Remotes";
import { SlotsMeta } from "shared/SlotsMeta";
import type { DatabaseBackend } from "engine/server/backend/DatabaseBackend";
import type { ExternalRead } from "server/database/ExternalDatabase";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { LatestSerializedBlocks } from "shared/building/BlocksSerializer";

/** Where a slot write actually landed — or why it landed nowhere. Never "probably saved". */
export type SlotWriteResult =
	{ readonly ok: true; readonly durable: "external" | "datastore" } | { readonly ok: false; readonly error: string };

/**
 * Within-session scratch, rewritten on EVERY ride start and never read again — HTTP would burn the quota.
 * The quit slot is deliberately NOT here: the datastore dies with the experience, so the last thing we know
 * about a player has to outlive it.
 */
const datastoreOnlySlots = new ReadonlySet<number>([SlotsMeta.lastRunSlotIndex]);

@injectable
export class SlotDatabase {
	private readonly onlinePlayers = new Set<number>();
	private readonly blocksdb;
	/** Queued saves. In memory only: the payload is durable in the datastore either way, and the next server
	 *  backfills it on first read. This only saves the player from having to reopen the slot. */
	private readonly pendingSync = new Set<string>();

	constructor(
		private readonly datastore: DatabaseBackend<
			BlocksSerializer.JsonSerializedBlocks,
			[ownerId: number, slotId: number]
		>,
		@inject private readonly players: PlayerDatabase,
	) {
		this.blocksdb = new Db<
			LatestSerializedBlocks,
			BlocksSerializer.JsonSerializedBlocks,
			[ownerId: number, slotId: number]
		>(
			this.datastore,
			() => ({ version: BlocksSerializer.latestVersion, blocks: [] }),
			(slot) => BlocksSerializer.jsonToObject(slot),
			(slot) => BlocksSerializer.objectToJson(slot),
		);

		Players.PlayerAdded.Connect((plr) => this.onlinePlayers.add(plr.UserId));
		Players.PlayerRemoving.Connect((plr) => {
			this.onlinePlayers.delete(plr.UserId);

			// Roblox Stuido Local Server
			if (plr.UserId <= 0) return;

			// startsWith, not find: `find` matches anywhere, so leaving player 123 also matched key "5123_2".
			const prefix = tostring(plr.UserId) + "_";

			for (const [key, { keys }] of this.blocksdb.loadedUnsavedEntries()) {
				if (!key.startsWith(prefix)) {
					continue;
				}

				$log("Saving " + key);
				// only drop it from the cache if the backend actually took it
				if (this.blocksdb.save(keys, key)) {
					this.blocksdb.free(keys, key);
				}
			}
		});

		// Outbox drain, one slot per tick so a backlog cannot storm the ~500 req/min quota. pcall'd because
		// blocksdb.get() throws on a refused read, and that would kill the thread for the server's lifetime.
		task.spawn(() => {
			while (true as boolean) {
				task.wait(15);

				const [ok, err] = pcall(() => this.drainOne());
				if (!ok) $warn(`Outbox drain failed: ${err}`);
			}
		});

		CustomRemotes.admin.adminMigrateRequest.invoked.Connect((invoker, arg) => {
			if (isNotAdmin_AutoBanned(invoker, "adm_request_migration")) return;

			const result = ExternalDatabase.MigratePlayer(arg.from, arg.to);

			// /migrate rewrites rows UPSTAIRS only, and copies blobs verbatim — so they keep the source's
			// `savedAt`, or none at all for a legacy import. The destination's local copies would win the
			// comparison, hide the migration, and then get flushed back over it. Throw them away.
			if (result.metadata === "SUCCESS" && result.saves === "SUCCESS") {
				this.adoptExternal(arg.to);
			}

			CustomRemotes.admin.adminMigrateReply.send(invoker, result);
		});
		CustomRemotes.admin.adminUpdateMeta.invoked.Connect((invoker, arg) => {
			if (isNotAdmin_AutoBanned(invoker, "adm_update_meta")) return;
			this.setMeta(arg.plrID, this.getMeta(arg.plrID) ?? []);
		});
		// Cuts a player off from their saves — a punishment, not a deletion. The blocks stay in both stores on
		// purpose, so access can be given back. Do not "fix" this into a real wipe.
		CustomRemotes.admin.adminWipeData.invoked.Connect((invoker, plrID) => {
			if (isNotAdmin_AutoBanned(invoker, "adm_wipe_data")) return;
			this.setMeta(plrID, []);
		});
	}

	private ensureValidSlotIndex(userId: number, index: number) {
		if (SlotsMeta.getSpecial(index)) return;

		const pdata = this.players.get(userId);
		const player = Players.GetPlayerByUserId(userId);
		if (!player) return;

		const maxSlots = GameDefinitions.getMaxSlots(player, pdata.purchasedSlots ?? 0);

		if (index >= 0 && index < maxSlots) {
			return;
		}

		if (SlotsMeta.isTestSlot(index)) {
			return;
		}

		throw "Invalid slot index " + index;
	}

	private notEmpty = (arr: readonly SlotMeta[] | undefined): arr is readonly SlotMeta[] =>
		arr !== undefined && arr.size() > 0;

	private getMeta(userId: number) {
		// PlayerDatabase.get already falls back to the external db, so a second fetch here would only yield
		// again and hand back a staler row.
		const slots = this.players.get(userId)?.slots;
		return this.notEmpty(slots) ? slots : [];
	}

	private setMeta(userId: number, slots: readonly SlotMeta[]) {
		this.players.set(userId, { ...this.players.get(userId), slots });

		if (!this.onlinePlayers.has(userId)) {
			for (const slot of slots) {
				if (this.blocksdb.save([userId, slot.index])) {
					this.blocksdb.free([userId, slot.index]);
				}
			}

			$log(`Saving data of the OFFLINE player ${userId}`);
		}
	}

	getBlocks(userId: number, index: number): LatestSerializedBlocks {
		this.ensureValidSlotIndex(userId, index);
		return this.blocksdb.get([userId, index]);
	}

	/**
	 * Newest of the external db (source of truth) and the datastore (outbox + legacy fallback).
	 *
	 * `ok: false` means UNREACHABLE, and callers must NOT quietly serve the datastore copy: a stale read
	 * followed by a save stamps the OLD build as newest, and the flusher then promotes it over the real one.
	 */
	resolveBlocks(userId: number, index: number): ExternalRead<LatestSerializedBlocks> {
		this.ensureValidSlotIndex(userId, index);

		// lastRun never leaves the datastore; no point asking the external db about it.
		if (datastoreOnlySlots.has(index)) {
			const scratch = this.blocksdb.get([userId, index]);
			return { ok: true, value: scratch.blocks.size() > 0 ? scratch : undefined };
		}

		const external = ExternalDatabase.GetSave([userId, index]);
		if (!external.ok) return external;

		const stored = this.blocksdb.get([userId, index]);

		// An empty blob WITH a `savedAt` is a real value — a tombstone, or an untouched new slot. Judging by
		// block count alone would let a tombstone lose to the build it exists to erase.
		const hasStored = stored.blocks.size() > 0 || stored.savedAt !== undefined;

		// Answered, no slot upstairs: the legacy path. This is what the backfill exists for — push it up and
		// reclaim the room, or legacy slots sit in the datastore forever.
		if (external.value === undefined) {
			if (!hasStored) return { ok: true, value: undefined };

			this.syncToExternal(userId, index, stored);
			return { ok: true, value: stored };
		}

		if (!hasStored) return { ok: true, value: external.value };

		// Legacy blobs have no `savedAt` and count as oldest. Ties go to the datastore: it was the de-facto
		// write target all along.
		const externalAt = external.value.savedAt ?? 0;
		const storedAt = stored.savedAt ?? 0;

		if (storedAt >= externalAt) {
			// The local copy won, so it belongs upstairs. Push it and reclaim the room.
			this.syncToExternal(userId, index, stored);
			return { ok: true, value: stored };
		}

		return { ok: true, value: external.value };
	}

	/**
	 * Takes the external db's word for everything, discarding every local copy. Only for an admin migration,
	 * which happens entirely upstairs — the one place where "the datastore might be newer" is a lie.
	 */
	private adoptExternal(userId: number): void {
		const row = ExternalDatabase.GetPlayer(userId);
		if (!row.ok) {
			$warn(`Could not adopt ${userId}'s migrated row: ${row.error}`);
			return;
		}

		// Both sides' indices: the pre-migration ones are stale, and a local blob at a migrated index would
		// win the savedAt tie.
		const indices = new Set<number>();
		for (const slot of this.getMeta(userId)) {
			indices.add(slot.index);
		}
		for (const slot of row.value?.slots ?? []) {
			indices.add(slot.index);
		}

		for (const index of indices) {
			this.pendingSync.delete(`${userId}_${index}`);
			this.blocksdb.delete([userId, index]);
		}

		this.players.adopt(userId, row.value ?? {});
		$log(`Adopted ${userId}'s migrated data and dropped ${indices.size()} local slot copies`);
	}

	/** One tick of the outbox drain. */
	private drainOne(): void {
		const pending = this.pendingSync.first();
		if (pending === undefined) return;

		const [rawUser, rawIndex] = pending.split("_");
		const userId = tonumber(rawUser);
		const index = tonumber(rawIndex);
		if (userId === undefined || index === undefined) {
			this.pendingSync.delete(pending);
			return;
		}

		// The queued copy is not automatically the winner: a newer save may have landed upstairs since, from
		// this server or another. Blindly pushing would overwrite it — and a queued tombstone would erase a
		// slot the player has since rebuilt. Same rule as a read.
		const external = ExternalDatabase.GetSave([userId, index]);
		if (!external.ok) return; // still down — leave it queued and retry on the next tick

		const stored = this.blocksdb.get([userId, index]);

		// Empty and no `savedAt` is just the cache default for an absent key: already reclaimed. Empty WITH
		// one is a real value (tombstone, or an untouched new slot) and still has to go up.
		if (stored.blocks.size() === 0 && stored.savedAt === undefined) {
			this.pendingSync.delete(pending);
			return;
		}

		if (external.value !== undefined && (external.value.savedAt ?? 0) > (stored.savedAt ?? 0)) {
			// Upstairs is newer. The queued copy is stale: drop it rather than push it.
			this.pendingSync.delete(pending);
			this.blocksdb.delete([userId, index]);
			return;
		}

		// Leaves the entry queued on failure, so it is retried on the next tick.
		this.syncToExternal(userId, index, stored);
	}

	/**
	 * The whole flusher: draining the outbox, backfilling a legacy slot and freeing datastore room are all
	 * "the local copy is newer, so it belongs upstairs". Only dropped once the backend confirms.
	 */
	private syncToExternal(userId: number, index: number, blocks: LatestSerializedBlocks): boolean {
		const result = ExternalDatabase.SaveSlot(userId, {
			index,
			blocks: BlocksSerializer.objectToJson(blocks),
		});

		if (!result.ok) {
			$warn(`Could not sync ${userId}'s slot ${index} upstream: ${result.error}`);
			return false;
		}

		// Confirmed upstairs, so the datastore copy is dead weight — and that store is the one running out.
		this.blocksdb.delete([userId, index]);
		this.pendingSync.delete(`${userId}_${index}`);

		$log(`Synced ${userId}'s slot ${index} upstream and reclaimed the datastore copy`);
		return true;
	}
	private stampMeta(userId: number, index: number, blocks: LatestSerializedBlocks) {
		const meta = [...this.getMeta(userId)];
		SlotsMeta.set(meta, {
			...SlotsMeta.get(meta, index),
			blocks: blocks.blocks.size(),
			saveTime: DateTime.now().UnixTimestampMillis,
			index,
		});
		this.setMeta(userId, meta);
	}

	/**
	 * Everything but `lastRun` goes to the external db, quit and autosave included. SYNCHRONOUS, so the
	 * player is told the truth instead of an optimistic "saved"; a down backend falls back to the outbox.
	 * Routing comes from the index, not the caller, so no call site can forget it.
	 */
	setBlocks(userId: number, index: number, blocks: LatestSerializedBlocks | undefined): SlotWriteResult {
		this.ensureValidSlotIndex(userId, index);

		// We never learned what this player owns, so we cannot know what we would overwrite. lastRun is exempt:
		// ride -> build restores from it, so refusing that write would delete the build we are protecting.
		if (!datastoreOnlySlots.has(index) && !this.players.isDataLoaded(userId)) {
			return { ok: false, error: "Your saves could not be loaded, so nothing can be written yet" };
		}

		blocks ??= {
			version: BlocksSerializer.latestVersion,
			blocks: [],
			savedAt: DateTime.now().UnixTimestampMillis,
		};

		if (datastoreOnlySlots.has(index)) {
			// Fire-and-forget: Db retries a failed write instead of dropping it, and nobody awaits the answer.
			this.blocksdb.set([userId, index], blocks);
			this.stampMeta(userId, index, blocks);

			return { ok: true, durable: "datastore" };
		}

		const external = ExternalDatabase.SaveSlot(userId, {
			index,
			blocks: BlocksSerializer.objectToJson(blocks),
		});

		if (external.ok) {
			// A local copy left behind is not just dead weight: queued, the drain would push it back over this
			// very save, and a queued tombstone would erase the build we just wrote.
			this.pendingSync.delete(`${userId}_${index}`);
			this.blocksdb.delete([userId, index]);

			this.stampMeta(userId, index, blocks);
			return { ok: true, durable: "external" };
		}

		// Outbox. Freshest `savedAt`, so both the flusher and resolveBlocks see it as the winner.
		this.pendingSync.add(`${userId}_${index}`);

		if (!this.blocksdb.setAndSave([userId, index], blocks)) {
			// Neither store took it: an oversized build blows the 4MB key limit. This used to vanish silently.
			return {
				ok: false,
				error: "The database is unavailable, and this build is too large to queue locally",
			};
		}

		this.stampMeta(userId, index, blocks);
		return { ok: true, durable: "datastore" };
	}
	/** Only ever quit/autosave <- lastRun. The source reads from the datastore; the target is a real slot,
	 *  so the write goes upstairs like any other. */
	setBlocksFromAnotherSlot(userId: number, index: number, indexfrom: number): SlotWriteResult {
		this.ensureValidSlotIndex(userId, index);
		this.ensureValidSlotIndex(userId, indexfrom);

		const source = this.resolveBlocks(userId, indexfrom);
		if (!source.ok) return { ok: false, error: source.error };
		if (source.value === undefined) return { ok: false, error: `Slot ${indexfrom} is empty` };

		// The copy needs its own `savedAt`, or it loses to whatever already sits in the target.
		const copy: LatestSerializedBlocks = { ...source.value, savedAt: DateTime.now().UnixTimestampMillis };

		const written = this.setBlocks(userId, index, copy);
		if (!written.ok) return written;

		const meta = [...this.getMeta(userId)];
		SlotsMeta.set(meta, { ...SlotsMeta.get(meta, indexfrom), ...(SlotsMeta.getSpecialNoTest(index) ?? {}), index });
		this.setMeta(userId, meta);

		return written;
	}

	updateMeta(userId: number, index: number, metaUpdate: (meta: readonly SlotMeta[]) => readonly SlotMeta[]): void {
		this.ensureValidSlotIndex(userId, index);
		this.setMeta(userId, metaUpdate(this.getMeta(userId)));
	}

	/**
	 * The backend has no DELETE, so the tombstone is an empty blob with a fresh `savedAt`. Dropping only the
	 * datastore copy would delete nothing: resolveBlocks would find the slot upstairs and hand it right back.
	 */
	delete(userId: number, index: number): SlotWriteResult {
		this.ensureValidSlotIndex(userId, index);

		if (!this.players.isDataLoaded(userId)) {
			return { ok: false, error: "Your saves could not be loaded, so nothing can be deleted yet" };
		}

		const forget = () => this.updateMeta(userId, index, (meta) => SlotsMeta.withRemovedSlot(meta, index));

		if (datastoreOnlySlots.has(index)) {
			this.blocksdb.delete([userId, index]);
			forget();

			return { ok: true, durable: "datastore" };
		}

		const tombstone: LatestSerializedBlocks = {
			version: BlocksSerializer.latestVersion,
			blocks: [],
			savedAt: DateTime.now().UnixTimestampMillis,
		};

		const external = ExternalDatabase.SaveSlot(userId, {
			index,
			blocks: BlocksSerializer.objectToJson(tombstone),
		});

		if (external.ok) {
			this.blocksdb.delete([userId, index]);
			forget();

			return { ok: true, durable: "external" };
		}

		// The local copy now IS the deletion, so unlike the happy path it must not be dropped.
		if (!this.blocksdb.setAndSave([userId, index], tombstone)) {
			return { ok: false, error: `Could not delete the slot: ${external.error}` };
		}

		this.pendingSync.add(`${userId}_${index}`);
		forget();

		return { ok: true, durable: "datastore" };
	}
}
