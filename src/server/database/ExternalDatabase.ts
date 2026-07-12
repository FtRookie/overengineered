import { ConfigService, HttpService, Players, RunService, ServerScriptService } from "@rbxts/services";
import { JSON } from "engine/shared/fixes/Json";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import type { PlayerDatabaseData } from "server/database/PlayerDatabase";
import type { LatestSerializedBlocks } from "shared/building/BlocksSerializer";

type errType = "HTTP" | "OUT_OF_INDEX" | "NOT_FOUND" | "INCORRECT_TOKEN";
type ExternalError = {
	error: string;
	err_type: errType;
};

/** "Answered, no slot" makes a datastore fallback safe; "unreachable" makes it lethal. Never conflate them. */
export type ExternalRead<T> =
	| { readonly ok: true; readonly value: T | undefined }
	| { readonly ok: false; readonly error: string };

/** A write either landed on the backend, or it did not. Never "probably". */
export type ExternalWrite = { readonly ok: true } | { readonly ok: false; readonly error: string };
type SlotKeys = [ownerID: number, slotID: number];
export type ExternalSlot = {
	index: number;
	blocks: BlocksSerializer.JsonSerializedBlocks;
};

export type MigrationResponse = {
	metadata: "SUCCESS" | "FAIL";
	saves: "SUCCESS" | "FAIL";
};

const ParseData = (data: string): LatestSerializedBlocks | undefined => {
	try {
		let node: unknown = JSON.deserialize(data);

		// Existing rows carry several historical wrappings. Peel to { version, blocks }; bounded, so junk cannot loop.
		for (let i = 0; i < 8; i++) {
			if (typeIs(node, "string")) {
				node = JSON.deserialize(node);
				continue;
			}
			if (!typeIs(node, "table")) break;

			const tbl = node as { readonly blocks?: unknown; readonly data?: unknown };
			if (tbl.blocks !== undefined) break;
			if (tbl.data === undefined) break;

			node = tbl.data;
		}

		return BlocksSerializer.jsonToObject(node as BlocksSerializer.JsonSerializedBlocks);
	} catch (what) {
		// Return, don't throw: "unreadable" must stay distinguishable from "unreachable".
		$err(`Failed to parse external save data: ${what}`);
		return undefined;
	}
};

/** Fail fast once the backend is down: the quit-save runs per player inside a ~30s shutdown budget. */
const UNHEALTHY_COOLDOWN_SEC = 30;
let unhealthyUntil = 0;

/** Observed state, not the cooldown: isDown() expiring means "retry", never "recovered". */
let healthy = true;

/** Without this the breaker answers every caller with a flat "unavailable" and the cause is never seen. */
let lastError = "no requests have failed";

const isDown = () => os.clock() < unhealthyUntil;
const downError = () => `The database is unavailable (${lastError})`;

const markDown = (reason: string) => {
	healthy = false;
	lastError = reason;
	unhealthyUntil = os.clock() + UNHEALTHY_COOLDOWN_SEC;

	warn(`[ExternalDatabase] ${reason}`);
};
const markUp = () => {
	healthy = true;
	unhealthyUntil = 0;
};

/** studiotoken.json — generated from .env by the watch script, never edited by hand. Roblox cannot read .env,
 *  so the values have to arrive as a Rojo-synced ModuleScript. */
type StudioConfig = {
	readonly writetoken?: string;
	readonly baseurl?: string;
};

const PRODUCTION_URL = "https://www.ftrookie.com/overengineered";

let studioConfig: StudioConfig | undefined;
const getStudioConfig = (): StudioConfig => {
	if (studioConfig !== undefined) return studioConfig;

	const module = ServerScriptService.FindFirstChild("TS")
		?.FindFirstChild("database")
		?.FindFirstChild("studiotoken") as ModuleScript | undefined;

	return (studioConfig = module ? (require(module) as StudioConfig) : {});
};

let baseUrl: string | undefined;

/**
 * Production, unless DB_BASEURL in .env overrides it — and only in Studio, so a stray value can never redirect
 * a live server. A dev whose link cannot pull real saves points it at scripts/dbrelay.js. See README.
 */
const getBaseUrl = (): string => {
	if (baseUrl !== undefined) return baseUrl;

	baseUrl = PRODUCTION_URL;

	// "" is truthy in Luau, so an unfilled placeholder has to be excluded explicitly.
	const override = RunService.IsStudio() ? getStudioConfig().baseurl : undefined;
	if (override === undefined || override === "") return baseUrl;

	// A bare host ("ftrookie.com") is the easy mistake, and HttpService answers it with a failure that is
	// indistinguishable from the backend being down. Reject it by name rather than let it masquerade.
	if (!override.startsWith("http://") && !override.startsWith("https://")) {
		warn(
			`[ExternalDatabase] Ignoring baseurl "${override}": it needs the scheme and the base path, ` +
				`e.g. "https://www.ftrookie.com/overengineered". Using production.`,
		);
		return baseUrl;
	}

	// A trailing slash would make every request double-slashed.
	baseUrl = override.sub(-1) === "/" ? override.sub(1, override.size() - 1) : override;
	warn(`[ExternalDatabase] Talking to ${baseUrl} instead of production.`);

	return baseUrl;
};

let token: string | undefined;
let tokenResolved = false;

/** Resolved once, a MISS included: GetConfigAsync yields, and re-dialling it per write spams and stalls. */
const getToken = (): string | undefined => {
	if (tokenResolved) return token;
	tokenResolved = true;

	// IsStudio, not PlaceId === 0: Studio on a PUBLISHED place has a real PlaceId and no ConfigService TOKEN.
	if (RunService.IsStudio()) {
		token = getStudioConfig().writetoken;
	} else {
		try {
			token = ConfigService.GetConfigAsync().GetValue("TOKEN") as string | undefined;
		} catch (err) {
			$err(`Could not read the write token: ${err}`);
		}
	}

	// "" is TRUTHY in Luau, so the empty placeholder used to sail through every `if (!token)` guard.
	if (token === "") token = undefined;

	// A bare warn, not $log: the log macros are off by default, and this must reach a dev who turned nothing on.
	if (token === undefined) {
		warn(
			RunService.IsStudio()
				? "[ExternalDatabase] No write token: Studio is READ-ONLY against the external database. Loads " +
						"work; saves queue in the datastore and never leave this session. Put a writetoken in " +
						".env as WRITETOKEN to write for real."
				: "[ExternalDatabase] No write token. NOTHING can be saved to the external database — every " +
						"save will queue in the datastore instead.",
		);
	} else if (RunService.IsStudio()) {
		// WRITETOKEN is a live write path, and it is not just the Save button: a Studio session autosaves and
		// snapshots the plot on exit. Nobody should learn that from the aftermath.
		warn(`[ExternalDatabase] WRITES ARE LIVE: this Studio session will save into ${getBaseUrl()}`);
	}

	return token;
};

/**
 * Studio-only tracing of every request: URL, size, duration. A bad URL, a throttled link and a dead backend
 * all look identical from the error alone — only the numbers separate them. Rethrows; callers still catch.
 */
const request = (options: RequestAsyncRequest): RequestAsyncResponse => {
	const started = os.clock();
	const [ok, result] = pcall(() => HttpService.RequestAsync(options));

	if (RunService.IsStudio()) {
		const took = math.floor((os.clock() - started) * 1000);
		const response = result as RequestAsyncResponse;
		const outcome = ok ? `HTTP ${response.StatusCode}, ${response.Body.size()} bytes` : `FAILED -> ${result}`;

		print(`[db] ${options.Method ?? "GET"} ${options.Url}\n     -> ${outcome} (${took}ms)`);
	}

	if (!ok) throw result;
	return result as RequestAsyncResponse;
};

/** Startup summary. Bare print: the log macros are off by default, which makes them useless here. */
if (RunService.IsStudio()) {
	task.spawn(() => {
		print(`[db] base url ...: ${getBaseUrl()}`);
		print(`[db] writes .....: ${getToken() !== undefined ? "LIVE" : "off (read-only)"}`);
		print(`[db] http enabled: ${HttpService.HttpEnabled}`);
	});
}

export namespace ExternalDatabase {
	/**
	 * Reachable AND writable. The token belongs here: reads work without one, so a server with no token would
	 * load slots happily and silently drop every save. In Studio a missing token is deliberate, not an outage.
	 */
	export const isAvailable = () => healthy && (RunService.IsStudio() || getToken() !== undefined);

	export const GetPlayer = (UID: number): ExternalRead<PlayerDatabaseData> => {
		if (isDown()) return { ok: false, error: downError() };

		try {
			const response = request({
				Method: "GET",
				Url: `${getBaseUrl()}/player/${UID}`,
			});

			if (response.StatusCode !== 200 && response.StatusCode !== 404) {
				markDown(`Got HTTP ${response.StatusCode} from ${getBaseUrl()}`);
				return { ok: false, error: `Got HTTP ${response.StatusCode}` };
			}

			markUp();
			if (response.StatusCode === 404) return { ok: true, value: undefined };

			// The backend answers a miss with HTTP 200 and `{ error: "Not found" }`, not a 404, so the
			// body has to be checked too — otherwise a miss would be parsed as a row.
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

		const token = getToken();
		if (!token) return { ok: false, error: "No write token was found" };

		try {
			const response = request({
				Method: "POST",
				Headers: {
					"Content-Type": "application/json",
				},
				Url: `${getBaseUrl()}/player`,
				Body: JSON.serialize({
					playerID: tostring(UID),
					data,
					token,
				}),
			});

			if (response.StatusCode !== 200) {
				markDown(`Got HTTP ${response.StatusCode} from ${getBaseUrl()}`);
				return { ok: false, error: `Got HTTP ${response.StatusCode}` };
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

	/** Any structured `{ error }` body ends the page walk. Raw 1MB chunks are not valid JSON, so they
	 *  fall through to `undefined` and get concatenated. */
	const readPageError = (body: string): string | undefined => {
		try {
			return JSON.deserialize<{ error?: string; err_type?: errType }>(body)?.error;
		} catch {
			return undefined;
		}
	};

	/** Big saves are chunked at 1MB by the backend, so a slot may span several pages. */
	const MAX_PAGES = 512;

	export const GetSave = ([ownerID, slotID]: SlotKeys): ExternalRead<LatestSerializedBlocks> => {
		if (isDown()) return { ok: false, error: downError() };

		let body: string;

		try {
			const fetchPage = (page: number) => {
				const response = request({
					Method: "GET",
					Url: `${getBaseUrl()}/save/${ownerID}/${slotID}/${page}`,
				});
				// Anything other than a hit or a clean miss means the backend is not healthy — throw so
				// the caller learns "unreachable" instead of quietly seeing "no slot".
				if (response.StatusCode !== 200 && response.StatusCode !== 404) {
					throw `Got HTTP ${response.StatusCode}`;
				}
				return response;
			};

			const first = fetchPage(0);
			if (first.StatusCode === 404) return { ok: true, value: undefined };
			if (readPageError(first.Body) !== undefined) return { ok: true, value: undefined };

			body = first.Body;

			for (let page = 1; page < MAX_PAGES; page++) {
				const response = fetchPage(page);
				if (response.StatusCode === 404) break;

				// Break on ANY structured error, not just OUT_OF_INDEX — the old code only broke on the
				// latter, so any other error spun this loop forever, hammering HTTP.
				if (readPageError(response.Body) !== undefined) break;

				body += response.Body;
			}
		} catch (err) {
			markDown(tostring(err));
			return { ok: false, error: tostring(err) };
		}

		markUp();

		const value = ParseData(body);
		if (value === undefined) {
			// Reachable but unreadable. Do NOT report this as "no slot": the caller would then treat the
			// slot as empty and happily let the player overwrite it.
			return { ok: false, error: "Failed to parse the external save data" };
		}

		return { ok: true, value };
	};

	/** Writes a slot. Never throws — the caller decides what to do when the backend is down. */
	export const SaveSlot = (UID: number, slot: ExternalSlot): ExternalWrite => {
		if (isDown()) return { ok: false, error: downError() };

		const token = getToken();
		if (!token) return { ok: false, error: "No write token was found" };

		try {
			const response = request({
				Method: "POST",
				Headers: {
					"Content-Type": "application/json",
				},
				Url: `${getBaseUrl()}/save`,
				Body: JSON.serialize({
					playerID: tostring(UID),
					index: tostring(slot.index),
					// canonical shape, matching what the 15GB of existing rows hold: { version, blocks }
					data: slot.blocks,
					token,
				}),
			});

			if (response.StatusCode !== 200) {
				markDown(`Got HTTP ${response.StatusCode} from ${getBaseUrl()}`);
				return { ok: false, error: `Got HTTP ${response.StatusCode}` };
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

	const migrationFailed: MigrationResponse = { metadata: "FAIL", saves: "FAIL" };

	/** Never throws: it used to throw inside the admin's reply argument, leaving a destructive op with no answer. */
	/** A busy server's own traffic keeps `healthy` fresh; a quiet one may not dial for an hour, so probe it. */
	const PROBE_PLAYER_THRESHOLD = 5;
	const PROBE_INTERVAL_SEC = 120;

	task.spawn(() => {
		while (true as boolean) {
			if (Players.GetPlayers().size() < PROBE_PLAYER_THRESHOLD) {
				// A miss is the cheapest thing the backend can answer, and it still exercises the whole path.
				GetPlayer(0);
			}

			task.wait(PROBE_INTERVAL_SEC);
		}
	});

	export const MigratePlayer = (fromPlayer: number, toPlayer: number): MigrationResponse => {
		if (isDown()) return migrationFailed;

		const token = getToken();
		if (!token) return migrationFailed;

		print(`Migrating saves from ${fromPlayer} to ${toPlayer}`);

		// curl -X POST -H "Content-Type: application/json" -d '{"fromID":"238427763", "toID":"10897692300", "token":""}' https://ftrookie.com/overengineered/migrate
		try {
			const response = request({
				Method: "POST",
				Headers: {
					"Content-Type": "application/json",
				},
				Url: `${getBaseUrl()}/migrate`,
				Body: JSON.serialize({
					fromID: tostring(fromPlayer),
					toID: tostring(toPlayer),
					token,
				}),
			});

			if (response.StatusCode !== 200) {
				markDown(`Migration got HTTP ${response.StatusCode} from ${getBaseUrl()}`);
				return migrationFailed;
			}

			markUp();
			return JSON.deserialize<MigrationResponse>(response.Body);
		} catch (err) {
			markDown(`Could not migrate ${fromPlayer} to ${toPlayer}: ${err}`);
			return migrationFailed;
		}
	};
}
