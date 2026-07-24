import { RunService, TextChatService } from "@rbxts/services";
import {
	C2S2CRemoteFunction,
	C2SRemoteEvent,
	PERemoteEventMiddlewares,
	S2C2SRemoteFunction,
	S2CRemoteEvent,
} from "engine/shared/event/PERemoteEvent";
import type { damageType } from "engine/shared/BlockDamageController";
import type { baseAchievementStats } from "server/Achievement";
import type { MigrationResponse } from "server/database/ExternalDatabase";
import type { PlayerFeature } from "server/database/PlayerDatabase";
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
		readonly features: readonly PlayerFeature[] | undefined;
		readonly achievements: { readonly [k in string]: AchievementData } | undefined;
	};
}

export type AnnouncementDisplay = "chat" | "popup" | "both";
export type AnnouncementPayload = {
	readonly text: string;
	readonly display: AnnouncementDisplay;
	/** Set by the origin server when re-publishing cross-server; absent for external/API messages. */
	readonly originJobId?: string;
	/**
	 * Seconds until servers restart, counted from arrival. The game states the exact time remaining rather
	 * than sending it as prose, so a replay to a late joiner is as accurate as the original broadcast.
	 * Also bounds the replay: once it elapses there is nothing left to warn about. Absent means neither.
	 */
	readonly ttl?: number;
};

export const CustomRemotes = {
	// all the remotes are here
	initPlayer: new C2S2CRemoteFunction<undefined, Response<PlayerInitResponse>>("player_init"),
	playerLoaded: new C2SRemoteEvent("player_loaded"),

	tutorial: {
		finished: new C2SRemoteEvent("tutorial_finished"),
		cancelled: new C2SRemoteEvent("tutorial_cancelled"),
		skipped: new C2SRemoteEvent("tutorial_skipped"),
	},

	admin: {
		adminDataFor: new C2S2CRemoteFunction<number, Response<PlayerInitResponse>>("player_init_admin"),
		adminToggleMimic: new C2SRemoteEvent<boolean>("adm_toggle_mimic"), // Toggle avatar mimic
		adminUpdateMeta: new C2SRemoteEvent<{ plrID: number }>("adm_update_meta"), // Get and Set
		adminMigrateRequest: new C2SRemoteEvent<{ from: number; to: number }>("adm_migration_request"), // Request Migration of playerdata
		adminMigrateReply: new S2CRemoteEvent<MigrationResponse>("adm_migration_reply"), // Callback
		adminWipeData: new C2SRemoteEvent<number>("adm_wipe_meta"), // Delete player metadata
		adminKickPlayer: new C2SRemoteEvent<{
			plrID: number;
			displayReason: string;
			privateReason: string;
		}>("adm_kick_player"), // Kick player
		adminBanPlayer: new C2SRemoteEvent<{
			plrID: number;
			duration: number;
			displayReason: string;
			privateReason: string;
		}>("adm_ban_player"), // Ban player
		adminAnnounce: new C2SRemoteEvent<AnnouncementPayload>("adm_announce"), // Broadcast an announcement to all servers
	},

	chat: {
		systemMessage: new S2CRemoteEvent<string>("chat_sysmsg", "RemoteEvent"),
		announcePopup: new S2CRemoteEvent<{ readonly text: string }>("announce_popup", "RemoteEvent"),
	},
	updateSaves: new S2CRemoteEvent<readonly SlotMeta[]>("pl_save_update", "RemoteEvent"),
	achievements: {
		update: new S2CRemoteEvent<{ readonly [k in string]: AchievementData }>("pl_achs_updated", "RemoteEvent"),
		loaded: new S2CRemoteEvent<{
			readonly order: readonly string[];
			readonly data: { readonly [k in string]: baseAchievementStats };
		}>("pl_achs_loaded", "RemoteEvent"),

		admin_set: new C2SRemoteEvent<{ readonly [k in string]: AchievementData }>("pl_achs_adm_set", "RemoteEvent"),
		admin_reset: new C2SRemoteEvent<string[]>("pl_achs_adm_reset", "RemoteEvent"),

		/** Batched count of terrain chunks the client generated since the last report (Cartographer). */
		reportChunks: new C2SRemoteEvent<number>("pl_achs_chunks", "RemoteEvent"),

		ahievementUnlock: new S2CRemoteEvent<{ readonly player: Player; readonly id: string }>(
			"chat_ach_unlock",
			"RemoteEvent",
		),
		isAfk: new C2SRemoteEvent<boolean>("pl_achs_isAfk"),
	},

	damageSystem: {
		healthInit: new S2CRemoteEvent<{ block: BlockModel; health: number }[]>("block_damage_init", "RemoteEvent"),
		/** Client → server: apply damage. Batched per frame (fire-and-forget; never blocks the sender). */
		damage: new C2SRemoteEvent<readonly { readonly block: BlockModel; readonly damage: damageType }[]>(
			"block_damage",
		),
		/** Server → all clients: a block was destroyed (drives client reactions like TNT chains). */
		broken: new S2CRemoteEvent<BlockModel>("block_broken"),
	},

	physics: {
		normalizeRootparts: new S2CRemoteEvent<NormalizeRootpartsRequest>("ph_normalize_rootparts"),
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

if (RunService.IsServer()) {
	CustomRemotes.playerLoaded.invoked.Connect((player) => $log(`Received ${player.Name} loaded request`));
}
if (RunService.IsClient()) {
	CustomRemotes.chat.systemMessage.invoked.Connect((text) => {
		const channel = TextChatService.FindFirstChild("TextChannels")?.FindFirstChild("RBXGeneral") as TextChannel;
		channel?.DisplaySystemMessage(`<font color='#FAFAFA'>${text}</font>`);
	});
}
