import { Players } from "@rbxts/services";
import { Db } from "engine/server/Database";
import { t } from "engine/shared/t";
import { PlayerConfigUpdater } from "server/PlayerConfigVersioning";
import type { DatabaseBackend } from "engine/server/backend/DatabaseBackend";
import type { AchievementData } from "shared/AchievementData";

export type PlayerFeature = "lua_circuit";
export type PlayerDatabaseData = {
	readonly purchasedSlots?: number;
	readonly settings?: Partial<PlayerConfig>;
	readonly slots?: readonly SlotMeta[];
	readonly data?: Partial<OePlayerData>;
	readonly features?: readonly PlayerFeature[];
	readonly achievements?: { readonly [k in string]: AchievementData };
};

export const PlayerBanned = t.interface({
	errorCode: t.const("playerBanned"),
	reason: t.string,
	until: t.number.orUndefined(),
});
export type PlayerBanned = t.Type<typeof PlayerBanned>;

export class PlayerDatabase {
	private readonly onlinePlayers = new Set<number>();
	private readonly db;

	constructor(private readonly datastore: DatabaseBackend<PlayerDatabaseData, [id: number]>) {
		this.db = new Db<PlayerDatabaseData, PlayerDatabaseData, [id: number]>(
			this.datastore,
			() => ({}),
			(data) => ({
				...data,
				settings: data.settings === undefined ? undefined : PlayerConfigUpdater.update(data.settings),
			}),
			(data) => data,
		);

		Players.PlayerAdded.Connect((plr) => this.onlinePlayers.add(plr.UserId));
		Players.PlayerRemoving.Connect((plr) => {
			this.onlinePlayers.delete(plr.UserId);

			// Roblox Stuido Local Server
			if (plr.UserId <= 0) return;

			this.db.save([plr.UserId]);
			this.db.free([plr.UserId]);
		});
	}

	get(userId: number) {
		return this.db.get([userId]);
	}

	set(userId: number, data: PlayerDatabaseData) {
		this.db.set([userId], data);

		if (!this.onlinePlayers.has(userId)) {
			this.db.save([userId]);
		}
	}
}
