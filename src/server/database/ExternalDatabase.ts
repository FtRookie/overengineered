import { HttpService } from "@rbxts/services";
import { JSON } from "engine/shared/fixes/Json";
import { Throttler } from "engine/shared/Throttler";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import type { PlayerDatabaseData } from "server/database/PlayerDatabase";
import type { LatestSerializedBlocks } from "shared/building/BlocksSerializer";

type errType = "OUT_OF_INDEX" | "NOT_FOUND" | "INCORRECT_TOKEN";
type SlotKeys = [ownerID: number, slotID: number];
export type ExternalSlot = {
	index: number;
	blocks: BlocksSerializer.JsonSerializedBlocks;
};

export namespace ExternalDatabase {
	export const GetPlayer = (UID: number): PlayerDatabaseData | undefined => {
		const result = HttpService.RequestAsync({
			Method: "GET",
			Url: `https://www.ftrookie.com/overengineered/player/${UID}`,
		});
		if (result.StatusCode === 404) {
			return undefined;
		}
		if (result.StatusCode !== 200) {
			throw `Got HTTP ${result.StatusCode}`;
		}
		const val = (JSON.deserialize(result.Body) as { data: PlayerDatabaseData | string }).data;
		if (typeIs(val, "string")) {
			return JSON.deserialize(val);
		}
		return val;
	};

	// work in progress
	export const GetSaves = (ownerID: number): ExternalSlot[] | undefined => {
		const result = HttpService.RequestAsync({
			Method: "GET",
			Url: `https://www.ftrookie.com/overengineered/save/${ownerID}`,
		});
		if (result.StatusCode === 404 || result.Body === '{"error":"Not found"}') {
			return undefined;
		}
		if (result.StatusCode !== 200) {
			throw `Got HTTP ${result.StatusCode}`;
		}
		const val = (
			JSON.deserialize(result.Body) as {
				saves: ExternalSlot[];
			}
		).saves.map((es) => ({ ...es, index: tonumber(es.index) }) as ExternalSlot);
		return val;
	};

	export const GetSave = ([ownerID, slotID]: SlotKeys): LatestSerializedBlocks | undefined => {
		let result = "";
		for (let pageIndex = 0; ; pageIndex++) {
			let response: RequestAsyncResponse;
			const throttle = Throttler.retryOnFail(3, 1, () => {
				response = HttpService.RequestAsync({
					Method: "GET",
					Url: `https://www.ftrookie.com/overengineered/save/${ownerID}/${slotID}/${pageIndex}`,
				});
			});
			assert(throttle.success, "Failed to fetch data, try again later if the HTTP request queue is full");
			assert(response!, "INVALID SAVE DATA RESPONSE");

			if (response.StatusCode === 404) {
				return;
			}
			if (response.StatusCode !== 200) {
				throw `Got HTTP ${response.StatusCode}`;
			}

			let parsedRequest;
			try {
				parsedRequest = JSON.deserialize<{ error?: string; err_type: errType }>(response.Body);
			} catch {
				//just a catch here ig?
				// string -> parse
				// failed -> concat
				// success -> got error
			}

			if (parsedRequest?.error) {
				if (parsedRequest.err_type === "OUT_OF_INDEX") break;
				return;
			}

			result += response.Body;
		}

		print("Parsing save data..");
		const p1 = JSON.deserialize(result) as { data: string };
		const p2 = (
			typeOf(p1.data) === "string" ? JSON.deserialize(p1.data) : p1.data
		) as BlocksSerializer.JsonSerializedBlocks;

		const val = BlocksSerializer.jsonToObject(p2);

		print("Save data parsing success!");
		return val;
	};
}
