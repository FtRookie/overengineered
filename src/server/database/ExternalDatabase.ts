import { HttpService } from "@rbxts/services";
import { JSON } from "engine/shared/fixes/Json";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import type { PlayerDatabaseData } from "server/database/PlayerDatabase";
import type { LatestSerializedBlocks } from "shared/building/BlocksSerializer";

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
		const result = HttpService.RequestAsync({
			Method: "GET",
			Url: `https://www.ftrookie.com/overengineered/save/${ownerID}/${slotID}`,
		});
		if (result.StatusCode === 404 || result.Body === '{"error":"Not found"}') {
			return undefined;
		}
		if (result.StatusCode !== 200) {
			throw `Got HTTP ${result.StatusCode}`;
		}
		const val = BlocksSerializer.jsonToObject(
			(JSON.deserialize(result.Body) as { data: BlocksSerializer.JsonSerializedBlocks }).data,
		);
		if (typeIs(val, "string")) {
			return JSON.deserialize(val);
		}
		return val;
	};
}
