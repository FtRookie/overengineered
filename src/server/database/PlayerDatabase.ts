import { Players } from "@rbxts/services";
import { Db } from "engine/server/Database";
import { Objects } from "engine/shared/fixes/Objects";
import { t } from "engine/shared/t";
import { ExternalDatabase } from "server/database/ExternalDatabase";
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

export const ServerError = t.interface({
	errorCode: t.string,
	message: t.string.orUndefined(),
});
export type ServerError = t.Type<typeof ServerError>;

// Run config migrations on every load path (datastore read + external/Studio load) or external loads skip them.
const migrateData = (data: PlayerDatabaseData): PlayerDatabaseData => ({
	...data,
	settings: data.settings === undefined ? undefined : PlayerConfigUpdater.update(data.settings),
});

export class PlayerDatabase {
	private readonly onlinePlayers = new Set<number>();
	private readonly db;

	constructor(private readonly datastore: DatabaseBackend<PlayerDatabaseData, [id: number]>) {
		this.db = new Db<PlayerDatabaseData, PlayerDatabaseData, [id: number]>(
			this.datastore,
			() => ({}),
			migrateData,
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

	notEmpty = (arr: PlayerDatabaseData | undefined): arr is PlayerDatabaseData =>
		arr !== undefined && Objects.size(arr) > 0;

	get(userId: number) {
		const db = this.db.get([userId]);
		if (this.notEmpty(db)) return db;
		const external = ExternalDatabase.GetPlayer(userId);
		if (this.notEmpty(external)) {
			const migrated = migrateData(external);
			this.set(userId, migrated);
			return migrated;
		}
		return {};
	}

	set(userId: number, data: PlayerDatabaseData, external?: boolean) {
		this.db.set([userId], data);
		if (external) {
			const result = ExternalDatabase.SetPlayer(userId, data);
			if ("error" in result) {
				$err(result.err_type, result.error);
			}
		}

		if (!this.onlinePlayers.has(userId)) {
			this.db.save([userId]);
		}
	}
}
