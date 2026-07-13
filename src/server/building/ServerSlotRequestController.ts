import { Component } from "engine/shared/component/Component";
import { ExternalDatabase } from "server/database/ExternalDatabase";
import { BlockConfigStore } from "shared/building/BlockConfigStore";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import { SlotsMeta } from "shared/SlotsMeta";
import type { ExternalRead } from "server/database/ExternalDatabase";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { SlotDatabase } from "server/database/SlotDatabase";
import type { PlayerId } from "server/PlayerId";
import type { LatestSerializedBlocks } from "shared/building/BlocksSerializer";
import type { BuildingPlot } from "shared/building/BuildingPlot";
import type { PlayerDataStorageRemotesSlots } from "shared/remotes/PlayerDataRemotes";

export interface SlotHistoryLoader {
	readonly loadSlotHistory: (
		selv: ServerSlotRequestController,
		{ index }: PlayerLoadSlotRequest,
	) => LoadSlotHistoryResponse;
	readonly loadSlotFromHistory: (
		selv: ServerSlotRequestController,
		{ databaseId, historyId }: PlayerLoadSlotFromHistoryRequest,
	) => LoadSlotResponse;
}

@injectable
export class ServerSlotRequestController extends Component {
	constructor(
		@inject readonly playerId: PlayerId,
		@inject slotRemotes: PlayerDataStorageRemotesSlots,
		@inject readonly blocks: BuildingPlot,

		@inject readonly blockList: BlockList,
		@inject readonly players: PlayerDatabase,
		@inject readonly slots: SlotDatabase,
	) {
		super();

		this.onInject(() => {
			const loader: SlotHistoryLoader = this.getDI().tryResolve<SlotHistoryLoader>() ?? {
				loadSlotHistory: () => ({ success: false, message: "Unavailable" }),
				loadSlotFromHistory: () => ({ success: false, message: "Unavailable" }),
			};

			slotRemotes.loadHistory.subscribe((p, arg) => loader.loadSlotHistory(this, arg));
			slotRemotes.loadFromHistory.subscribe((p, arg) => loader.loadSlotFromHistory(this, arg));
		});

		slotRemotes.load.subscribe((p, arg) => this.loadSlot(arg));
		slotRemotes.save.subscribe((p, arg) => this.saveSlot(p, arg));
		slotRemotes.delete.subscribe((p, arg) => this.deleteSlot(arg));
		slotRemotes.databaseStatus.subscribe(() => ({
			success: true,
			available: ExternalDatabase.isAvailable(),
			dataLoaded: this.players.isDataLoaded(this.playerId),
		}));
	}

	private saveSlot(player: Player, request: PlayerSaveSlotRequest): SaveSlotResponse {
		if (SlotsMeta.isReadonly(request.index)) {
			throw `Slot is readonly while saving ${this.playerId} ${request.index}`;
		}

		$log(`Saving ${this.playerId}'s slot ${request.index}`);

		let output: ResponseResult<SaveSlotResponse> | undefined;
		let externalError: string | undefined;
		const currentMeta = this.players.get(this.playerId).slots ?? [];

		// AWAITED, so a failure is reported instead of papered over with an optimistic `{ success: true }`.
		if (!request.save && !currentMeta.any((c) => c.index === request.index)) {
			// new slot creation
			const created = this.slots.setBlocks(this.playerId, request.index, undefined);
			if (!created.ok) return { success: false, message: created.error };

			output = { blocks: 0 };
		} else if (request.save) {
			const blocks = BlocksSerializer.serializeToObject(this.blocks);

			const written = this.slots.setBlocks(this.playerId, request.index, blocks);
			if (!written.ok) return { success: false, message: written.error };

			// Durable and it will sync, but the player deserves to know it is not on the server yet.
			if (written.durable === "datastore") {
				externalError = "The database is unavailable — this save is queued locally and will sync.";
			}

			output = { blocks: blocks.blocks.size() };
		}

		this.slots.updateMeta(this.playerId, request.index, (meta) => {
			const get = SlotsMeta.get(meta, request.index);
			return SlotsMeta.withSlot(meta, request.index, {
				name: request.name ?? get.name,
				color: request.color ?? get.color,
				touchControls: request.touchControls ?? get.touchControls,
				order: request.order ?? get.order,
			});
		});

		return {
			success: true,
			blocks: output?.blocks,
			externalError,
		};
	}
	private deleteSlot(request: PlayerDeleteSlotRequest): Response {
		if (SlotsMeta.isReadonly(request.index) && !SlotsMeta.isTestSlot(request.index)) {
			throw `Slot is readonly while deleting ${this.playerId} ${request.index}`;
		}

		$log(`Deleting ${this.playerId}'s slot ${request.index}`);

		const deleted = this.slots.delete(this.playerId, request.index);
		if (!deleted.ok) return { success: false, message: deleted.error };

		return { success: true };
	}

	private loadSlot({ index }: PlayerLoadSlotRequest): LoadSlotResponse {
		return this.forceLoadSlot(this.playerId, index);
	}
	private forceLoadSlot(userid: number, index: number): LoadSlotResponse {
		const start = os.clock();

		// Validate BEFORE touching the plot: the old order wiped first, so an unreadable slot annihilated the
		// player's live build, and there is no undo. pcall'd because the datastore read can throw, and a throw
		// out of a remote handler reaches the player as nothing at all.
		const [ok, result] = pcall(() => this.slots.resolveBlocks(userid, index));
		if (!ok) {
			return { success: false, message: `Could not read the slot: ${result}` };
		}

		const resolved = result as ExternalRead<LatestSerializedBlocks>;
		if (!resolved.ok) {
			return { success: false, message: `Could not read the slot: ${resolved.error}` };
		}

		const blocks = resolved.value;
		if (blocks === undefined || blocks.blocks.size() === 0) {
			this.blocks.deleteOperation.execute("all");
			return { success: true, isEmpty: true, configs: {} };
		}

		if (blocks.version === undefined) {
			return { success: false, message: "Corrupted slot data" };
		}
		if (blocks.version > BlocksSerializer.latestVersion) {
			return { success: false, message: "This slot was saved by a newer version of the game" };
		}

		$log(`Loading ${userid}'s slot ${index}`);

		this.blocks.deleteOperation.execute("all");
		const dblocks = BlocksSerializer.deserializeFromObject(blocks, this.blocks, this.blockList);
		$log(`Loaded ${userid} slot ${index} in ${os.clock() - start}`);

		const configs = BlockConfigStore.snapshot(this.blocks.instance.Parent!);
		return { success: true, isEmpty: dblocks === 0, configs };
	}
}
