import { ConfigService, HttpService, Players, RunService, ServerScriptService } from "@rbxts/services";
import { JSON } from "engine/shared/fixes/Json";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import type { PlayerDatabaseData } from "server/database/PlayerDatabase";
import type { LatestSerializedBlocks } from "shared/building/BlocksSerializer";

type ErrType = "HTTP" | "OUT_OF_INDEX" | "NOT_FOUND" | "INCORRECT_TOKEN";
type ExternalError = {
	error: string;
	err_type: ErrType;
};

/** "Answered, no slot" makes a datastore fallback safe; "unreachable" makes it lethal. Never conflate them. */
export type ExternalRead<T> =
	{ readonly ok: true; readonly value: T | undefined } | { readonly ok: false; readonly error: string };

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

/** The backend's own error tag, when it answered with one. */
const errTypeOf = (body: string | undefined): string | undefined => {
	if (body === undefined || body === "") return undefined;

	const [ok, parsed] = pcall(() => JSON.deserialize(body));
	if (!ok || !typeIs(parsed, "table")) return undefined;

	const errType = (parsed as { readonly err_type?: unknown }).err_type;
	return typeIs(errType, "string") ? errType : undefined;
};

/** A 4xx is the request's fault, a 5xx or a dead socket the backend's; tripping the breaker on a 4xx once took every player's slots down over one oversized build. */
const reportStatus = (status: number, what: string, body?: string): string => {
	// same trap, 5xx side: one unreadable row is not an outage, and no retry mends it
	if (status >= 500 && errTypeOf(body) === "CORRUPT_ROW") {
		const reason = `${what} is stored corrupted and cannot be read`;
		warn(`[ExternalDatabase] ${reason}`);

		return reason;
	}

	const reason =
		status === 413
			? `${what} is too large for the database (over ~1MB) — HTTP 413`
			: `Got HTTP ${status} from ${getBaseUrl()}`;

	if (status >= 500) {
		markDown(reason);
	} else {
		warn(`[ExternalDatabase] ${reason}`);
	}

	return reason;
};

/** Generated from .env, since Roblox cannot read .env itself; absent means read-only against production, the safe default. */
type StudioConfig = {
	readonly writetoken?: string;
	readonly baseurl?: string;
};

const PRODUCTION_URL = "https://www.ftrookie.com/overengineered";

let studioConfig: StudioConfig | undefined;
const getStudioConfig = (): StudioConfig => {
	if (studioConfig !== undefined) return studioConfig;

	const module = ServerScriptService.FindFirstChild("studioconfig") as ModuleScript | undefined;
	return (studioConfig = module ? (require(module) as StudioConfig) : {});
};

let baseUrl: string | undefined;

/** Production unless DB_BASEURL overrides it, and only in Studio, so a stray value can never redirect a live server. */
const getBaseUrl = (): string => {
	if (baseUrl !== undefined) return baseUrl;

	baseUrl = PRODUCTION_URL;

	// "" is truthy in Luau, so an unfilled placeholder has to be excluded explicitly.
	const override = RunService.IsStudio() ? getStudioConfig().baseurl : undefined;
	if (override === undefined || override === "") return baseUrl;

	// a bare host fails indistinguishably from the backend being down, so reject it by name
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
		// a live write path: a Studio session autosaves and snapshots on exit, so it writes without anyone pressing Save
		warn(`[ExternalDatabase] WRITES ARE LIVE: this Studio session will save into ${getBaseUrl()}`);
	}

	return token;
};

/** Studio-only request tracing: a bad URL, a throttled link and a dead backend look identical without the numbers. */
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
	/** Reachable AND writable: reads work without a token, so a tokenless server would load slots and silently drop every save. */
	export const isAvailable = () => healthy && (RunService.IsStudio() || getToken() !== undefined);

	export const GetPlayer = (UID: number): ExternalRead<PlayerDatabaseData> => {
		if (isDown()) return { ok: false, error: downError() };

		try {
			const response = request({
				Method: "GET",
				Url: `${getBaseUrl()}/player/${UID}`,
			});

			if (response.StatusCode !== 200 && response.StatusCode !== 404) {
				return { ok: false, error: reportStatus(response.StatusCode, "The player row", response.Body) };
			}

			markUp();
			if (response.StatusCode === 404) return { ok: true, value: undefined };

			// a miss answers HTTP 200 with `{ error }` rather than 404, so the body has to be checked too
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

	/** Any structured `{ error }` body ends the page walk; raw 1MB chunks are not valid JSON and fall through. */
	const readPageError = (body: string): string | undefined => {
		try {
			return JSON.deserialize<{ error?: string; err_type?: ErrType }>(body)?.error;
		} catch {
			return undefined;
		}
	};

	/** Big saves are chunked at 1MB by the backend, so a slot may span several pages. */
	const MAX_PAGES = 512;

	export const GetSave = ([ownerID, slotID]: SlotKeys): ExternalRead<LatestSerializedBlocks> => {
		if (isDown()) return { ok: false, error: downError() };

		let body: string;

		let reported = false;

		try {
			const fetchPage = (page: number) => {
				const response = request({
					Method: "GET",
					Url: `${getBaseUrl()}/save/${ownerID}/${slotID}/${page}`,
				});
				// throw, so the caller learns "unreadable" instead of quietly seeing "no slot"
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

			for (let page = 1; page < MAX_PAGES; page++) {
				const response = fetchPage(page);
				if (response.StatusCode === 404) break;

				// break on ANY structured error: breaking only on OUT_OF_INDEX spun this loop forever
				if (readPageError(response.Body) !== undefined) break;

				body += response.Body;
			}
		} catch (err) {
			// fetchPage already decided what an HTTP status means. Only a dead socket arrives here unreported.
			if (!reported) markDown(tostring(err));

			return { ok: false, error: tostring(err) };
		}

		markUp();

		const value = ParseData(body);
		if (value === undefined) {
			// reachable but unreadable — never report as "no slot", or the caller lets the player overwrite it
			return { ok: false, error: "Failed to parse the external save data" };
		}

		return { ok: true, value };
	};

	/** Roblox refuses a request body past roughly 1MB whatever the backend allows, so anything larger goes up in pieces. */
	const MAX_BODY = 900_000;

	/** Below this a split is not worth attempting; something is pathological. */
	const MIN_CHUNK = 32_000;

	/** A byte index at or before `at` that is not inside a multi-byte character: `sub` counts bytes, and half a character is not valid UTF-8. */
	const utf8SafeEnd = (s: string, at: number): number => {
		if (at >= s.size()) return s.size();

		const start = utf8.offset(s, 0, at + 1);
		return start === undefined ? at : start - 1;
	};

	/** Either every body fits, or the size of the first one that did not — which is what sizes the next try. */
	type BuiltBodies =
		{ readonly ok: true; readonly bodies: string[] } | { readonly ok: false; readonly oversize: number };

	const buildUploadBodies = (
		UID: number,
		slot: ExternalSlot,
		uploadID: string,
		payload: string,
		token: string,
		chunk: number,
	): BuiltBodies => {
		// boundaries first: the envelope carries the total part count, so nothing encodes until every cut is known
		const ends: number[] = [];
		let at = 1;
		while (at <= payload.size()) {
			let stop = utf8SafeEnd(payload, at + chunk - 1);

			// a chunk landing inside its own first character comes back empty and `at` never moves, so take one whole character
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
			});

			// measured, not calculated; bail on the first overflow, its size is all the caller needs
			if (body.size() > MAX_BODY) return { ok: false, oversize: body.size() };

			bodies.push(body);
			start = ends[i] + 1;
		}

		return { ok: true, bodies };
	};

	/** Uploads what the engine cannot send at once: the first attempt measures how much JSON escaping inflates a slice, and the next chunk is solved from that number. Nothing commits until every part is known to fit. */
	const uploadInChunks = (UID: number, slot: ExternalSlot, payload: string, token: string): ExternalWrite => {
		const uploadID = HttpService.GenerateGUID(false);

		// Start as if nothing inflates. It will, and the overflow tells us by how much.
		let chunk = MAX_BODY;
		let bodies: string[] | undefined;

		for (let attempt = 0; attempt < 8; attempt++) {
			const built = buildUploadBodies(UID, slot, uploadID, payload, token, chunk);
			if (built.ok) {
				bodies = built.bodies;
				break;
			}

			// scale by how far over it went, then shave a little: the fixed envelope makes the relation non-linear
			const fitted = math.floor((chunk * MAX_BODY) / built.oversize) - 1024;
			if (fitted < MIN_CHUNK || fitted >= chunk) break;

			chunk = fitted;
		}

		if (bodies === undefined) {
			return { ok: false, error: "This build cannot be split small enough to send" };
		}

		for (const body of bodies) {
			const response = request({
				Method: "POST",
				Headers: { "Content-Type": "application/json" },
				Url: `${getBaseUrl()}/save/chunk`,
				Body: body,
			});

			if (response.StatusCode !== 200) {
				return { ok: false, error: reportStatus(response.StatusCode, "This build", response.Body) };
			}

			markUp();

			const answer = JSON.deserialize<ExternalError | { status: string }>(response.Body);
			if ("error" in answer) return { ok: false, error: answer.error };
		}

		return { ok: true };
	};

	/** Writes a slot. Never throws — the caller decides what to do when the backend is down. */
	export const SaveSlot = (UID: number, slot: ExternalSlot): ExternalWrite => {
		if (isDown()) return { ok: false, error: downError() };

		const token = getToken();
		if (!token) return { ok: false, error: "No write token was found" };

		try {
			// canonical shape, matching what the 15GB of existing rows hold: { version, blocks }
			const body = JSON.serialize({
				playerID: tostring(UID),
				index: tostring(slot.index),
				data: slot.blocks,
				token,
			});

			// Chunking costs a round trip per part, so only pay it when the build genuinely cannot fit.
			if (body.size() > MAX_BODY) {
				return uploadInChunks(UID, slot, JSON.serialize(slot.blocks), token);
			}

			const response = request({
				Method: "POST",
				Headers: {
					"Content-Type": "application/json",
				},
				Url: `${getBaseUrl()}/save`,
				Body: body,
			});

			if (response.StatusCode !== 200) {
				return { ok: false, error: reportStatus(response.StatusCode, "This build", response.Body) };
			}

			markUp();

			const answer = JSON.deserialize<ExternalError | { status: string }>(response.Body);
			if ("error" in answer) return { ok: false, error: answer.error };

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
}
