import type { PlayerFeature } from "server/database/PlayerDatabase";
import type { AchievementData } from "shared/AchievementData";

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
	};

	type LoadSlotResponse = Response<{
		readonly isEmpty: boolean;
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

	type FetchSlotsResponse = Response<{
		readonly purchasedSlots: number;
		readonly slots: readonly SlotMeta[];
	}>;

	type PlayerDataResponse = {
		readonly purchasedSlots: number | undefined;
		readonly settings: Partial<PlayerConfig> | undefined;
		readonly slots: readonly SlotMeta[] | undefined;
		readonly data: OePlayerData | undefined;
		readonly features: readonly PlayerFeature[] | undefined;
		readonly achievements: { readonly [k in string]: AchievementData } | undefined;
	};

	type SaveSlotResponse = Response<{ readonly blocks: number | undefined }>;
}
