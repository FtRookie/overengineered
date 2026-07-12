import { formatDatabaseBackendKeys } from "engine/server/backend/DatabaseBackend";
import { Objects } from "engine/shared/fixes/Objects";
import { Throttler } from "engine/shared/Throttler";
import type { DatabaseBackend } from "engine/server/backend/DatabaseBackend";

interface DbStoredValue<T, TKeys extends defined[]> {
	keys: TKeys;
	value: T;
	changed: boolean;
	/** The key's generation when this entry was created. See {@link DbBase.generation}. */
	gen: number;
	lastAccessedTime: number;
	lastSaveTime: number;
}
abstract class DbBase<T, TDb, TKeys extends defined[]> {
	private readonly cache: { [k in string]: DbStoredValue<T, TKeys> } = {};
	private readonly currentlyLoading: Record<string, Promise<T>> = {};
	/** Per-key counter a pending write checks before landing. The cache cannot serve for this: a newer value
	 *  may already be written AND evicted, and an absent key must not read as "nobody newer exists". */
	private readonly generation: { [k in string]: number } = {};
	/** SetAsync yields, so two writes on one key can land out of order. The generation check runs BEFORE the
	 *  yield and cannot stop that; only serialising per key can. */
	private readonly writing: { [k in string]: boolean } = {};

	constructor(private readonly datastore: DatabaseBackend<TDb, TKeys>) {
		game.BindToClose(() => {
			$log("Game termination detected");

			// No freeAll(): it would cancel in-flight writes sleeping in retryOnFail's backoff.
			this.saveChanged();
		});

		task.spawn(() => {
			const freeTimeoutSec = 5 * 60;
			const saveTimeoutSec = 9 * 60;
			$debug(`Initializing db ${this} cache auto-freeing after ${freeTimeoutSec} sec of inactivity`);
			$debug(`Initializing db ${this} cache auto-saving with the interval of ${saveTimeoutSec} sec`);

			while (true as boolean) {
				task.wait(1);

				const freeTimeCutoff = os.time() - freeTimeoutSec;
				const saveTimeCutoff = os.time() - saveTimeoutSec;

				for (const [key, item] of [...asMap(this.cache)]) {
					const idle = item.lastAccessedTime < freeTimeCutoff;

					// Nothing pending — an idle, already-persisted entry just gets dropped.
					if (idle && !item.changed) {
						$debug(`Freeing db ${this} key ${key} after ${freeTimeoutSec} sec of inactivity`);
						this.free(item.keys, key);
						continue;
					}

					// save() bumps lastSaveTime even on failure, so an entry that can never be written (over the
					// 4MB limit) backs off to one attempt per saveTimeoutSec instead of hammering forever.
					if (item.lastSaveTime < saveTimeCutoff) {
						$debug(`Auto-saving db ${this} key ${key} after ${saveTimeoutSec} sec`);

						if (this.save(item.keys, key) && idle) {
							this.free(item.keys, key);
						}
					}
				}
			}
		});
	}

	protected abstract createDefault(): T;
	protected abstract import(value: TDb): T;
	protected abstract export(value: T): TDb;

	get(keys: TKeys): T {
		const strkey = formatDatabaseBackendKeys(keys);
		if (strkey in this.cache) {
			const value = this.cache[strkey];
			value.lastAccessedTime = os.time();

			return value.value;
		}

		if (strkey in this.currentlyLoading) {
			return Objects.awaitThrow(this.currentlyLoading[strkey]);
		}

		let res: (value: T) => void = undefined!;
		let rej: (err: unknown) => void = undefined!;
		const promise = new Promise<T>((resolve, reject) => {
			res = resolve;
			rej = reject;
		});
		this.currentlyLoading[strkey] = promise;

		try {
			// load() installs the entry itself — and preserves one that raced in during its yield.
			// Re-assigning here would undo that and clobber the newer value.
			const loaded = this.load(keys, strkey);
			res(loaded.value);

			return loaded.value;
		} catch (err) {
			// Deleting the promise from the map does not settle the reference concurrent getters already hold.
			// Without this reject they hang forever on a transient GetAsync failure.
			rej(err);
			throw err;
		} finally {
			delete this.currentlyLoading[strkey];
		}
	}

	private setCached(keys: TKeys, key: string, value: T) {
		const time = os.time();

		const gen = (this.generation[key] ?? 0) + 1;
		this.generation[key] = gen;

		this.cache[key] = {
			keys,
			changed: true,
			gen,
			lastAccessedTime: time,
			value,
			lastSaveTime: time,
		};
	}

	/** Caches the value and kicks off the write. Fire-and-forget: the caller learns nothing. */
	set(keys: TKeys, value: T) {
		const key = formatDatabaseBackendKeys(keys);
		this.setCached(keys, key, value);

		task.spawn(() => this.save(keys, key));
	}

	/** set() plus an AWAITED write, returning whether the backend took it. Use for anything a human pressed. */
	setAndSave(keys: TKeys, value: T): boolean {
		const key = formatDatabaseBackendKeys(keys);
		this.setCached(keys, key, value);

		return this.save(keys, key);
	}
	delete(keys: TKeys) {
		const strkey = formatDatabaseBackendKeys(keys);

		// Bumping the generation makes any NOT-YET-STARTED write abandon. Then drop the entry
		// unconditionally (not via free(), which refuses to evict pending writes).
		this.generation[strkey] = (this.generation[strkey] ?? 0) + 1;
		delete this.cache[strkey];

		// A SetAsync already past the check and mid-yield still lands, resurrecting the row. Wait it out.
		while (this.writing[strkey] !== undefined) {
			task.wait();
		}

		this.datastore.RemoveAsync(keys);
	}

	private load(keys: TKeys, strkey: string): DbStoredValue<T, TKeys> {
		// Snapshot the generation BEFORE the yield, so we can tell whether a set() landed while we read.
		const genBefore = this.generation[strkey] ?? 0;

		const req = Throttler.retryOnFail<TDb | undefined>(3, 1, () => this.datastore!.GetAsync(keys));
		if (!req.success) {
			throw req.error_message;
		}

		// GetAsync yields, so a set() can land while we wait — newer than anything the backend has. Overwriting
		// it would evict a dirty entry nothing would ever save again. Keep the racer.
		const raced = this.cache[strkey];
		if (raced !== undefined) return raced;

		const gen = this.generation[strkey] ?? 0;

		// Generation moved but the cache is empty: a set() landed, was written and was evicted. What we read
		// predates it, so read again — the backend now has the newer value.
		if (gen !== genBefore) {
			return this.load(keys, strkey);
		}

		const time = os.time();

		if (req.message !== undefined) {
			return (this.cache[strkey] = {
				keys,
				value: this.import(req.message),
				changed: false,
				gen,
				lastAccessedTime: time,
				lastSaveTime: time,
			});
		}

		return (this.cache[strkey] = {
			keys,
			value: this.createDefault(),
			changed: false,
			gen,
			lastAccessedTime: time,
			lastSaveTime: time,
		});
	}

	loadedUnsavedEntries() {
		return Objects.entriesArray(this.cache).filter((entry) => entry[1].changed);
	}

	/** Removes an entry from the cache. Refuses to drop one the backend has not taken yet. */
	free(keys: TKeys, key?: string) {
		const strkey = key ?? formatDatabaseBackendKeys(keys);

		// Evicting an entry with a pending write silently loses it. Leave it cached; a later flush retries.
		if (this.cache[strkey]?.changed) return;

		delete this.cache[strkey];
	}

	/** Clears tha cache */
	freeAll() {
		for (const [key, _] of pairs(this.cache)) {
			delete this.cache[key];
		}
	}

	/**
	 * True ONLY when the backend actually took the value. False means NOT durable — failed, already in
	 * flight, or superseded. Never free() on false: the cache still holds data the backend never received.
	 */
	save(keys: TKeys, strkey?: string): boolean {
		strkey ??= formatDatabaseBackendKeys(keys);
		const key = strkey;

		const value = this.cache[key];
		if (!value) return true;

		value.lastSaveTime = os.time();
		if (!value.changed) return true;

		// A second concurrent write on this key could land out of order. Not durable yet, so report false; the
		// chain at the end of the in-flight write picks our value up.
		if (this.writing[key] !== undefined) return false;

		// Snapshot up front: SetAsync yields, and a retry must not re-export a value a newer set() swapped in.
		const payload = this.export(value.value);
		const gen = value.gen;

		let written = false;
		this.writing[key] = true;

		const req = Throttler.retryOnFail(3, 1, () => {
			// Generation, not the cache: the newer value may already be written AND evicted, and an absent key
			// must not read as "nobody newer exists".
			if (this.generation[key] !== gen) return;

			this.datastore!.SetAsync(payload, keys);
			written = true;
		});

		// Only ever holds ACTIVE locks, so `writing[key] !== undefined` is the whole test.
		delete this.writing[key];

		// A set() that bounced off the in-flight check would otherwise sit unwritten until the 9-minute sweep.
		const latest = this.cache[key];
		if (latest !== undefined && latest !== value && latest.changed) {
			task.spawn(() => this.save(keys, key));
		}

		if (!req.success) {
			// Keep `changed`, or every later flush silently drops the entry.
			$err(req.error_message);
			return false;
		}

		// Superseded, so nothing was written. Reporting true would let the caller free() the newer entry.
		if (!written) return false;

		value.changed = false;
		return true;
	}

	/** Shutdown flush. Nothing retries after this, so unlike the sweep it must not skip in-flight keys. */
	saveChanged() {
		// save() yields, and a set() landing mid-traversal would mutate the table we iterate. Snapshot first.
		for (const [key, { keys }] of [...asMap(this.cache)]) {
			// Wait out in-flight writes rather than bounce off them. Bounded: one wedged key must not eat the
			// whole ~30s BindToClose budget.
			const deadline = os.clock() + 5;
			while (this.writing[key] !== undefined && os.clock() < deadline) {
				task.wait();
			}

			this.save(keys, key);
		}

		// save()'s chain spawns async follow-up writes; without draining, they die with the process.
		const deadline = os.clock() + 10;
		while (Objects.size(this.writing) > 0 && os.clock() < deadline) {
			task.wait();
		}
	}
}

export class Db<T, TDb, TKeys extends defined[]> extends DbBase<T, TDb, TKeys> {
	constructor(
		datastore: DatabaseBackend<TDb, TKeys>,
		private readonly createDefaultFunc: () => T,
		private readonly importFunc: (value: TDb) => T,
		private readonly exportFunc: (value: T) => TDb,
	) {
		super(datastore);
	}

	protected createDefault(): T {
		return this.createDefaultFunc();
	}
	protected import(value: TDb): T {
		return this.importFunc(value);
	}
	protected export(value: T): TDb {
		return this.exportFunc(value);
	}
}
