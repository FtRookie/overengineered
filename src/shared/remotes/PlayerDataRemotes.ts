import { C2S2CRemoteFunction } from "engine/shared/event/PERemoteEvent";
import { C2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { PlayerRemotes } from "engine/shared/PlayerRemotes";

export type PlayerDataStorageRemotesBuilding = {
	readonly placeBlocks: C2S2CRemoteFunction<PlaceBlocksRequest, MultiBuildResponse>;
	readonly deleteBlocks: C2S2CRemoteFunction<DeleteBlocksRequest>;
	readonly editBlocks: C2S2CRemoteFunction<EditBlocksRequest>;
	readonly logicConnect: C2S2CRemoteFunction<LogicConnectRequest>;
	readonly logicDisconnect: C2S2CRemoteFunction<LogicDisconnectRequest>;
	readonly paintBlocks: C2S2CRemoteFunction<PaintBlocksRequest>;
	readonly updateConfig: C2S2CRemoteFunction<ConfigUpdateRequest>;
	readonly updateCustomData: C2S2CRemoteFunction<CustomDataUpdateRequest>;
	readonly resetConfig: C2S2CRemoteFunction<ConfigResetRequest>;
	readonly weld: C2S2CRemoteFunction<WeldRequest>;
	readonly recollide: C2S2CRemoteFunction<RecollideRequest>;
};
export type PlayerDataStorageRemotesSlots = {
	readonly load: C2S2CRemoteFunction<PlayerLoadSlotRequest, LoadSlotResponse>;
	readonly save: C2S2CRemoteFunction<PlayerSaveSlotRequest, SaveSlotResponse>;
	readonly delete: C2S2CRemoteFunction<PlayerDeleteSlotRequest, Response>;
	readonly loadHistory: C2S2CRemoteFunction<PlayerLoadSlotRequest, LoadSlotHistoryResponse>;
	readonly loadFromHistory: C2S2CRemoteFunction<PlayerLoadSlotFromHistoryRequest, LoadSlotResponse>;
	/**
	 * `available` — is the database reachable? Asked BEFORE a manual save: while it is down we cannot show
	 * the player what they are about to overwrite, so the client escalates to a multi-step confirmation.
	 *
	 * `dataLoaded` — did THIS player's saves load at all? False means the server has no idea what they own
	 * and is refusing every write for them, so the client warns them before they build for an hour.
	 */
	readonly databaseStatus: C2S2CRemoteFunction<
		undefined,
		Response<{ readonly available: boolean; readonly dataLoaded: boolean }>
	>;
};
export type PlayerDataStorageRemotesPlayer = {
	readonly updateSettings: C2SRemoteEvent<PlayerUpdateSettingsRequest>;
	readonly updateData: C2SRemoteEvent<PlayerUpdateDataRequest>;
	readonly fetchData: C2S2CRemoteFunction<undefined, Response<PlayerDataResponse>>;
};
export type PlayerDataStorageRemotes = {
	readonly building: PlayerDataStorageRemotesBuilding;
	readonly slots: PlayerDataStorageRemotesSlots;
	readonly player: PlayerDataStorageRemotesPlayer;
};

export namespace PlayerDataRemotes {
	export function createSlots(folder: Instance): PlayerDataStorageRemotesSlots {
		return PlayerRemotes.fromFolder(folder, (get) => ({
			load: new C2S2CRemoteFunction(get("slots_load", "RemoteFunction")),
			save: new C2S2CRemoteFunction(get("slots_save", "RemoteFunction")),
			delete: new C2S2CRemoteFunction(get("slots_delete", "RemoteFunction")),
			loadHistory: new C2S2CRemoteFunction(get("slots_loadHistory", "RemoteFunction")),
			loadFromHistory: new C2S2CRemoteFunction(get("slots_loadFromHistory", "RemoteFunction")),
			databaseStatus: new C2S2CRemoteFunction(get("slots_dbstatus", "RemoteFunction")),
		}));
	}
	export function createPlayer(folder: Instance): PlayerDataStorageRemotesPlayer {
		return PlayerRemotes.fromFolder(folder, (get) => ({
			updateSettings: new C2SRemoteEvent(get("player_updsettings", "RemoteEvent")),
			updateData: new C2SRemoteEvent(get("player_upddata", "RemoteEvent")),
			fetchData: new C2S2CRemoteFunction(get("player_fetchdata", "RemoteFunction")),
		}));
	}
	export function createBuilding(folder: Instance): PlayerDataStorageRemotesBuilding {
		return PlayerRemotes.fromFolder(folder, (get) => ({
			placeBlocks: new C2S2CRemoteFunction<PlaceBlocksRequest, MultiBuildResponse>(
				get("building_place", "RemoteFunction"),
			),
			deleteBlocks: new C2S2CRemoteFunction(get("building_delete", "RemoteFunction")),
			editBlocks: new C2S2CRemoteFunction(get("building_edit", "RemoteFunction")),
			logicConnect: new C2S2CRemoteFunction(get("building_lconnect", "RemoteFunction")),
			logicDisconnect: new C2S2CRemoteFunction(get("building_ldisconnect", "RemoteFunction")),
			paintBlocks: new C2S2CRemoteFunction(get("building_paint", "RemoteFunction")),
			updateConfig: new C2S2CRemoteFunction(get("building_updatecfg", "RemoteFunction")),
			updateCustomData: new C2S2CRemoteFunction(get("building_updatecdt", "RemoteFunction")),
			resetConfig: new C2S2CRemoteFunction(get("building_resetcfg", "RemoteFunction")),
			weld: new C2S2CRemoteFunction(get("building_weld", "RemoteFunction")),
			recollide: new C2S2CRemoteFunction(get("building_recollide", "RemoteFunction")),
		}));
	}

	/** @deprecated */
	export function fromFolder(folder: Instance): PlayerDataStorageRemotes {
		return {
			building: createBuilding(folder),
			slots: createSlots(folder),
			player: createPlayer(folder),
		};
	}
}
