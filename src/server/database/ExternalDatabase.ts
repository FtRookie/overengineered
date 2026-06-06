import { ConfigService, HttpService, ServerScriptService } from "@rbxts/services";
import { JSON } from "engine/shared/fixes/Json";
import { isNotAdmin_AutoBanned } from "server/BanAdminExploiter";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import { CustomRemotes } from "shared/Remotes";
import type { PlayerDatabaseData } from "server/database/PlayerDatabase";
import type { LatestSerializedBlocks } from "shared/building/BlocksSerializer";

type errType = "HTTP" | "OUT_OF_INDEX" | "NOT_FOUND" | "INCORRECT_TOKEN";
type ExternalError = {
	error: string;
	err_type: errType;
};
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
		const p1 = JSON.deserialize(data) as { data: string | BlocksSerializer.JsonSerializedBlocks };
		const p2 = (
			typeOf(p1.data) === "string" ? JSON.deserialize(p1.data as string) : p1.data
		) as BlocksSerializer.JsonSerializedBlocks;
		for (const [k, v] of pairs(p2)) print(k ?? "no key", v ?? "nothing");
		return BlocksSerializer.jsonToObject(p2);
	} catch (what) {
		print(what);
		error("Failed to parse external save data");
	}
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
	CustomRemotes.admin.adminMigrateRequest.invoked.Connect((player, arg) => {
		if (isNotAdmin_AutoBanned(player, "adm_request_migration")) return;
		CustomRemotes.admin.adminMigrateReply.send(player, MigratePlayer(arg.from, arg.to));
	});

	export const GetPlayer = (UID: number): PlayerDatabaseData | undefined => {
		const result = HttpService.RequestAsync({
			Method: "GET",
			Url: `https://www.ftrookie.com/overengineered/player/${UID}`,
		});
		assert(result.Body, "RETURNED INVALID DATA");
		if (result.StatusCode === 404) return undefined;
		if (result.StatusCode !== 200) throw `Got HTTP ${result.StatusCode}`;

		const val = (JSON.deserialize(result.Body) as { data: PlayerDatabaseData | string }).data;
		if (typeIs(val, "string")) {
			return JSON.deserialize(val);
		}
		return val;
	};

	export const SetPlayer = (UID: number, pdata: PlayerDatabaseData) => {
		if (!getToken()) return { error: "No token was found", err_type: "INCORRECT_TOKEN" };
		const requestResult = HttpService.RequestAsync({
			Method: "POST",
			Headers: {
				"Content-Type": "application/json",
			},
			Url: `https://www.ftrookie.com/overengineered/player`,
			Body: JSON.serialize({
				playerID: tostring(UID),
				pdata, // Technically different from how processed player data is inserted
				token: getToken(),
			}),
		});
		if (requestResult.StatusCode === 404) return { err_type: "HTTP", error: "404 Bad Request" };
		if (requestResult.StatusCode !== 200) throw `Got HTTP ${requestResult.StatusCode}`;
		return JSON.deserialize<ExternalError | { status: string }>(requestResult.Body);
	};

	// Probably unnecessary now
	// export const GetSaves = (ownerID: number): ExternalSlot[] | undefined => {
	// 	const result = HttpService.RequestAsync({
	// 		Method: "GET",
	// 		Url: `https://www.ftrookie.com/overengineered/save/${ownerID}`,
	// 	});
	// 	if (result.StatusCode === 404 || result.Body === '{"error":"Not found"}') {
	// 		return undefined;
	// 	}
	// 	if (result.StatusCode !== 200) {
	// 		throw `Got HTTP ${result.StatusCode}`;
	// 	}
	// 	const val = (
	// 		JSON.deserialize(result.Body) as {
	// 			saves: ExternalSlot[];
	// 		}
	// 	).saves.map((es) => ({ ...es, index: tonumber(es.index) }) as ExternalSlot);
	// 	return val;
	// };

	export const GetSave = ([ownerID, slotID]: SlotKeys): LatestSerializedBlocks | undefined => {
		let result = "";
		try {
			// Attempt to parse the first call, on exception continue trying to load more pages
			const response = HttpService.RequestAsync({
				Method: "GET",
				Url: `https://www.ftrookie.com/overengineered/save/${ownerID}/${slotID}/${0}`,
			});
			if (response.StatusCode === 404) return;
			if (response.StatusCode !== 200) throw `Got HTTP ${response.StatusCode}`;
			result += response.Body;
			const v = ParseData(response.Body);
			print("Successfully loaded data on first try");
			return v;
		} catch {
			// First call did not parse, must be larger slot or invalid data
			for (let pageIndex = 1; ; pageIndex++) {
				const response = HttpService.RequestAsync({
					Method: "GET",
					Url: `https://www.ftrookie.com/overengineered/save/${ownerID}/${slotID}/${pageIndex}`,
				});
				if (response.StatusCode === 404) return;
				if (response.StatusCode !== 200) throw `Got HTTP ${response.StatusCode}`;

				let parsedRequest;
				try {
					// Checks for error message
					parsedRequest = JSON.deserialize<{ error?: string; err_type: errType }>(response.Body);
					if (parsedRequest?.error) {
						if (parsedRequest.err_type === "OUT_OF_INDEX") break;
					}
				} catch {
					print(`Concatenated page #${pageIndex + 1}`);
					result += response.Body;
				}
			}
		}

		print("Parsing save data..");
		const val = ParseData(result);

		print("Save data parsing success!");
		return val;
	};

	export const SaveSlot = (UID: number, slot: ExternalSlot): ExternalError | { status: string } => {
		if (!getToken()) return { error: "No token was found", err_type: "INCORRECT_TOKEN" };
		const requestResult = HttpService.RequestAsync({
			Method: "POST",
			Headers: {
				"Content-Type": "application/json",
			},
			Url: `https://www.ftrookie.com/overengineered/save`,
			Body: JSON.serialize({
				playerID: tostring(UID),
				index: tostring(slot.index),
				data: { data: slot.blocks }, // Studio testing indicates this did not work but maybe its different
				token: getToken(),
			}),
		});
		if (requestResult.StatusCode === 404) return { err_type: "HTTP", error: "404 Bad Request" };
		if (requestResult.StatusCode !== 200) throw `Got HTTP ${requestResult.StatusCode}`;
		return JSON.deserialize<ExternalError | { status: string }>(requestResult.Body);
	};

	export const MigratePlayer = (fromPlayer: number, toPlayer: number): MigrationResponse => {
		if (!getToken()) return { metadata: "FAIL", saves: "FAIL" } as MigrationResponse;
		print(`Migrating saves from ${fromPlayer} to ${toPlayer}`);

		// curl -X POST -H "Content-Type: application/json" -d '{"fromID":"238427763", "toID":"10897692300", "token":""}' https://ftrookie.com/overengineered/migrate
		const requestResult = HttpService.RequestAsync({
			Method: "POST",
			Headers: {
				"Content-Type": "application/json",
			},
			Url: `https://www.ftrookie.com/overengineered/migrate`,
			Body: JSON.serialize({
				fromID: tostring(fromPlayer),
				toID: tostring(toPlayer),
				token: getToken(),
			}),
		});
		if (requestResult.StatusCode === 404) return { metadata: "FAIL", saves: "FAIL" } as MigrationResponse;
		if (requestResult.StatusCode !== 200) throw `Got HTTP ${requestResult.StatusCode}`;
		return JSON.deserialize<MigrationResponse>(requestResult.Body);
	};
}
