import { ConfigService, HttpService } from "@rbxts/services";
import { JSON } from "engine/shared/fixes/Json";
import { isNotAdmin_AutoBanned } from "server/BanAdminExploiter";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import { CustomRemotes } from "shared/Remotes";
import type { PlayerDatabaseData } from "server/database/PlayerDatabase";
import type { LatestSerializedBlocks } from "shared/building/BlocksSerializer";

type errType = "OUT_OF_INDEX" | "NOT_FOUND" | "INCORRECT_TOKEN";
type SlotKeys = [ownerID: number, slotID: number];
export type ExternalSlot = {
	index: number;
	blocks: BlocksSerializer.JsonSerializedBlocks;
};

export type MigrationResponse = {
	metadata: "SUCCESS" | "FAIL";
	saves: "SUCCESS" | "FAIL";
};

const ParseData = (data: string): LatestSerializedBlocks => {
	const p1 = JSON.deserialize(data) as { data: string };
	const p2 = (
		typeOf(p1.data) === "string" ? JSON.deserialize(p1.data) : p1.data
	) as BlocksSerializer.JsonSerializedBlocks;
	return BlocksSerializer.jsonToObject(p2);
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
		if (result.StatusCode === 404) return undefined;
		if (result.StatusCode !== 200) throw `Got HTTP ${result.StatusCode}`;

		const val = (JSON.deserialize(result.Body) as { data: PlayerDatabaseData | string }).data;
		if (typeIs(val, "string")) {
			return JSON.deserialize(val);
		}
		return val;
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

	export const MigratePlayer = (fromPlayer: number, toPlayer: number): MigrationResponse => {
		const token = ConfigService.GetConfigAsync().GetValue("TOKEN");
		if (!token) return { metadata: "FAIL", saves: "FAIL" } as MigrationResponse;
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
				token: token,
			}),
		});
		return JSON.deserialize<MigrationResponse>(requestResult.Body);
	};
}
