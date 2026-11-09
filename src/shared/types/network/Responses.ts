import type { PlayerBlockLimits } from "server/database/PlayerDatabase";
import type { AchievementData } from "shared/AchievementData";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";

declare global {
	type TouchControlInfo = Readonly<Record<string, { readonly pos: SerializedVector2 }>>;
	type SlotMeta = {
		readonly name: string;
		readonly color: SerializedColor;
		readonly blocks: number;
		readonly touchControls: TouchControlInfo;
		readonly index: number;
		readonly order: number | undefined;
		readonly saveTime: number | undefined;
		readonly size?: number; // char size
		readonly stored?: number; // zstd bytes
		readonly compressed?: boolean; // the backend holds it as zstd; unset when not known
		readonly locked?: boolean;
	};

	type LoadSlotResponse = Response<{
		readonly isEmpty: boolean;
		/** The loaded plot's block configs by uuid — seeds the owner client's config cache (server-only otherwise). */
		readonly configs?: Record<BlockUuid, PlacedBlockConfig>;
	}>;

	type SlotHistoryPart = {
		readonly id: string;
		readonly slotId: string;
		readonly ownerId: string;
		readonly createdAt: string;
	};
	type SlotHistory = {
		readonly databaseSlotId: string;
		readonly history: readonly SlotHistoryPart[];
	};
	type LoadSlotHistoryResponse = Response<{
		readonly history: SlotHistory;
	}>;

	type PlayerDataResponse = {
		readonly settings: Partial<PlayerConfig> | undefined;
		readonly slots: readonly SlotMeta[] | undefined;
		readonly data: OePlayerData | undefined;
		readonly blocks: PlayerBlockLimits | undefined;
		readonly achievements: { readonly [k in string]: AchievementData } | undefined;
		readonly storage?: number;
	};

	type SaveSlotResponse = Response<{
		readonly blocks: number | undefined;
		readonly stored?: number;
		readonly externalError?: string;
	}>;
}
