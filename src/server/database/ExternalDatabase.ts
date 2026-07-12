import { ConfigService, HttpService, Players, ServerScriptService } from "@rbxts/services";
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

let token: string | undefined;
const getToken = () => {
	if (token) return token;
	if (game.PlaceId === 0) {
		return (token = (
			require(
				ServerScriptService.FindFirstChild("TS")
					?.FindFirstChild("database")
					?.FindFirstChild("studiotoken") as ModuleScript,
			) as { writetoken: string }
		).writetoken);
	}
	try {
		token = ConfigService.GetConfigAsync().GetValue("TOKEN") as string | undefined;
	} catch {
		// local/Studio places have no config; treat as a missing token
	}
	return token;
};

export namespace ExternalDatabase {
	/** Reachable, based on the last request that actually happened — not on the cooldown expiring. */
	export const isAvailable = () => healthy;

	export const GetPlayer = (UID: number): ExternalRead<PlayerDatabaseData> => {
		if (isDown()) return { ok: false, error: downError() };

		try {
			const response = HttpService.RequestAsync({
				Method: "GET",
				Url: `https://www.ftrookie.com/overengineered/player/${UID}`,
			});

			if (response.StatusCode !== 200 && response.StatusCode !== 404) {
				markDown(`Got HTTP ${response.StatusCode}`);
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
			const response = HttpService.RequestAsync({
				Method: "POST",
				Headers: {
					"Content-Type": "application/json",
				},
				Url: `https://www.ftrookie.com/overengineered/player`,
				Body: JSON.serialize({
					playerID: tostring(UID),
					data,
					token,
				}),
			});

			if (response.StatusCode !== 200) {
				markDown(`Got HTTP ${response.StatusCode}`);
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
				const response = HttpService.RequestAsync({
					Method: "GET",
					Url: `https://www.ftrookie.com/overengineered/save/${ownerID}/${slotID}/${page}`,
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
			const response = HttpService.RequestAsync({
				Method: "POST",
				Headers: {
					"Content-Type": "application/json",
				},
				Url: `https://www.ftrookie.com/overengineered/save`,
				Body: JSON.serialize({
					playerID: tostring(UID),
					index: tostring(slot.index),
					// canonical shape, matching what the 15GB of existing rows hold: { version, blocks }
					data: slot.blocks,
					token,
				}),
			});

			if (response.StatusCode !== 200) {
				markDown(`Got HTTP ${response.StatusCode}`);
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
			const response = HttpService.RequestAsync({
				Method: "POST",
				Headers: {
					"Content-Type": "application/json",
				},
				Url: `https://www.ftrookie.com/overengineered/migrate`,
				Body: JSON.serialize({
					fromID: tostring(fromPlayer),
					toID: tostring(toPlayer),
					token,
				}),
			});

			if (response.StatusCode !== 200) {
				markDown(`Migration got HTTP ${response.StatusCode}`);
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
