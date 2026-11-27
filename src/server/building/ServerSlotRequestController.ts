import { HttpService, Players } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { PERemoteEventMiddlewares } from "engine/shared/event/PERemoteEvent";
import { BB } from "engine/shared/fixes/BB";
import { PlayerRank } from "engine/shared/PlayerRank";
import { t } from "engine/shared/t";
import { ExternalDatabase } from "server/database/ExternalDatabase";
import { DatabaseLoader } from "server/database/ExternalDatabaseLoader";
import { BlockConfigStore } from "shared/building/BlockConfigStore";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import { SharedBuilding } from "shared/building/SharedBuilding";
import { SharedPlots } from "shared/building/SharedPlots";
import { SlotsMeta } from "shared/SlotsMeta";
import type { ExternalRead } from "server/database/ExternalDatabase";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { SlotDatabase } from "server/database/SlotDatabase";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { PlayerId } from "server/PlayerId";
import type { LatestSerializedBlocks } from "shared/building/BlocksSerializer";
import type { LatestSerializedBlock } from "shared/building/BlocksSerializer";
import type { BuildingPlot } from "shared/building/BuildingPlot";
import type { PlayerDataStorageRemotesSlots } from "shared/remotes/PlayerDataRemotes";

// Active request per-player
interface ImportRequest {
	reqId: string;
	blocks: LatestSerializedBlock[];
	issues: {
		invalidBlocks: Record<string, number>;
		wouldOverwrite: boolean;
	};
	expiresAt: number;
}

const adminOverwrites = (player: Player, index: number) =>
	SlotsMeta.isAdminOverwritable(index) && (PlayerRank.isDev(player) || PlayerRank.isMod(player));

const exportSlotRequest = t.interface({
	mode: t.union(t.const("reference"), t.const("static")),
	creatorId: t.string,
	slotIndex: t.union(t.number, t.const("current")),
	whitelist: t.array(t.string),
	blacklist: t.array(t.string),
	isPublic: t.boolean,
	expiration: t.union(t.const("5m"), t.const("1h"), t.const("1d"), t.const("7d"), t.const("30d"), t.const("forever")),
});
const importSlotValidateRequest = t.interface({
	payloadString: t.string,
});
const importSlotExecuteRequest = t.interface({
	reqId: t.string,
	options: t.interface({
		skipInvalidBlocks: t.boolean,
	}),
});

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

// Store a list of active requests, mapped to and 1 per player
const pendingImportRequests = new Map<Player, ImportRequest>();
Players.PlayerRemoving.Connect((plr) => pendingImportRequests.delete(plr));

@injectable
export class ServerSlotRequestController extends Component {
	/** The slot the plot's build came from, set by a load or a save like the client's `loadedSlot` */
	private loadedIndex?: number;

	constructor(
		@inject readonly playerId: PlayerId,
		@inject readonly slotRemotes: PlayerDataStorageRemotesSlots,
		@inject readonly blocks: BuildingPlot,

		@inject readonly blockList: BlockList,
		@inject readonly players: PlayerDatabase,
		@inject readonly slots: SlotDatabase,
		@inject readonly databaseLoader: DatabaseLoader,
		@inject readonly playModeController: PlayModeController,
	) {
		super();

		this.onInject(() => {
			const loader: SlotHistoryLoader = this.getDI().tryResolve<SlotHistoryLoader>() ?? {
				loadSlotHistory: () => ({ success: false, message: "Unavailable" }),
				loadSlotFromHistory: () => ({ success: false, message: "Unavailable" }),
			};

			slotRemotes.loadHistory.subscribe((p, arg) => loader.loadSlotHistory(this, arg));
			slotRemotes.loadFromHistory.subscribe((p, arg) => {
				const response = loader.loadSlotFromHistory(this, arg);
				if (response.success && !response.isEmpty) this.loadedIndex = undefined;

				return response;
			});
		});

		slotRemotes.load.subscribe((p, arg) => {
			const response = this.loadSlot(arg);
			if (response.success && !response.isEmpty) this.loadedIndex = arg.index;

			return response;
		});
		slotRemotes.save.subscribe((p, arg) => this.saveSlot(p, arg));
		slotRemotes.delete.subscribe((p, arg) => this.deleteSlot(p, arg));
		slotRemotes.databaseStatus.subscribe(() => ({
			success: true,
			available: ExternalDatabase.isAvailable(),
			dataLoaded: this.players.isDataLoaded(this.playerId),
		}));

		slotRemotes.exportSlot.addMiddleware(PERemoteEventMiddlewares.rateLimiter(10, 60));
		slotRemotes.exportSlot.subscribe((p, args) => {
			const result = t.newResult();
			if (!t.typeCheck(args, exportSlotRequest, result)) {
				return { success: false, message: result.toString() };
			}
			return this.exportSlot(p, args);
		});

		slotRemotes.importSlotValidate.addMiddleware(PERemoteEventMiddlewares.rateLimiter(10, 60));
		slotRemotes.importSlotValidate.subscribe((p, args) => {
			const result = t.newResult();
			if (!t.typeCheck(args, importSlotValidateRequest, result)) {
				return { success: false, message: result.toString() };
			}
			return this.importSlotValidate(p, args);
		});
		slotRemotes.importSlotExecute.addMiddleware(PERemoteEventMiddlewares.rateLimiter(10, 60));
		slotRemotes.importSlotExecute.subscribe((p, args) => {
			const result = t.newResult();
			if (!t.typeCheck(args, importSlotExecuteRequest, result)) {
				return { success: false, message: result.toString() };
			}
			return this.importSlotExecute(p, args);
		});
	}

	private saveSlot(player: Player, request: PlayerSaveSlotRequest): SaveSlotResponse {
		if (request.locked !== undefined && !t.typeCheck(request.locked, t.boolean)) {
			return { success: false, message: "Invalid lock state" };
		}
		if (SlotsMeta.isReadonly(request.index) && !adminOverwrites(player, request.index)) {
			throw `Slot is readonly while saving ${this.playerId} ${request.index}`;
		}

		$log(`Saving ${this.playerId}'s slot ${request.index}`);

		let output: ResponseResult<SaveSlotResponse> | undefined;
		let externalError: string | undefined;
		const currentMeta = this.players.get(this.playerId).slots ?? [];
		if (request.save && SlotsMeta.get(currentMeta, request.index).locked) {
			return { success: false, message: "This slot is locked" };
		}

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
			this.loadedIndex = request.index;
		}

		this.slots.updateMeta(this.playerId, request.index, (meta) => {
			const get = SlotsMeta.get(meta, request.index);
			return SlotsMeta.withSlot(meta, request.index, {
				name: request.name ?? get.name,
				color: request.color ?? get.color,
				touchControls: request.touchControls ?? get.touchControls,
				order: request.order ?? get.order,
				locked: request.locked ?? get.locked,
			});
		});

		return {
			success: true,
			blocks: output?.blocks,
			stored: SlotsMeta.get(this.players.get(this.playerId).slots ?? [], request.index).stored,
			externalError,
		};
	}
	/** Gives `index`, a slot the plot's build was just copied into, the touch button layout of the slot it came from */
	copyLayoutTo(index: number) {
		const from = this.loadedIndex;
		if (from === undefined || from === index) return;

		this.slots.updateMeta(this.playerId, index, (meta) =>
			SlotsMeta.withSlot(meta, index, { touchControls: SlotsMeta.get(meta, from).touchControls }),
		);
	}

	private deleteSlot(player: Player, request: PlayerDeleteSlotRequest): Response {
		const deletable = SlotsMeta.isTestSlot(request.index) || adminOverwrites(player, request.index);
		if (SlotsMeta.isReadonly(request.index) && !deletable) {
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

		// Validate BEFORE touching the plot: wiping first would let an unreadable slot destroy the live build, with
		// no undo. pcall'd because the datastore read can throw, and a throw out of a remote handler reaches the
		// player as nothing at all.
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

		const configs = BlockConfigStore.snapshot(this.blocks.instance);
		return { success: true, isEmpty: dblocks === 0, configs };
	}

	private exportSlot(player: Player, args: PlayerExportSlotRequest): ExportSlotResponse {
		// Make sure the player sending the request is the owner
		if (args.creatorId !== tostring(player.UserId)) {
			return { success: false, message: "Player invalid" };
		}
		$log(`Encoding packet for ${player.UserId}'s slot ${args.slotIndex}`);
		try {
			const encodeResult = this.databaseLoader.encodePacket(this.blocks, player, args);
			if (encodeResult.success) return { success: true, data: encodeResult.packetString };
			else return { success: false, message: encodeResult.error };
		} catch (err) {
			$warn(`Error while encoding packet: ${err}`);
			return { success: false, message: tostring(err) };
		}
	}

	private importSlotValidate(
		player: Player,
		args: PlayerImportSlotValidateRequest,
	): PlayerImportSlotValidateResponse {
		try {
			$log("Server validating import slot..");
			const decodeResult = DatabaseLoader.string2packet(args.payloadString);
			if (!decodeResult.success) {
				$warn("String is not valid packet");
				return { success: false, message: "String is not valid packet" };
			}

			const checkResult = DatabaseLoader.checkPacket(decodeResult.data);
			if (!checkResult.success) {
				$warn("Packet check error:", checkResult.error);
				return { success: false, message: checkResult.error };
			}
			const payload = checkResult.payload;

			const accessResult = DatabaseLoader.packetCheckAccess(player, payload);
			if (!accessResult.success) {
				$warn("Packet access error:", accessResult.reason);
				return { success: false, message: accessResult.reason };
			}

			const playerPlot = SharedPlots.instance.tryGetPlotByOwnerID(player.UserId)!;

			$log("Loading " + payload.body.mode + " for player " + player.DisplayName);
			const ownerId = tonumber(payload.creatorId);
			if (!ownerId || ownerId < 1) return { success: false, message: "Invalid creatorId" };

			const blockResult = this.databaseLoader.getBlocksForPacket(payload);
			if (!blockResult.success) return { success: false, message: blockResult.error };

			// Compute issues
			const wouldOverwrite = playerPlot.getBlocks().size() > 0;
			const invalidBlocks: Record<string, number> = {};

			for (const block of blockResult.blocks) {
				if (this.blockList.blocks[block.id] === undefined) {
					invalidBlocks[block.id] = (invalidBlocks[block.id] ?? 0) + 1;
				}
			}

			// Generate reqId and store request
			// the server only stores the most recent ID, so an outdated one is detected
			const reqId = HttpService.GenerateGUID(false);
			const importRequest: ImportRequest = {
				reqId,
				blocks: blockResult.blocks as LatestSerializedBlock[],
				issues: {
					invalidBlocks,
					wouldOverwrite,
				},
				expiresAt: os.clock() + 120, // 120 second TTL
			};

			// this also overwrites/removes any existing ones
			pendingImportRequests.set(player, importRequest);

			return {
				success: true,
				reqId,
				issues: {
					invalidBlocks,
					wouldOverwrite,
				},
			};
		} catch (err) {
			$warn("Error while validating import slot:", err);
			return { success: false, message: tostring(err) };
		}
	}

	private importSlotExecute(player: Player, args: PlayerImportSlotExecuteRequest): PlayerImportSlotExecuteResponse {
		try {
			const req = pendingImportRequests.get(player);
			if (!req || req.reqId !== args.reqId)
				return { success: false, message: "Invalid or expired import request" };
			// reject/delete if expired
			if (req.expiresAt < os.clock()) {
				pendingImportRequests.delete(player);
				return { success: false, message: "Import request expired" };
			}

			const playerPlot = SharedPlots.instance.tryGetPlotByOwnerID(player.UserId)!;

			// Filter blocks per options
			let blocks = req.blocks;
			if (args.options.skipInvalidBlocks) {
				blocks = blocks.filter((b) => this.blockList.blocks[b.id] !== undefined);
			}

			// Disconnect wires to missing blocks
			const keptIds = new Set(blocks.map((b) => b.uuid));
			blocks = blocks.map((b) => {
				if (!b.config) return b;
				let config = b.config;
				for (const [name, cfg] of pairs(b.config)) {
					if (cfg.type === "wire" && !keptIds.has(cfg.config.blockUuid)) {
						config = SharedBuilding.withLogicDisconnected(config, name as BlockConnectionName);
					}
				}
				return { ...b, config };
			});
			if (blocks.size() === 0) return { success: false, message: "Blocks is empty" };

			// Calculate bounds and shift if needed
			const bbs = blocks.mapFiltered((b) => {
				const model = this.blockList.blocks[b.id]?.model;
				if (!model) return; // unknown block id

				return BB.fromModel(model) //
					.withCenter(playerPlot.origin.ToWorldSpace(b.location))
					.withSize((s) => s.mul(b.scale ?? Vector3.one));
			});
			if (!bbs || bbs.size() === 0) return { success: false, message: "Failed to calculate bounding box" };
			const blocksBB = BB.fromBBs(bbs, playerPlot.bounds.center);

			const getInBoundsShift = (build: BB, plot: BB, plotOrigin: CFrame): Vector3 | undefined => {
				// If it already fits fine
				if (plot.isBBInside(build)) return Vector3.zero;

				const fitAxis = (c: number, bh: number, ph: number): number => {
					const lo = -ph - (c - bh); // smallest shift that clears the min edge
					const hi = ph - (c + bh); // largest shift that clears the max edge

					if (lo <= 0 && hi >= 0) return 0; // this axis is already inside
					if (lo > 0 && math.ceil(lo) <= hi) return math.ceil(lo);
					if (hi < 0 && math.floor(hi) >= lo) return math.floor(hi);

					return -c; // no whole-stud move fits, center this axis
				};

				const bh = build.originalSize.div(2);
				const ph = plot.originalSize.div(2);
				if (bh.X > ph.X || bh.Y > ph.Y || bh.Z > ph.Z) return; // can't fit at all

				// build was made aligned to plot.center, so work in plot-local space
				const c = plot.center.ToObjectSpace(build.center).Position;
				const localPos = new Vector3(
					fitAxis(c.X, bh.X, ph.X),
					fitAxis(c.Y, bh.Y, ph.Y),
					fitAxis(c.Z, bh.Z, ph.Z),
				);

				return plotOrigin.VectorToObjectSpace(plot.center.VectorToWorldSpace(localPos));
			};

			let wasShifted = false;
			const shift = getInBoundsShift(blocksBB, playerPlot.bounds, playerPlot.origin);
			if (!shift) {
				return { success: false, message: "Build does not fit in plot" };
			}

			if (shift.Magnitude > 0) {
				blocks = blocks.map((b) => ({ ...b, location: new CFrame(shift).mul(b.location) }));
				wasShifted = true;
			}

			const deserializedData = blocks.map((b) =>
				BlocksSerializer.serializedBlockToPlaceRequest(b, playerPlot.origin),
			);

			if (this.playModeController.getPlayerMode(player) !== "build") {
				return { success: false, message: "Player is not in build mode" };
			}

			this.blocks.deleteOperation.execute("all");
			const placeResponse = this.blocks.multiPlaceOperation.execute(deserializedData);
			if (!placeResponse.success) {
				error(`Could not place blocks: ${placeResponse.message}`);
			}

			const configs = BlockConfigStore.snapshot(this.blocks.instance);

			// Clean up request
			pendingImportRequests.delete(player);

			return { success: true, configs, wasShifted };
		} catch (err) {
			$warn("Error while executing import slot:", err);
			return { success: false, message: tostring(err) };
		}
	}
}
