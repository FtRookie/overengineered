import { ConfigService, HttpService, Players, RunService, ServerScriptService } from "@rbxts/services";
import { JSON } from "engine/shared/fixes/Json";
import { Objects } from "engine/shared/fixes/Objects";
import { Lazy } from "engine/shared/Lazy";
import { ZstdSave } from "server/database/ZstdSave";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import type { PlayerBlockLimits, PlayerDatabaseData } from "server/database/PlayerDatabase";
import type { LatestSerializedBlocks } from "shared/building/BlocksSerializer";

type ErrType =
	| "HTTP" //
	| "OUT_OF_INDEX"
	| "NOT_FOUND"
	| "INCORRECT_TOKEN";
type ExternalError = {
	error: string;
	err_type: ErrType;
};
type SlotKeys = [ownerID: number, slotID: number];

// generated from .env, which Roblox cannot read; absent means read-only against production
type StudioConfig = {
	readonly writetoken?: string;
	readonly baseurl?: string;
};

type BuiltBodies = { readonly ok: true; readonly bodies: string[] } | { readonly ok: false; readonly oversize: number };

/** Keeps "answered, no slot" (datastore fallback safe) apart from "unreachable" (fallback lethal). */
export type ExternalRead<T> =
	| { readonly ok: true; readonly value: T | undefined } //
	| { readonly ok: false; readonly error: string };

export type ExternalWrite =
	| { readonly ok: true; readonly zstd?: boolean } // zstd: SaveSlot sent the save as Zstd
	| { readonly ok: false; readonly error: string };
export type ExternalSlot = {
	index: number;
	blocks: BlocksSerializer.JsonSerializedBlocks;
	blob: buffer; // the same save as Zstd, sent instead when the backend takes it
	zstdOnly?: boolean; // refused rather than sent as JSON when the backend does not take Zstd
	ifUnchanged?: string; // hashOf the row as read; the backend refuses the write if the row has changed since
};
export type ExternalSave = {
	readonly blocks: LatestSerializedBlocks;
	readonly measured?: { readonly characters: number; readonly stored: number }; // undefined for a JSON row
	readonly text: string; // the row as served, for zstdCopy
};

export type MigrationResponse = {
	metadata: "SUCCESS" | "FAIL";
	saves: "SUCCESS" | "FAIL";
};

const PRODUCTION_URL = "https://www.ftrookie.com/overengineered";
const Outage = {
	cooldown: 30, // seconds; fail fast: the quit-save runs per player inside a ~30s shutdown budget
} as const;

const Transfer = {
	maxPages: 512, // backend serves big saves in 1MB pages
	maxBody: 900_000, // nginx refuses bodies past its default 1MB; measured before gzip, so it holds for any body
	minChunk: 32_000, // smaller means something is pathological
} as const;

// a busy server's own traffic keeps `status.healthy` current; a quiet one may not dial for an hour
const Probe = {
	playerThreshold: 5,
	interval: 120, // seconds
} as const;

const migrationFailed: MigrationResponse = { metadata: "FAIL", saves: "FAIL" };

const status = {
	healthy: true, // observed state; isDown() expiring means retry, not recovered
	downUntil: 0,
	lastError: "no requests have failed", // shown by downError(), else callers only see "unavailable"
};

// probe the DB for compression support
const capabilities = {
	negotiated: false,
	gzip: false,
	zstd: false,
	ifUnchanged: false,
};

const nonEmpty = (value: string | undefined) => (value === "" ? undefined : value); // "" is truthy in Luau

const studioConfig = new Lazy((): StudioConfig => {
	const module = ServerScriptService.FindFirstChild("studioconfig");
	// a place assembled without Rojo has an empty Folder of this name
	if (module && !module.IsA("ModuleScript")) {
		$warn(
			`studioconfig is a ${module.ClassName}, not a ModuleScript, so this session is read-only against production`,
		);
		return {};
	}

	return module ? (require(module) as StudioConfig) : {};
});

const baseUrl = new Lazy((): string => {
	// Studio only, so a stray value can never redirect a live server
	const override = RunService.IsStudio() ? nonEmpty(studioConfig.get().baseurl) : undefined;
	if (override === undefined) return PRODUCTION_URL;

	// a bare host fails the same way a downed backend does, so reject it by name
	if (!override.startsWith("http://") && !override.startsWith("https://")) {
		warn(
			`[ExternalDatabase] Ignoring baseurl "${override}": it needs the scheme and the base path, ` +
				`e.g. "https://www.ftrookie.com/overengineered". Using production.`,
		);
		return PRODUCTION_URL;
	}

	const url = override.sub(-1) === "/" ? override.sub(1, override.size() - 1) : override;
	warn(`[ExternalDatabase] Talking to ${url} instead of production.`);

	return url;
});

// cached even when missing: GetConfigAsync yields, and re-reading it per write stalls
const writeToken = new Lazy((): string | undefined => {
	// not PlaceId === 0: Studio on a published place has a real PlaceId and no ConfigService TOKEN
	if (RunService.IsStudio()) {
		const token = nonEmpty(studioConfig.get().writetoken);

		// warn, not $log: log macros are off by default
		warn(
			token === undefined
				? "[ExternalDatabase] No write token: Studio is READ-ONLY against the external database. Loads " +
						"work; saves queue in the datastore and never leave this session. Put a writetoken in " +
						".env as WRITETOKEN to write for real."
				: `[ExternalDatabase] WRITES ARE LIVE: this Studio session will save into ${baseUrl.get()}`,
		);
		return token;
	}

	let token: string | undefined;
	try {
		token = nonEmpty(ConfigService.GetConfigAsync().GetValue("TOKEN") as string | undefined);
	} catch (err) {
		$err(`Could not read the write token: ${err}`);
	}

	if (token !== undefined) return token;

	warn(
		"[ExternalDatabase] No write token. NOTHING can be saved to the external database — every " +
			"save will queue in the datastore instead.",
	);
	return undefined;
});

const request = (options: RequestAsyncRequest): RequestAsyncResponse => {
	const started = os.clock();
	const [ok, result] = pcall(() => HttpService.RequestAsync(options));

	// a bad URL, throttling and a dead backend look identical without status and timing
	if (RunService.IsStudio()) {
		const took = math.floor((os.clock() - started) * 1000);
		const response = result as RequestAsyncResponse;
		const outcome = ok ? `HTTP ${response.StatusCode}, ${response.Body.size()} bytes` : `FAILED -> ${result}`;

		print(`[db] ${options.Method ?? "GET"} ${options.Url}\n     -> ${outcome} (${took}ms)`);
	}

	if (!ok) throw result;
	return result as RequestAsyncResponse;
};

const isDown = () => os.clock() < status.downUntil;
const downError = () => `The database is unavailable (${status.lastError})`;

const markDown = (reason: string) => {
	status.healthy = false;
	status.lastError = reason;
	status.downUntil = os.clock() + Outage.cooldown;

	warn(`[ExternalDatabase] ${reason}`);
};
const markUp = () => {
	status.healthy = true;
	status.downUntil = 0;
};

const negotiate = () => {
	if (isDown()) return;

	try {
		const response = request({ Method: "GET", Url: `${baseUrl.get()}/capabilities` });
		if (response.StatusCode !== 200 && response.StatusCode !== 404) return; // keep what was negotiated, or the baseline

		// a 404 is a backend from before negotiation, upstream's included
		const offered: { readonly gzip?: unknown; readonly zstd?: unknown; readonly ifUnchanged?: unknown } =
			response.StatusCode === 200 ? JSON.deserialize(response.Body) : {};

		capabilities.gzip = offered.gzip === true;
		capabilities.zstd = offered.zstd === true;
		capabilities.ifUnchanged = offered.ifUnchanged === true;
		capabilities.negotiated = true;
	} catch (err) {
		markDown(tostring(err));
	}
};
const negotiated = () => {
	if (!capabilities.negotiated) negotiate();
	return capabilities;
};
const compression = () => (capabilities.gzip ? Enum.HttpCompression.Gzip : Enum.HttpCompression.None);

const errTypeOf = (body: string | undefined): string | undefined => {
	if (body === undefined || body === "") return undefined;

	const [ok, parsed] = pcall(() => JSON.deserialize(body));
	if (!ok || !typeIs(parsed, "table")) return undefined;

	const errType = (parsed as { readonly err_type?: unknown }).err_type;
	return typeIs(errType, "string") ? errType : undefined;
};

const reportStatus = (status: number, what: string, body?: string): string => {
	// one corrupt row is not an outage, and no retry fixes it
	if (status >= 500 && errTypeOf(body) === "CORRUPT_ROW") {
		const reason = `${what} is stored corrupted and cannot be read`;
		warn(`[ExternalDatabase] ${reason}`);

		return reason;
	}

	const reason =
		status === 413
			? `${what} is too large for the database (over ~1MB) — HTTP 413`
			: `Got HTTP ${status} from ${baseUrl.get()}`;

	// a 4xx is this request's fault; marking down on it would refuse every player's slots over one oversized build
	if (status >= 500) {
		markDown(reason);
	} else {
		warn(`[ExternalDatabase] ${reason}`);
	}

	return reason;
};

const parseData = (data: string): ExternalSave | undefined => {
	try {
		let node: unknown = JSON.deserialize(data);
		let measured: ExternalSave["measured"];

		// stored rows carry several historical wrappings, a Zstd save one more; unwrap to { version, blocks },
		// bounded against junk
		for (let i = 0; i < 8; i++) {
			if (typeIs(node, "string")) {
				node = JSON.deserialize(node);
				continue;
			}
			if (!typeIs(node, "table")) break;

			const tbl = node as { readonly blocks?: unknown; readonly data?: unknown; readonly zstd?: unknown };
			if (tbl.blocks !== undefined) break;

			if (typeIs(tbl.zstd, "string")) {
				const decoded = ZstdSave.decode(tbl.zstd);
				measured = { characters: decoded.json.size(), stored: buffer.len(decoded.blob) };
				node = JSON.deserialize(decoded.json);
				continue;
			}

			if (tbl.data === undefined) break;
			node = tbl.data;
		}

		return {
			blocks: BlocksSerializer.jsonToObject(node as BlocksSerializer.JsonSerializedBlocks),
			measured,
			text: data,
		};
	} catch (what) {
		// returned, not thrown: "unreadable" must stay distinguishable from "unreachable"
		$err(`Failed to parse external save data: ${what}`);
		return undefined;
	}
};

// HttpService, not JSON: JSON.deserialize turns tagged values into float32 datatypes, so re-encoding would change them
const storedJson = (text: string): string | undefined => {
	let node: unknown = HttpService.JSONDecode(text);
	for (let i = 0; i < 8; i++) {
		if (typeIs(node, "string")) {
			node = HttpService.JSONDecode(node);
			continue;
		}
		if (!typeIs(node, "table")) return;

		const tbl = node as { readonly blocks?: unknown; readonly data?: unknown; readonly zstd?: unknown };
		if (tbl.zstd !== undefined) return;
		if (tbl.blocks !== undefined) return HttpService.JSONEncode(node);
		if (tbl.data === undefined) return;

		node = tbl.data;
	}
};

const readPageError = (body: string): string | undefined => {
	try {
		return JSON.deserialize<{ error?: string; err_type?: ErrType }>(body)?.error;
	} catch {
		return undefined; // raw save pages are not JSON
	}
};

// sub() counts bytes; never end inside a multi-byte character
const utf8SafeEnd = (s: string, at: number): number => {
	if (at >= s.size()) return s.size();

	const start = utf8.offset(s, 0, at + 1);
	return start === undefined ? at : start - 1;
};

const buildUploadBodies = (
	UID: number,
	slot: ExternalSlot,
	uploadID: string,
	payload: string,
	token: string,
	chunk: number,
): BuiltBodies => {
	// the envelope carries the part count, so every cut is found before encoding
	const ends: number[] = [];
	let at = 1;
	while (at <= payload.size()) {
		let stop = utf8SafeEnd(payload, at + chunk - 1);

		// chunk shorter than one character: take the whole character so `at` advances
		if (stop < at) {
			const nextChar = utf8.offset(payload, 2, at);
			stop = nextChar === undefined ? payload.size() : nextChar - 1;
		}

		ends.push(stop);
		at = stop + 1;
	}

	const bodies: string[] = [];
	let start = 1;

	for (let i = 0; i < ends.size(); i++) {
		const body = JSON.serialize({
			playerID: tostring(UID),
			index: tostring(slot.index),
			uploadID,
			part: i,
			parts: ends.size(),
			data: payload.sub(start, ends[i]),
			token,
			ifUnchanged: slot.ifUnchanged,
		});

		if (body.size() > Transfer.maxBody) return { ok: false, oversize: body.size() }; // first overflow sizes the next try

		bodies.push(body);
		start = ends[i] + 1;
	}

	return { ok: true, bodies };
};

const uploadInChunks = (
	UID: number,
	slot: ExternalSlot,
	payload: string,
	token: string,
	zstd: boolean,
): ExternalWrite => {
	const uploadID = HttpService.GenerateGUID(false);

	// every part is sized before any is sent; the first try assumes no JSON escaping, its overflow measures it
	let chunk: number = Transfer.maxBody;
	let bodies: string[] | undefined;

	for (let attempt = 0; attempt < 8; attempt++) {
		const built = buildUploadBodies(UID, slot, uploadID, payload, token, chunk);
		if (built.ok) {
			bodies = built.bodies;
			break;
		}

		// the fixed envelope makes body size non-linear in chunk, hence the 1024 margin
		const fitted = math.floor((chunk * Transfer.maxBody) / built.oversize) - 1024;
		if (fitted < Transfer.minChunk || fitted >= chunk) break;

		chunk = fitted;
	}

	if (bodies === undefined) {
		return { ok: false, error: "This build cannot be split small enough to send" };
	}

	for (const body of bodies) {
		const response = request({
			Method: "POST",
			Headers: { "Content-Type": "application/json" },
			Url: `${baseUrl.get()}/save/chunk`,
			Body: body,
			Compress: compression(),
		});

		if (response.StatusCode !== 200) {
			return { ok: false, error: reportStatus(response.StatusCode, "This build", response.Body) };
		}

		markUp();

		const answer = JSON.deserialize<ExternalError | { status: string }>(response.Body);
		if ("error" in answer) return { ok: false, error: answer.error };
	}

	return { ok: true, zstd };
};

// print, not $log: log macros are off by default
if (RunService.IsStudio()) {
	task.spawn(() => {
		print(`[db] base url ...: ${baseUrl.get()}`);
		print(`[db] writes .....: ${writeToken.get() !== undefined ? "LIVE" : "off (read-only)"}`);
		print(`[db] http enabled: ${HttpService.HttpEnabled}`);
	});
}

export namespace ExternalDatabase {
	/** Stores Zstd and refuses a write to a row changed since it was read: rewriting a row as Zstd needs both. */
	export const canCompress = () => {
		const offered = negotiated();
		return offered.zstd && offered.ifUnchanged;
	};

	/** For ExternalSlot.ifUnchanged, of ExternalSave.text: the backend hashes the row it serves the same way. */
	export const hashOf = (text: string): string => {
		const encoding = game.GetService("EncodingService");
		const digest = encoding.ComputeStringHash(text, Enum.HashAlgorithm.Sha256);
		return buffer.tostring(encoding.Base64Encode(buffer.fromstring(digest)));
	};

	/**
	 * A JSON row's save as Zstd, unchanged apart from the encoding; undefined for a Zstd row, or unless the copy loads as
	 * exactly the same save.
	 */
	export const zstdCopy = (
		before: ExternalSave,
	): { readonly blob: buffer; readonly characters: number } | undefined => {
		const json = storedJson(before.text);
		if (json === undefined) return;

		const blob = ZstdSave.compress(json);
		const after = parseData(HttpService.JSONEncode({ zstd: ZstdSave.toBase64(blob) }));
		if (after === undefined) return;

		// deep, not by serialized text: table key order is not kept, so equal saves serialize differently
		const loads = (save: ExternalSave) => BlocksSerializer.objectToJson(save.blocks);
		return Objects.deepEquals(loads(before), loads(after)) ? { blob, characters: json.size() } : undefined;
	};

	/** Reachable and writable: reads work without a token, so a tokenless server would load slots and drop every save. */
	export const isAvailable = () => status.healthy && (RunService.IsStudio() || writeToken.get() !== undefined);

	export const GetPlayer = (UID: number): ExternalRead<PlayerDatabaseData> => {
		if (isDown()) return { ok: false, error: downError() };

		try {
			const response = request({
				Method: "GET",
				Url: `${baseUrl.get()}/player/${UID}`,
			});

			if (response.StatusCode !== 200 && response.StatusCode !== 404) {
				return { ok: false, error: reportStatus(response.StatusCode, "The player row", response.Body) };
			}

			markUp();
			if (response.StatusCode === 404) return { ok: true, value: undefined };

			// backend answers a miss with HTTP 200 and `{ error }`
			const body = JSON.deserialize(response.Body) as {
				readonly error?: string;
				readonly data?: PlayerDatabaseData | string;
			};
			if (body.error !== undefined || body.data === undefined) return { ok: true, value: undefined };

			const value = typeIs(body.data, "string") ? JSON.deserialize<PlayerDatabaseData>(body.data) : body.data;

			return { ok: true, value };
		} catch (err) {
			markDown(tostring(err));
			return { ok: false, error: tostring(err) };
		}
	};

	export const SetPlayer = (UID: number, data: PlayerDatabaseData): ExternalWrite => {
		if (isDown()) return { ok: false, error: downError() };

		const token = writeToken.get();
		if (!token) return { ok: false, error: "No write token was found" };

		try {
			const response = request({
				Method: "POST",
				Headers: {
					"Content-Type": "application/json",
				},
				Url: `${baseUrl.get()}/player`,
				Body: JSON.serialize({
					playerID: tostring(UID),
					data,
					token,
				}),
			});

			if (response.StatusCode !== 200) {
				return { ok: false, error: reportStatus(response.StatusCode, "The player row", response.Body) };
			}

			markUp();

			const body = JSON.deserialize<ExternalError | { status: string }>(response.Body);
			if ("error" in body) return { ok: false, error: body.error };

			return { ok: true };
		} catch (err) {
			markDown(tostring(err));
			return { ok: false, error: tostring(err) };
		}
	};

	/** Row keys the backend changed and this game has not pushed back yet; empty when there are none. */
	export const GetPendingChanges = (UID: number): ExternalRead<Partial<PlayerDatabaseData>> => {
		if (isDown()) return { ok: false, error: downError() };

		try {
			const response = request({
				Method: "GET",
				Url: `${baseUrl.get()}/player/${UID}/pending`,
			});

			if (response.StatusCode !== 200) {
				return { ok: false, error: reportStatus(response.StatusCode, "The pending changes", response.Body) };
			}

			markUp();
			return { ok: true, value: JSON.deserialize<Partial<PlayerDatabaseData>>(response.Body) };
		} catch (err) {
			markDown(tostring(err));
			return { ok: false, error: tostring(err) };
		}
	};

	/** Sets one block limit upstream, pending until a mirror carries it; undefined removes it. */
	export const SetBlockLimit = (
		UID: number,
		blockId: string,
		limit: number | undefined,
	): ExternalRead<PlayerBlockLimits> => {
		if (isDown()) return { ok: false, error: downError() };

		const token = writeToken.get();
		if (!token) return { ok: false, error: "No write token was found" };

		try {
			const response = request({
				Method: "POST",
				Headers: {
					"Content-Type": "application/json",
				},
				Url: `${baseUrl.get()}/player/blocks`,
				Body: JSON.serialize({
					playerID: tostring(UID),
					blockId,
					limit,
					token,
				}),
			});

			if (response.StatusCode !== 200) {
				return { ok: false, error: reportStatus(response.StatusCode, "The block limit", response.Body) };
			}

			markUp();

			const body = JSON.deserialize<ExternalError | { blocks: PlayerBlockLimits }>(response.Body);
			if ("error" in body) return { ok: false, error: body.error };

			return { ok: true, value: body.blocks };
		} catch (err) {
			markDown(tostring(err));
			return { ok: false, error: tostring(err) };
		}
	};

	export const GetSave = ([ownerID, slotID]: SlotKeys): ExternalRead<ExternalSave> => {
		if (isDown()) return { ok: false, error: downError() };

		let body: string;
		let reported = false;

		try {
			const fetchPage = (page: number) => {
				const response = request({
					Method: "GET",
					Url: `${baseUrl.get()}/save/${ownerID}/${slotID}/${page}`,
				});
				// thrown, so "unreadable" never reads as "no slot"
				if (response.StatusCode !== 200 && response.StatusCode !== 404) {
					reported = true;
					throw reportStatus(response.StatusCode, "The slot", response.Body);
				}
				return response;
			};

			const first = fetchPage(0);
			if (first.StatusCode === 404) return { ok: true, value: undefined };
			if (readPageError(first.Body) !== undefined) return { ok: true, value: undefined };

			body = first.Body;

			for (let page = 1; page < Transfer.maxPages; page++) {
				const response = fetchPage(page);
				if (response.StatusCode === 404) break;
				if (readPageError(response.Body) !== undefined) break;

				body += response.Body;
			}
		} catch (err) {
			if (!reported) markDown(tostring(err)); // only a dead socket arrives unreported

			return { ok: false, error: tostring(err) };
		}

		markUp();

		const value = parseData(body);
		if (value === undefined) {
			// "no slot" here would let the player overwrite it
			return { ok: false, error: "Failed to parse the external save data" };
		}

		return { ok: true, value };
	};

	/** Never throws; the caller decides what to do when the backend is down. */
	export const SaveSlot = (UID: number, slot: ExternalSlot): ExternalWrite => {
		if (isDown()) return { ok: false, error: downError() };

		const token = writeToken.get();
		if (!token) return { ok: false, error: "No write token was found" };

		const { zstd } = negotiated();
		if (isDown()) return { ok: false, error: downError() }; // negotiating can be what found it down
		if (slot.zstdOnly && !zstd) return { ok: false, error: "The database does not take Zstd" };

		try {
			// { version, blocks }, the shape the stored rows hold, or that as Zstd; parseData reads both
			const data = zstd ? { zstd: ZstdSave.toBase64(slot.blob) } : slot.blocks;
			const body = JSON.serialize({
				playerID: tostring(UID),
				index: tostring(slot.index),
				data,
				token,
				ifUnchanged: slot.ifUnchanged,
			});

			// chunking costs a round trip per part
			if (body.size() > Transfer.maxBody) {
				return uploadInChunks(UID, slot, JSON.serialize(data), token, zstd);
			}

			const response = request({
				Method: "POST",
				Headers: {
					"Content-Type": "application/json",
				},
				Url: `${baseUrl.get()}/save`,
				Body: body,
				Compress: compression(),
			});

			if (response.StatusCode !== 200) {
				return { ok: false, error: reportStatus(response.StatusCode, "This build", response.Body) };
			}

			markUp();

			const answer = JSON.deserialize<ExternalError | { status: string }>(response.Body);
			if ("error" in answer) return { ok: false, error: answer.error };

			return { ok: true, zstd };
		} catch (err) {
			markDown(tostring(err));
			return { ok: false, error: tostring(err) };
		}
	};

	/** Never throws: the result is the reply to an admin's destructive op, and a throw leaves it unanswered. */
	export const MigratePlayer = (fromPlayer: number, toPlayer: number): MigrationResponse => {
		if (isDown()) return migrationFailed;

		const token = writeToken.get();
		if (!token) return migrationFailed;

		print(`Migrating saves from ${fromPlayer} to ${toPlayer}`);

		// curl -X POST -H "Content-Type: application/json" -d '{"fromID":"238427763", "toID":"10897692300", "token":""}' https://ftrookie.com/overengineered/migrate
		try {
			const response = request({
				Method: "POST",
				Headers: {
					"Content-Type": "application/json",
				},
				Url: `${baseUrl.get()}/migrate`,
				Body: JSON.serialize({
					fromID: tostring(fromPlayer),
					toID: tostring(toPlayer),
					token,
				}),
			});

			if (response.StatusCode !== 200) {
				reportStatus(response.StatusCode, "The migration", response.Body);
				return migrationFailed;
			}

			markUp();
			return JSON.deserialize<MigrationResponse>(response.Body);
		} catch (err) {
			markDown(`Could not migrate ${fromPlayer} to ${toPlayer}: ${err}`);
			return migrationFailed;
		}
	};

	task.defer(() => {
		while (true as boolean) {
			negotiate(); // a backend upgraded or rolled back under a running server
			if (Players.GetPlayers().size() < Probe.playerThreshold) {
				GetPlayer(0); // a miss: the cheapest answer, and it still exercises the whole path
			}

			task.wait(Probe.interval);
		}
	});
}
