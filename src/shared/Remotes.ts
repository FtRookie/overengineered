import { Players, RunService, TextChatService } from "@rbxts/services";
import {
	C2S2CRemoteFunction,
	C2SRemoteEvent,
	PERemoteEventMiddlewares,
	S2C2SRemoteFunction,
	S2CRemoteEvent,
} from "engine/shared/event/PERemoteEvent";
import { ArgsSignal } from "engine/shared/event/Signal";
import { Instances } from "engine/shared/fixes/Instances";
import type { BlockDamage } from "engine/shared/BlockDamageController";
import type { BaseAchievementStats } from "server/Achievement";
import type { MigrationResponse } from "server/database/ExternalDatabase";
import type { PlayerBlockLimits } from "server/database/PlayerDatabase";
import type { AchievementData } from "shared/AchievementData";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type { SpawnPosition } from "shared/SpawnPositions";

declare global {
	type BuildResponse = Response<{ readonly model: BlockModel }>;
	type MultiBuildResponse = Response<{ readonly models: readonly BlockModel[] }>;

	/** Wire connect/disconnect reply — carries the server-computed config so the owner client can cache it. */
	type LogicWireResponse = Response<{ readonly config: PlacedBlockConfig }>;

	type PlaceBlockRequest = MakePartial<BlockDataBase, "uuid" | "config"> & {
		readonly location: CFrame;
	};
	type PlaceBlocksRequest = {
		readonly plot: PlotModel;
		readonly blocks: readonly PlaceBlockRequest[];
	};
	type DeleteBlocksRequest = {
		readonly plot: PlotModel;
		readonly blocks: readonly BlockModel[] | "all";
	};
	type EditBlockRequest = {
		readonly instance: BlockModel;
		readonly position: CFrame | undefined;
		readonly scale: Vector3 | undefined;
	};
	type EditBlocksRequest = {
		readonly plot: PlotModel;
		readonly blocks: readonly EditBlockRequest[];
	};

	type LogicConnectRequest = {
		readonly plot: PlotModel;
		readonly outputBlock: BlockModel;
		readonly outputConnection: BlockConnectionName;
		readonly inputBlock: BlockModel;
		readonly inputConnection: BlockConnectionName;
	};
	type LogicDisconnectRequest = {
		readonly plot: PlotModel;
		readonly inputBlock: BlockModel;
		readonly inputConnection: BlockConnectionName;
	};

	type PaintBlocksRequest = {
		readonly plot: PlotModel;
		readonly blocks: readonly BlockModel[] | "all";
		readonly color?: Color4;
		readonly material?: Enum.Material;
	};
	type NormalizeRootpartsRequest = {
		readonly parts: BasePart[];
	};
	type BlastRequest = {
		readonly epicenter: Vector3;
		readonly radius: number;
		readonly pressure: number;
	};
	type EnvironmentBlacklistRequest = {
		readonly isBanned: boolean;
		readonly plot: BasePart;
	};
	type ConfigUpdateRequest = {
		readonly plot: PlotModel;
		readonly configs: readonly {
			readonly block: BlockModel;
			readonly scfg: string;
		}[];
	};
	type CustomDataUpdateRequest = {
		readonly plot: PlotModel;
		readonly datas: readonly {
			readonly block: BlockModel;
			readonly sdata: string;
		}[];
	};
	type ConfigResetRequest = {
		readonly plot: PlotModel;
		readonly blocks: readonly BlockModel[];
	};
	type WeldRequest = {
		readonly plot: PlotModel;
		readonly datas: readonly {
			readonly thisUuid: BlockUuid;
			readonly thisPart: readonly string[];
			readonly otherUuid: BlockUuid;
			readonly otherPart: readonly string[];
			readonly welded: boolean;
		}[];
	};
	type RecollideRequest = {
		readonly plot: PlotModel;
		readonly datas: readonly {
			readonly uuid: BlockUuid;
			readonly enabled: boolean;
		}[];
	};

	type PlayerUpdateSettingsRequest = PartialThrough<PlayerConfig>;
	type PlayerUpdateDataRequest = {
		readonly key: keyof OePlayerData;
		readonly value: OePlayerData[keyof OePlayerData];
	};
	type PlayerSaveSlotRequest = {
		readonly index: number;
		readonly order?: number | undefined;
		readonly name?: string;
		readonly color?: SerializedColor;
		readonly touchControls?: TouchControlInfo;
		readonly save: boolean;
		readonly external?: boolean;
	};
	type PlayerDeleteSlotRequest = {
		readonly index: number;
	};
	type PlayerLoadSlotRequest = {
		readonly index: number;
	};
	type PlayerLoadSlotFromHistoryRequest = {
		readonly databaseId: string;
		readonly historyId: string;
	};
	type PlayerLoadAdminSlotRequest = PlayerLoadSlotRequest & {
		readonly userid: number;
	};
}

export interface PlayerInitResponse {
	readonly remotes: Instance;
	readonly data: {
		readonly purchasedSlots: number | undefined;
		readonly settings: Partial<PlayerConfig> | undefined;
		readonly slots: readonly SlotMeta[] | undefined;
		readonly data: OePlayerData | undefined;
		readonly blocks: PlayerBlockLimits | undefined;
		readonly achievements: { readonly [k in string]: AchievementData } | undefined;
	};
}

export type AnnouncementDisplay = "chat" | "popup" | "both";
export type AnnouncementPayload = {
	readonly text: string;
	readonly display: AnnouncementDisplay;
	readonly originJobId?: string;
	readonly ttl?: number; // how many seconds a message is displayed for
};

export type ServerRosterEntry = {
	readonly jobId: string;
	readonly secondsAgo: number;
};

export const CustomRemotes = {
	initPlayer: new C2S2CRemoteFunction<undefined, Response<PlayerInitResponse>>("player_init"),
	playerLoaded: new C2SRemoteEvent("player_loaded"),

	tutorial: {
		finished: new C2SRemoteEvent("tutorial_finished"),
		cancelled: new C2SRemoteEvent("tutorial_cancelled"),
		skipped: new C2SRemoteEvent("tutorial_skipped"),
	},

	admin: {
		adminDataFor: new C2S2CRemoteFunction<number, Response<PlayerInitResponse>>("player_init_admin"),
		adminToggleMimic: new C2S2CRemoteFunction<boolean, Response>("adm_toggle_mimic"), // Toggle avatar mimic
		adminUpdateMeta: new C2S2CRemoteFunction<{ plrID: number }, Response>("adm_update_meta"), // Get and Set
		adminMigrate: new C2S2CRemoteFunction<{ from: number; to: number }, Response<MigrationResponse>>(
			"adm_migration_request",
		),
		adminWipeData: new C2S2CRemoteFunction<number, Response>("adm_wipe_meta"), // Delete player metadata
		adminKickPlayer: new C2S2CRemoteFunction<
			{
				plrID: number;
				displayReason: string;
				privateReason: string;
			},
			Response
		>("adm_kick_player"),
		adminBanPlayer: new C2S2CRemoteFunction<
			{
				plrID: number;
				duration: number; // seconds, -1 permanent
				displayReason: string;
				privateReason: string;
			},
			Response
		>("adm_ban_player"),
		adminAnnounce: new C2S2CRemoteFunction<{ payload: AnnouncementPayload; all: boolean }, Response>(
			"adm_announce",
		),
		adminGrantBlock: new C2S2CRemoteFunction<{ plrID: number; blockId: string; limit?: number }, Response>(
			"adm_grant_block",
		),
		adminJoinServer: new C2S2CRemoteFunction<string, Response>("adm_join_server"),
		adminServerList: new C2S2CRemoteFunction<
			undefined,
			Response<{ readonly servers: readonly ServerRosterEntry[] }>
		>("adm_server_list"),
	},

	chat: {
		systemMessage: new S2CRemoteEvent<string>("chat_sysmsg", "RemoteEvent"),
		announcePopup: new S2CRemoteEvent<{ readonly text: string }>("announce_popup", "RemoteEvent"),
	},
	updateSaves: new S2CRemoteEvent<readonly SlotMeta[]>("pl_save_update", "RemoteEvent"),
	updateBlockLimits: new S2CRemoteEvent<PlayerBlockLimits>("pl_blocks_update", "RemoteEvent"),
	/** Server → client: a player row that failed to load came back and replaces the client's data */
	playerDataRecovered: new S2CRemoteEvent<PlayerDataResponse>("pl_data_recovered", "RemoteEvent"),
	/** Client → server: the recovered row is applied, so the player's writes may reopen */
	playerDataRecoveredAck: new C2SRemoteEvent("pl_data_recovered_ack"),
	donated: new S2CRemoteEvent<number>("pl_donated", "RemoteEvent"),
	achievements: {
		update: new S2CRemoteEvent<{ readonly [k in string]: AchievementData }>("pl_achs_updated", "RemoteEvent"),
		loaded: new S2CRemoteEvent<{
			readonly order: readonly string[];
			readonly data: { readonly [k in string]: BaseAchievementStats };
		}>("pl_achs_loaded", "RemoteEvent"),

		admin_set: new C2SRemoteEvent<{ readonly [k in string]: AchievementData }>("pl_achs_adm_set", "RemoteEvent"),
		admin_reset: new C2SRemoteEvent<string[]>("pl_achs_adm_reset", "RemoteEvent"),

		/** Batched count of terrain chunks the client generated since the last report (Cartographer). */
		reportChunks: new C2SRemoteEvent<number>("pl_achs_chunks", "RemoteEvent"),

		/** Fired once, when the client's Donate press count reaches `Donations.freeClicks`. */
		donateClicks: new C2SRemoteEvent("pl_achs_clicks", "RemoteEvent"),

		ahievementUnlock: new S2CRemoteEvent<{ readonly player: Player; readonly id: string }>(
			"chat_ach_unlock",
			"RemoteEvent",
		),
		isAfk: new C2SRemoteEvent<boolean>("pl_achs_isAfk"),
	},

	damageSystem: {
		healthInit: new S2CRemoteEvent<{ block: BlockModel; health: number }[]>("block_damage_init", "RemoteEvent"),
		/** Client → server: apply damage. */
		damage: new C2SRemoteEvent<readonly { readonly block: Instance; readonly damage: BlockDamage }[]>(
			"block_damage",
		),
		/** Server → all clients: a block was destroyed (drives client reactions like TNT chains). */
		broken: new S2CRemoteEvent<BlockModel>("block_broken"),
	},

	destructibles: {
		hit: new C2SRemoteEvent<{ readonly model: Model }>("destructible_hit"),
	},

	physics: {
		normalizeRootparts: new S2CRemoteEvent<NormalizeRootpartsRequest>("ph_normalize_rootparts"),
		/** Server → other clients: throw your own blocks away from an explosion. */
		blast: new S2CRemoteEvent<BlastRequest>("ph_blast"),
	},
	gui: {
		settings: {
			permissions: {
				isolationMode: new C2SRemoteEvent<boolean>("gui_settings_isolation"),
				updateBlacklist: new C2SRemoteEvent<readonly number[]>("gui_settings_updateblacklist"),
			},
		},
	},
	modes: {
		set: new C2S2CRemoteFunction<{ readonly mode: PlayModes; readonly pos?: SpawnPosition }>(
			"md_set",
		).addMiddleware(PERemoteEventMiddlewares.rateLimiter(30, 60)),
		setOnClient: new S2C2SRemoteFunction<PlayModes | undefined>("md_setc"),
		ride: {
			teleportOnSeat: new C2SRemoteEvent("mdr_seat"),
		},
	},
	integrityViolation: new C2SRemoteEvent<string>("integrity_violation"),
} as const;

const _playerLoadedOnce = new ArgsSignal<[player: Player]>();
/** @server `playerLoaded` without repeats: every consumer resends or rebuilds that player's whole state */
export const playerLoadedOnce = _playerLoadedOnce.asReadonly();

if (RunService.IsServer()) {
	const loaded = new Set<Player>();
	Players.PlayerRemoving.Connect((player) => loaded.delete(player));

	CustomRemotes.playerLoaded.invoked.Connect((player) => {
		if (loaded.has(player)) {
			player.Kick("Network error at player_loaded");
			return;
		}
		loaded.add(player);

		$log(`Received ${player.Name} loaded request`);
		_playerLoadedOnce.Fire(player);
	});
}
if (RunService.IsClient()) {
	CustomRemotes.chat.systemMessage.invoked.Connect((text) => {
		const channel = Instances.findChild<TextChannel>(TextChatService, "TextChannels", "RBXGeneral");
		channel?.DisplaySystemMessage(`<font color='#FAFAFA'>${text}</font>`);
	});
}
