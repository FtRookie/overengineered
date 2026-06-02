import { Players } from "@rbxts/services";
import { Db } from "engine/server/Database";
import { isNotAdmin_AutoBanned } from "server/BanAdminExploiter";
import { ExternalDatabase } from "server/database/ExternalDatabase";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { CustomRemotes } from "shared/Remotes";
import { SlotsMeta } from "shared/SlotsMeta";
import type { DatabaseBackend } from "engine/server/backend/DatabaseBackend";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { LatestSerializedBlocks } from "shared/building/BlocksSerializer";

@injectable
export class SlotDatabase {
	private readonly onlinePlayers = new Set<number>();
	private readonly blocksdb;

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

			const id = tostring(plr.UserId);

			for (const [key, { keys }] of this.blocksdb.loadedUnsavedEntries()) {
				if (key.find(id + "_")[0] === undefined) {
					continue;
				}

				$log("Saving " + key);
				this.blocksdb.save(keys, key);
				this.blocksdb.free(keys, key);
			}
		});

		CustomRemotes.admin.adminUpdateMeta.invoked.Connect((invoker, arg) => {
			if (isNotAdmin_AutoBanned(invoker, "adm_update_meta")) return;
			this.setMeta(arg.plrID, this.getMeta(arg.plrID) ?? []);
		});
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
		const get = this.players.get(userId)?.slots;
		if (this.notEmpty(get)) return get;
		const external = ExternalDatabase.GetPlayer(userId)?.slots;
		if (this.notEmpty(external)) return external;
		return [];
	}

	private setMeta(userId: number, slots: readonly SlotMeta[], external?: boolean) {
		this.players.set(userId, { ...this.players.get(userId), slots }, external);

		if (!this.onlinePlayers.has(userId)) {
			for (const slot of slots) {
				this.blocksdb.save([userId, slot.index]);
				this.blocksdb.free([userId, slot.index]);
			}

			$log(`Saving data of the OFFLINE player ${userId}`);
		}
	}

	getBlocks(userId: number, index: number): LatestSerializedBlocks {
		this.ensureValidSlotIndex(userId, index);
		return this.blocksdb.get([userId, index]);
	}
	setBlocks(userId: number, index: number, blocks: LatestSerializedBlocks | undefined) {
		this.ensureValidSlotIndex(userId, index);

		blocks ??= { version: BlocksSerializer.latestVersion, blocks: [] };
		this.blocksdb.set([userId, index], blocks);

		const meta = [...this.getMeta(userId)];
		SlotsMeta.set(meta, {
			...SlotsMeta.get(meta, index),
			blocks: blocks.blocks.size(),
			saveTime: DateTime.now().UnixTimestampMillis,
			index,
		});
		this.setMeta(userId, meta);
	}
	setBlocksFromAnotherSlot(userId: number, index: number, indexfrom: number) {
		this.ensureValidSlotIndex(userId, index);
		this.ensureValidSlotIndex(userId, indexfrom);
		this.blocksdb.set([userId, index], this.getBlocks(userId, indexfrom));

		const meta = [...this.getMeta(userId)];
		SlotsMeta.set(meta, { ...SlotsMeta.get(meta, indexfrom), ...(SlotsMeta.getSpecialNoTest(index) ?? {}), index });
		this.setMeta(userId, meta);
	}

	updateMeta(
		userId: number,
		index: number,
		metaUpdate: (meta: readonly SlotMeta[]) => readonly SlotMeta[],
		external?: boolean,
	): void {
		this.ensureValidSlotIndex(userId, index);

		const meta = metaUpdate(this.getMeta(userId));
		this.setMeta(userId, meta, external);
	}
	delete(userId: number, index: number): void {
		this.ensureValidSlotIndex(userId, index);

		this.blocksdb.delete([userId, index]);
		this.updateMeta(userId, index, (meta) => SlotsMeta.withRemovedSlot(meta, index));
	}
}
