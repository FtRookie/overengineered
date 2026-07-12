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

/** How long a changed row may sit in the datastore before it is pushed upstream. */
const MIRROR_INTERVAL_SEC = 30;

export class PlayerDatabase {
	private readonly onlinePlayers = new Set<number>();
	/** Rows we actually know the truth about: the datastore had one, or the external db answered. */
	private readonly resolved = new Set<number>();
	/** Rows changed since the last successful mirror. A set, so a hundred writes collapse into one push. */
	private readonly dirty = new Set<number>();
	/** Rows we could not determine. They get an empty one so they can play, but every write is refused: their
	 *  real data may be upstairs, and making our invented blank durable is unrecoverable. */
	private readonly unresolved = new Set<number>();
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

			// Datastore first: the mirror can hang for seconds, long enough to lose the save it backs up. Free
			// after both, so the mirror still reads the row from the cache.
			const saved = this.db.save([plr.UserId]);
			this.mirror(plr.UserId);

			// only drop it from the cache if the backend actually took it
			if (saved) {
				this.db.free([plr.UserId]);
			}
		});

		game.BindToClose(() => {
			// Bounded: the datastore flush shares this ~30s budget and must not be starved by a slow backend.
			const deadline = os.clock() + 10;

			for (const userId of [...this.dirty]) {
				if (os.clock() > deadline) break;
				this.mirror(userId);
			}
		});

		task.spawn(() => {
			while (true as boolean) {
				task.wait(MIRROR_INTERVAL_SEC);

				for (const userId of [...this.dirty]) {
					this.mirror(userId);
					task.wait(0.2); // spread the pushes out; HttpService allows ~500 requests per minute
				}
			}
		});
	}

	notEmpty = (arr: PlayerDatabaseData | undefined): arr is PlayerDatabaseData =>
		arr !== undefined && Objects.size(arr) > 0;

	/**
	 * Coalesced, not write-through: the row is tiny but written on every settings toggle, achievement flush
	 * and slot save. Mirrored at all because the datastore dies with the experience — without a copy upstairs
	 * a takedown leaves the saves with no index of what they are.
	 */
	private mirror(userId: number) {
		if (!this.dirty.has(userId)) return;

		// Before db.get(), which can re-load an evicted row: no point paying a GetAsync for a backend we know
		// is down.
		if (!ExternalDatabase.isAvailable()) return;

		const result = ExternalDatabase.SetPlayer(userId, this.db.get([userId]));
		if (!result.ok) {
			$warn(`Could not mirror ${userId}'s row to the external database: ${result.error}`);
			return;
		}

		this.dirty.delete(userId);
	}

	get(userId: number): PlayerDatabaseData {
		const cached = this.db.get([userId]);
		if (this.notEmpty(cached)) return cached;

		// Known-empty, i.e. genuinely new. get() sits in hot paths, so this must not re-dial the backend.
		if (this.resolved.has(userId)) return cached;

		const external = ExternalDatabase.GetPlayer(userId);

		// GetPlayer yields for hundreds of ms, and a set() landing meanwhile is newer than anything it returns.
		// Re-read the cache (a hit, no yield): whoever filled the key wins.
		const raced = this.db.get([userId]);
		if (this.notEmpty(raced)) return raced;

		if (!external.ok) {
			// We do NOT know this player is new — their row may be upstairs. Let them play, but refuse every
			// write until we learn the truth: persisting this blank would destroy their slots and settings.
			this.unresolved.add(userId);
			$warn(`Could not load ${userId}'s row: ${external.error}. Every write for them is refused.`);

			return {};
		}

		this.resolved.add(userId);
		this.unresolved.delete(userId);

		if (this.notEmpty(external.value)) {
			const migrated = migrateData(external.value);
			this.set(userId, migrated);
			return migrated;
		}

		return {};
	}

	/**
	 * Overrides the usual datastore-wins rule. Only for an admin migration, which rewrites the row upstairs
	 * and nowhere else. Not marked dirty: it already IS the upstream value.
	 */
	adopt(userId: number, data: PlayerDatabaseData) {
		this.resolved.add(userId);
		this.dirty.delete(userId);

		this.db.set([userId], migrateData(data));
		if (!this.onlinePlayers.has(userId)) {
			this.db.save([userId]);
		}
	}

	/** Whether we actually know what this player owns. False means everything they do this session is lost. */
	isDataLoaded(userId: number): boolean {
		return !this.unresolved.has(userId);
	}

	set(userId: number, data: PlayerDatabaseData) {
		if (this.unresolved.has(userId)) {
			// The row we handed out is a blank we invented. Writing it back would make that blank durable.
			$warn(`Refusing to write ${userId}'s row: it never loaded`);
			return;
		}

		this.db.set([userId], data);
		this.dirty.add(userId);

		if (!this.onlinePlayers.has(userId)) {
			this.db.save([userId]);
			this.mirror(userId);
		}
	}
}
