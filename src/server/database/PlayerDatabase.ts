import { Players } from "@rbxts/services";
import { Db } from "engine/server/Database";
import { ArgsSignal } from "engine/shared/event/Signal";
import { Objects } from "engine/shared/fixes/Objects";
import { t } from "engine/shared/t";
import { ExternalDatabase } from "server/database/ExternalDatabase";
import { PlayerConfigUpdater } from "server/PlayerConfigVersioning";
import { Config } from "shared/config/Config";
import { PlayerConfigDefinition } from "shared/config/PlayerConfig";
import type { DatabaseBackend } from "engine/server/backend/DatabaseBackend";
import type { AchievementData } from "shared/AchievementData";

export type PlayerBlockLimits = { readonly [id in string]: number };
export type PlayerDatabaseData = {
	readonly purchasedSlots?: number;
	readonly settings?: Partial<PlayerConfig>;
	readonly slots?: readonly SlotMeta[];
	readonly data?: Partial<OePlayerData>;
	readonly blocks?: PlayerBlockLimits;
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

const migrateData = (data: PlayerDatabaseData): PlayerDatabaseData => {
	const { features, ...rest } = data as PlayerDatabaseData & { readonly features?: unknown };

	return {
		...rest,
		settings: typeIs(rest.settings, "table")
			? Config.stripMisplacedScalars(PlayerConfigUpdater.update(rest.settings), PlayerConfigDefinition)
			: undefined,
	};
};

/** How long a changed row may sit in the datastore before it is pushed upstream. */
const MIRROR_INTERVAL_SEC = 30;
const RECOVERY_FIRST_DELAY_SEC = 5; // doubles after each failed retry
const RECOVERY_MAX_DELAY_SEC = 60;

export class PlayerDatabase {
	private readonly onlinePlayers = new Set<number>();
	/** Rows we actually know the truth about: the datastore had one, or the external db answered. */
	private readonly resolved = new Set<number>();
	/** Rows changed since the last successful mirror. A set, so a hundred writes collapse into one push. */
	private readonly dirty = new Set<number>();
	/** Rows we could not determine. They get an empty one so they can play, but every write is refused: their
	 *  real data may be upstairs, and making our invented blank durable is unrecoverable. */
	private readonly unresolved = new Set<number>();
	/** Rows being retried in the background, so get() leaves the backend alone for them. */
	private readonly recovering = new Set<number>();
	/** Rows that came back while the player was online; writes stay refused until their client has them. */
	private readonly awaitingAck = new Set<number>();
	private readonly rebuilders: ((userId: number, row: PlayerDatabaseData) => Partial<PlayerDatabaseData>)[] = [];
	private readonly _recovered = new ArgsSignal<[userId: number, row: PlayerDatabaseData]>();
	/** A row that failed to load came back, already including what the rebuilders merged in. */
	readonly recovered = this._recovered.asReadonly();
	private readonly db;

	constructor(private readonly datastore: DatabaseBackend<PlayerDatabaseData, [id: number]>) {
		this.db = new Db<PlayerDatabaseData, PlayerDatabaseData, [id: number]>(
			this.datastore,
			() => ({}),
			migrateData,
			(data) => data,
		);

		Players.PlayerAdded.Connect((plr) => {
			this.onlinePlayers.add(plr.UserId);

			// the row came back after their last client stopped listening, so this session starts from it
			if (this.awaitingAck.delete(plr.UserId)) this.unresolved.delete(plr.UserId);
		});
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
				this.mirrorSafely(userId);
			}
		});

		task.spawn(() => {
			while (true as boolean) {
				task.wait(MIRROR_INTERVAL_SEC);

				for (const userId of [...this.dirty]) {
					this.mirrorSafely(userId);
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
	// pcall'd: one row throwing would otherwise end mirroring for every row, for the server's lifetime
	private mirrorSafely(userId: number) {
		const [ok, err] = pcall(() => this.mirror(userId));
		if (!ok) $warn(`Could not mirror ${userId}'s row: ${err}`);
	}

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
		// a background retry owns this row, and get() must not dial alongside it from a hot path
		if (this.recovering.has(userId)) return cached;

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
			this.scheduleRecovery(userId);

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

	/** Runs when a failed row comes back, before the client hears of it: rebuild what the session built on the blank. */
	addRecoveryRebuilder(rebuild: (userId: number, row: PlayerDatabaseData) => Partial<PlayerDatabaseData>) {
		this.rebuilders.push(rebuild);
	}

	/** The client now holds the recovered row, so its writes are based on the truth again. */
	confirmRecovered(userId: number) {
		// ignore an ack nothing asked for: reopening early lets a write based on the blank through
		if (!this.awaitingAck.delete(userId)) return;
		this.unresolved.delete(userId);
	}

	private scheduleRecovery(userId: number) {
		// ignore if offline, where admin paths retry on their own, or if a retry is already running
		if (!this.onlinePlayers.has(userId) || this.recovering.has(userId)) return;
		this.recovering.add(userId);

		task.spawn(() => {
			let delay = RECOVERY_FIRST_DELAY_SEC;
			while (this.onlinePlayers.has(userId) && this.unresolved.has(userId)) {
				task.wait(delay);
				// ignore if they left during the wait
				if (!this.onlinePlayers.has(userId)) break;

				const external = ExternalDatabase.GetPlayer(userId);
				// ignore if they left during the request
				if (!this.onlinePlayers.has(userId)) break;

				if (external.ok) {
					this.recover(userId, external.value);
					break;
				}

				delay = math.min(delay * 2, RECOVERY_MAX_DELAY_SEC);
			}

			this.recovering.delete(userId);
		});
	}

	private recover(userId: number, value: PlayerDatabaseData | undefined) {
		let row: PlayerDatabaseData = this.notEmpty(value) ? migrateData(value) : {};
		for (const rebuild of this.rebuilders) {
			row = { ...row, ...rebuild(userId, row) };
		}

		this.resolved.add(userId);
		this.awaitingAck.add(userId);

		// the truth plus what was merged in, so it is safe to persist before the client acks
		if (this.notEmpty(row)) {
			this.db.set([userId], row);
			this.dirty.add(userId);
		}

		this._recovered.Fire(userId, row);
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

	/**
	 * Lay the backend's pending changes for this player over their row. They save and mirror like any write,
	 * and the mirror carrying them is what clears them upstream. Only those keys: the rest of the backend's copy
	 * can be older than ours. Undefined when nothing was applied.
	 */
	applyPendingChanges(userId: number): Partial<PlayerDatabaseData> | undefined {
		const pending = ExternalDatabase.GetPendingChanges(userId);
		if (!pending.ok) {
			$warn(`Could not read ${userId}'s pending changes: ${pending.error}`);
			return;
		}
		if (pending.value === undefined || Objects.size(pending.value) === 0) return;

		// get() resolves the row and is what marks it unresolved on failure, so the check only means anything after
		const row = this.get(userId);
		if (!this.isDataLoaded(userId)) return;

		this.set(userId, { ...row, ...pending.value });
		return pending.value;
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
