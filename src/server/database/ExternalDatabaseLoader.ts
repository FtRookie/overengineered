import { Sha256 } from "@rbxts/crypto";
import { ConfigService, HttpService, RunService } from "@rbxts/services";
import { JSON } from "engine/shared/fixes/Json";
import { studioConfig } from "server/database/ExternalDatabase";
import { BlocksSerializer, Filter } from "shared/building/BlocksSerializer";
import Base85 from "shared/utils/Base85";
import Cryptography from "shared/utils/rbx-cryptography";
import type { ExportError, ExportRead, SlotDatabase } from "server/database/SlotDatabase";
import type { LatestSerializedBlock, LatestSerializedBlocks } from "shared/building/BlocksSerializer";
import type { BuildingPlot } from "shared/building/BuildingPlot";

const EncodingService = game.GetService("EncodingService");

type NumericString = `${number}`;

// A UNIQUE ID for this game, it needs to NOT CHANGE, EVER!!!
// best to use `{github_username}/oe`
const UNIQUE_GAME_ID = "ftrookie/oe";

// A list of TRUSTED IDs, along with their associated database urls (from above)
const TRUSTED_GAMES: Record<string, string> = {
	"ftrookie/oe": "https://ftrookie.com/overengineered",
	// NOE doesnt work for now, the database is not external.
	// "space-cee/oe": "https://api.space-cee.com/overengineered",
};

// Skips the checksum, signature, and expiration checks when loading a save
// only applies in studio
const skipChecks = false;

function canonicalize(val: unknown): string {
	if (val === undefined) return "null";
	if (typeIs(val, "table")) {
		const pairsList: string[] = [];
		for (const [k, v] of pairs(val)) {
			pairsList.push(`${tostring(k)}:${canonicalize(v)}`);
		}
		return `{${pairsList.sort().join(",")}}`;
	}
	return tostring(val);
}

// Hash an object deterministically
function generateSignature(payload: object): string {
	return Sha256(canonicalize(payload));
}

type StaticVersions = "v1" | "v2";
const latestStaticVersion: StaticVersions = "v2";

type SaveReferenceBody = {
	mode: "reference";
	contentHash: string; // hash of the blocks, incase it changes (which is invalid)
	slotIndex: number;
	lastSaved: number; // (UnixTimestampMillis)
};
type SaveStaticBody = {
	mode: "static";
	contentHash: string;
	blocks: string; // static block save (compressed)
	version: StaticVersions; // version of save compression (for better compression)
};
type SaveBody = SaveReferenceBody | SaveStaticBody;
type GeneralSaveConfirmationPayload = {
	signature: string; // hash of the payload signed with a key from the original server
	keyVersion: "v1"; // incase the key format changes for whatever reason
	payload: {
		creatorId: string; // the original creator id (to get save from)
		originGameId: string; // id of the original game (eg `ftrookie/oe`)

		whitelist: string[]; // list of allowed player id's
		blacklist: string[]; // list of not allowed player id's
		isPublic: boolean; // if anyone except those on the blacklist can load
		expiration: NumericString | "NEVER"; // unix time when the payload expires

		checksum: number; // quick checksum
		body: SaveBody;
	};
};

// Values in Base64
type PublicKey = string;
type PrivateKey = string;

let exportPriToken: string | undefined;
let exportPriTokenResolved = false;
const getGamePrivateKey = (): string | undefined => {
	if (exportPriTokenResolved) return exportPriToken;
	exportPriTokenResolved = true;

	// IsStudio, not PlaceId === 0: Studio on a PUBLISHED place has a real PlaceId and no ConfigService TOKEN.
	if (RunService.IsStudio()) {
		exportPriToken = studioConfig.get().privatesavetoken;
		if (exportPriToken) return exportPriToken;
		warn("StudioConfig private key not found");
	}

	try {
		exportPriToken = ConfigService.GetConfigAsync().GetValue("EXPORTTOKEN") as string | undefined;
	} catch (err) {
		error(`Could not read the write token: ${err}`);
	}

	return exportPriToken;
};

let exportPubToken: string | undefined;
let exportPubTokenResolved = false;
const getGamePublicKey = (): string | undefined => {
	if (exportPubTokenResolved) return exportPubToken;
	exportPubTokenResolved = true;

	const privateKey = getGamePrivateKey();
	if (privateKey?.size() !== 64) return undefined;

	// Public key derived from private key
	const privateKeyBuf = Cryptography.Utilities.Conversions.FromHex(privateKey);
	const publicKeyBuf = Cryptography.Verification.EdDSA.PublicKey(privateKeyBuf);
	exportPubToken = Cryptography.Utilities.Conversions.ToHex(publicKeyBuf);
	return exportPubToken;
};

const getSignableString = (payload: GeneralSaveConfirmationPayload["payload"]) => {
	const sortedAllow = [...payload.whitelist].sort().join(",");
	const sortedDeny = [...payload.blacklist].sort().join(",");

	const body = payload.body;
	let bodyStr = `${body.contentHash}|${body.mode}|`;
	if (body.mode === "reference") {
		bodyStr += `${body.slotIndex}|${body.lastSaved}`;
	} else {
		bodyStr += `${body.version}|${Sha256(body.blocks)}`; // sha256 to compress it (for big builds)
	}

	return (
		`${payload.creatorId}|${payload.originGameId}|${sortedAllow}|${sortedDeny}|${payload.isPublic}|${payload.expiration}` +
		`||${bodyStr}`
	);
};

type ExpirationDurations = "5m" | "1h" | "1d" | "7d" | "30d" | "forever";
const get_expiration_date = (option: ExpirationDurations) => {
	const HOUR_IN_SECONDS = 3600;
	const DAY_IN_SECONDS = HOUR_IN_SECONDS * 24;
	const now = DateTime.now().UnixTimestamp;
	switch (option) {
		case "5m":
			return tostring(now + 60 * 5) as NumericString;
		case "1h":
			return tostring(now + HOUR_IN_SECONDS) as NumericString;
		case "1d":
			return tostring(now + DAY_IN_SECONDS) as NumericString;
		case "7d":
			return tostring(now + DAY_IN_SECONDS * 7) as NumericString;
		case "30d":
			return tostring(now + DAY_IN_SECONDS * 30) as NumericString;
		case "forever":
			return "NEVER";
	}
};

const date_is_expired = (date: string) => {
	if (date === "NEVER") return false;

	const expiration = tonumber(date);
	if (!expiration) return true;

	const now = DateTime.now().UnixTimestamp;
	return expiration < now;
};

// Returns the compressed block string and its version
// the `version` return is the version for decompression, `blocks` is the actual data
const compress_blocks = (
	compressV: string,
	blocks: LatestSerializedBlocks,
): { blocks: string; version: StaticVersions } => {
	if (compressV === "v1") {
		// V1 is just raw
		return { blocks: JSON.serialize(BlocksSerializer.objectToJson(blocks)), version: "v1" };
	}

	// If there are <50 blocks there is some chance it is more compact
	const compressedV1 = blocks.blocks.size() < 50 ? compress_blocks("v1", blocks) : undefined;

	if (compressV === "v2") {
		// V2 is compressed
		const raw = JSON.serialize(BlocksSerializer.objectToJson(blocks));
		const buff = buffer.fromstring(raw);
		const compressed = EncodingService.CompressBuffer(buff, Enum.CompressionAlgorithm.Zstd, 1);
		const base85 = Base85.Encode(compressed);

		// If V1 is smaller use that instead
		// sometimes zstd is bigger
		if (compressedV1) {
			if (compressedV1.blocks.size() < base85.size()) return compressedV1;
			print(`Saved ${compressedV1.blocks.size() / base85.size()}% in compression`);
		}

		return {
			blocks: base85,
			version: "v2",
		};
	}

	$warn(`Invalid compression mode: ${compressV}`);
	return { blocks: JSON.serialize([]), version: "v1" };
};
const uncompress_blocks = (compressV: StaticVersions, data: string): LatestSerializedBlocks => {
	if (compressV === "v1") {
		const jsonData = JSON.deserialize<BlocksSerializer.JsonSerializedBlocks>(data);
		return BlocksSerializer.jsonToObject(jsonData);
	} else if (compressV === "v2") {
		const buff = Base85.Decode(data);
		const uncompressed = EncodingService.DecompressBuffer(buff, Enum.CompressionAlgorithm.Zstd);
		const raw = buffer.tostring(uncompressed);
		const jsonData = JSON.deserialize<BlocksSerializer.JsonSerializedBlocks>(raw);
		return BlocksSerializer.jsonToObject(jsonData);
	}

	$warn(`Invalid compress mode: ${compressV}`);
	return { version: 0, blocks: [] };
};

const produce_payload = (
	owner: Player,
	whitelist: string[],
	blacklist: string[],
	expiration: ExpirationDurations,
	isPublic: boolean,
	body: SaveBody,
	privateKey: PrivateKey,
): GeneralSaveConfirmationPayload => {
	const payload = {
		creatorId: tostring(owner.UserId),
		originGameId: UNIQUE_GAME_ID,

		whitelist,
		blacklist,
		isPublic,
		expiration: get_expiration_date(expiration),

		checksum: 0, // placeholder value
	} as GeneralSaveConfirmationPayload["payload"];

	payload.body = body;

	// (note the checksum is not included so this is fine)
	const datastring = getSignableString(payload);
	payload.checksum = Cryptography.Checksums.CRC32(buffer.fromstring(datastring)) as number;

	const finalString = `${datastring}|${payload.checksum}`;

	const messageBuf = buffer.fromstring(finalString);
	const privateKeyBuf = Cryptography.Utilities.Conversions.FromHex(privateKey);
	const publicKeyBuf = Cryptography.Verification.EdDSA.PublicKey(privateKeyBuf);

	const signatureBuf = Cryptography.Verification.EdDSA.Sign(messageBuf, privateKeyBuf, publicKeyBuf);

	const result = {
		signature: buffer.tostring(Cryptography.Utilities.Base64.Encode(signatureBuf)),
		payload,
		keyVersion: "v1",
	} satisfies GeneralSaveConfirmationPayload;
	return result;
};

// Returns:
// Success: boolean, Payload: SaveConfirmationPayload["payload"], Reason?: string
// if success is false do not use the payload!!
const confirm_payload = (
	data: GeneralSaveConfirmationPayload,
	publicKey: PublicKey,
): { success: true; payload: GeneralSaveConfirmationPayload["payload"] } | { success: false; error: string } => {
	if (data.keyVersion !== "v1") {
		warn("This save version is not supported.");
		return { success: false, error: "Unsupported save version." };
	}

	const dataString = getSignableString(data.payload);

	if (data.payload.checksum !== Cryptography.Checksums.CRC32(buffer.fromstring(dataString))) {
		// skipcheck is only allowed in Studio for testing
		if (RunService.IsStudio() && skipChecks) {
			warn("Checksum mismatch skipped (Studio only)");
			return { success: true, payload: data.payload };
		}
		return { success: false, error: "Invalid checksum." };
	}

	if (date_is_expired(data.payload.expiration)) {
		// skipcheck is only allowed in Studio for testing
		if (RunService.IsStudio() && skipChecks) {
			warn("Save expiration skipped (Studio only)");
			return { success: true, payload: data.payload };
		}
		return { success: false, error: "Expired" };
	}

	const finalString = `${dataString}|${data.payload.checksum}`;

	const messageBuf = buffer.fromstring(finalString);
	const publicKeyBuf = Cryptography.Utilities.Conversions.FromHex(publicKey);

	const signatureBase64Buf = buffer.fromstring(data.signature);
	const signatureBuf = Cryptography.Utilities.Base64.Decode(signatureBase64Buf);

	const isValid = Cryptography.Verification.EdDSA.Verify(messageBuf, publicKeyBuf, signatureBuf);
	if (!isValid) {
		// skipcheck is only allowed in Studio for testing
		if (RunService.IsStudio() && skipChecks) {
			warn("Signature mismatch skipped (Studio only)");
			return { success: true, payload: data.payload };
		}
		return { success: false, error: "Invalid signature." };
	}

	return { success: true, payload: data.payload };
};

function fetchPage(baseURL: string, userId: number, slotIndex: number, page: number) {
	const [ok, response] = pcall(() =>
		HttpService.RequestAsync({
			Url: `${baseURL}/save/${userId}/${slotIndex}/${page}`,
			Method: "GET",
		}),
	);
	if (!ok || response.StatusCode !== 200) return undefined;
	return response;
}

type ErrType = "HTTP" | "OUT_OF_INDEX" | "NOT_FOUND" | "INCORRECT_TOKEN";
const readPageError = (body: string): string | undefined => {
	try {
		return JSON.deserialize<{ error?: string; err_type?: ErrType }>(body)?.error;
	} catch {
		return undefined;
	}
};

const MAX_PAGES = 512;
function getSave(baseUrl: string, userId: number, slotIndex: number, blockList: BlockList) {
	const first = fetchPage(baseUrl, userId, slotIndex, 0);
	if (first === undefined) return undefined;
	if (first.StatusCode === 404) return undefined;
	let body = first.Body;

	for (let page = 1; page < MAX_PAGES; page++) {
		const response = fetchPage(baseUrl, userId, slotIndex, page);
		if (!response) break;
		// Break on any structured error
		if (readPageError(response.Body) !== undefined) break;
		body += response.Body;
	}

	const json = JSON.deserialize<{ data: BlocksSerializer.JsonSerializedBlocks }>(body);
	const data = BlocksSerializer.jsonToObject(json.data);
	return BlocksSerializer.upgradeSave(data, blockList) as LatestSerializedBlocks;
}

@injectable
export class DatabaseLoader {
	constructor(
		@inject readonly slots: SlotDatabase,
		@inject readonly blockList: BlockList,
	) {}

	encode_packet(
		blocks: BuildingPlot,
		owner: Player,
		args: PlayerExportSlotRequest,
	): { success: true; packetString: string } | { success: false; error: ExportError | string } {
		if (
			typeOf(args.blacklist) !== "table" ||
			typeOf(args.whitelist) !== "table" ||
			typeOf(args.creatorId) !== "string"
		)
			return { success: false, error: "Invalid args" };

		// Validate creatorId matches the owner
		if (args.creatorId !== tostring(owner.UserId)) {
			return { success: false, error: "Creator ID mismatch" };
		}

		// Validate expiration format
		const validExpirations: ExpirationDurations[] = ["5m", "1h", "1d", "7d", "30d", "forever"];
		if (!validExpirations.includes(args.expiration as ExpirationDurations)) {
			return { success: false, error: "Invalid expiration value" };
		}

		// Validate whitelist/blacklist contain only valid user ID strings
		for (const id of args.whitelist) {
			const numId = tonumber(id);
			if (!numId || numId < 1) {
				return { success: false, error: `Invalid user ID in whitelist: ${id}` };
			}
		}
		for (const id of args.blacklist) {
			const numId = tonumber(id);
			if (!numId || numId < 1) {
				return { success: false, error: `Invalid user ID in blacklist: ${id}` };
			}
		}

		// Public exports must be static mode
		if (args.isPublic && args.mode === "reference") {
			return { success: false, error: "Public exports must use static mode" };
		}

		let blocksData: ExportRead;
		if (args.slotIndex === "current") {
			// Read data directly from the build
			const blockData = BlocksSerializer.serializeToObject(blocks);
			blocksData = { ok: true, value: blockData };
		} else {
			// Ignore local if mode is static, as it doesn't need the database (still needs the signature though)
			blocksData = this.slots.exportableBlocks(owner.UserId, args.slotIndex, args.mode === "static");
			if (!blocksData.ok) return { success: false, error: blocksData.error };
		}

		const blockData = blocksData.value;
		if (!blockData || blockData.blocks.size() === 0) {
			warn("BlockData does not contain any blocks");
			return { success: false, error: "Empty" };
		}
		const contentHash = generateSignature(blockData.blocks);
		let body: SaveBody;
		if (args.mode === "reference" && args.slotIndex !== "current") {
			body = {
				mode: "reference",
				slotIndex: args.slotIndex,
				contentHash,
				lastSaved: blockData.savedAt ?? 1,
			} satisfies SaveReferenceBody;
		} else {
			// Catches invalid modes, needed here as `else` is required for ts
			if (args.mode !== "static") error(`Invalid mode ${args.mode}`);

			body = {
				mode: "static",
				contentHash,
				...compress_blocks(latestStaticVersion, blockData),
			} satisfies SaveStaticBody;
		}
		const privateKey = getGamePrivateKey();
		// make sure private key is valid
		if (!privateKey) return { success: false, error: "Failed to get private key" };
		if (privateKey.size() !== 64) return { success: false, error: "Invalid private key, inform the owner" };
		const payload = produce_payload(
			owner,
			args.whitelist,
			args.blacklist,
			args.expiration,
			args.isPublic,
			body as SaveBody,
			privateKey,
		) as GeneralSaveConfirmationPayload;

		// Make sure the packet is actually valid (it should be)
		const checkResp = DatabaseLoader.check_packet(payload);
		if (!checkResp.success) {
			warn("Failed to confirm valitity of packet:", checkResp.error);
			return { success: false, error: "Failed to confirm: " + checkResp.error };
		}

		return { success: true, packetString: DatabaseLoader.packet2string(payload) };
	}

	static check_packet(
		packet: GeneralSaveConfirmationPayload,
	): { success: true; payload: GeneralSaveConfirmationPayload["payload"] } | { success: false; error: string } {
		// Get the PublicKey from the database using the provided GameId
		if (!(packet.payload.originGameId in TRUSTED_GAMES)) {
			return { success: false, error: "Invalid game id" };
		}
		let publicKey: PublicKey;
		const thisPublicKey = getGamePublicKey();
		if (packet.payload.originGameId === UNIQUE_GAME_ID && thisPublicKey) {
			// Use cached key for this game if available
			publicKey = thisPublicKey as PublicKey;
		} else {
			const url = TRUSTED_GAMES[packet.payload.originGameId];
			$debug("Getting private key from:", `${url}/saveexport_publickey`);
			const [ok, result] = pcall(() =>
				HttpService.RequestAsync({ Method: "GET", Url: `${url}/saveexport_publickey` }),
			);
			if (!ok) {
				$warn(`Failed to fetch private key:`, result);
				return { success: false, error: tostring(result) };
			}
			const response = result as RequestAsyncResponse;
			if (!response.Success) {
				$warn(
					`Error getting host's public key;\nStatus: ${response.StatusCode} Message: "${response.StatusMessage}"`,
				);
				return { success: false, error: response.StatusMessage };
			}
			try {
				publicKey = (HttpService.JSONDecode(response.Body) as { key: PublicKey })?.key;
				if (!publicKey) {
					$warn(`While getting publicKey response is invalid: "${response.Body}"`);
					return { success: false, error: "Invalid PublicKey" };
				}
			} catch (err) {
				$warn(`Failed to get public key: ${err}`);
				return { success: false, error: tostring(err) };
			}
		}

		const confirmResult = confirm_payload(packet, publicKey);
		if (!confirmResult.success) return { success: false, error: confirmResult.error };

		const databaseUrl = TRUSTED_GAMES[confirmResult.payload.originGameId];
		if (databaseUrl === undefined) {
			return { success: false, error: `GameID "${confirmResult.payload.originGameId}" is not allowed` };
		}

		return { success: true, payload: confirmResult.payload };
	}
	static packet_check_access(
		player: Player,
		payload: GeneralSaveConfirmationPayload["payload"],
	): { success: true } | { success: false; reason: string } {
		const userid = tostring(player.UserId);
		if (payload.blacklist.contains(userid)) return { success: false, reason: "Player is blacklisted" };
		// If packet is not public, check whitelist
		if (!payload.isPublic) {
			if (!(payload.whitelist.contains(userid) || payload.creatorId === userid))
				return { success: false, reason: "Player is not whitelisted" };
		}
		return { success: true };
	}

	// Blocks are not verified, might be invalid!
	get_blocks_for_packet(
		payload: GeneralSaveConfirmationPayload["payload"],
	): { success: true; blocks: LatestSerializedBlocks["blocks"] } | { success: false; error: string } {
		const cleanBlocks = (blockData: LatestSerializedBlocks) => {
			blockData = BlocksSerializer.upgradeSave(blockData, this.blockList) as LatestSerializedBlocks;
			Filter.cleanup(
				blockData.blocks.mapToMap((b) =>
					$tuple((b as LatestSerializedBlock).uuid, b as Writable<LatestSerializedBlock>),
				),
			);
			return blockData;
		};

		if (payload.body.mode === "reference") {
			const ownerId = tonumber(payload.creatorId);
			if (!ownerId) return { success: false, error: "Invalid creatorId" };
			const databaseUrl = TRUSTED_GAMES[payload.originGameId];
			if (databaseUrl === undefined) {
				warn("Invalid gameId");
				return { success: false, error: `GameID "${payload.originGameId}" is not allowed` };
			}
			let blockData = getSave(databaseUrl, ownerId, payload.body.slotIndex, this.blockList);
			if (!blockData) {
				warn("Failed to get data");
				return { success: false, error: "Failed to get data" };
			}

			if (blockData.version === undefined) return { success: false, error: "Corrupted slot data" };

			// Re-validate contentHash against fetched data to prevent tampering
			const fetchedContentHash = generateSignature(blockData.blocks);
			if (fetchedContentHash !== payload.body.contentHash) {
				warn(
					`Content hash mismatch for reference slot ${payload.body.slotIndex}: expected ${payload.body.contentHash}, got ${fetchedContentHash}`,
				);
				return { success: false, error: "Slot data has been modified since export" };
			}

			blockData = cleanBlocks(blockData);

			$debug(`Loading slot ${payload.body.slotIndex} using savev${blockData.version}`);

			return { success: true, blocks: blockData.blocks };
		} else {
			if ((payload.body.mode as string) !== "static") {
				warn("Unknown type: " + tostring(payload.body.mode));
				return { success: false, error: `Unknown mode: ${payload.body.mode}` };
			}

			let blockData = uncompress_blocks(payload.body.version, payload.body.blocks);
			blockData = cleanBlocks(blockData);

			return { success: true, blocks: blockData.blocks };
		}
	}

	// This uses base64 to be accessable and easy to read

	static packet2string(packet: GeneralSaveConfirmationPayload): string {
		return buffer.tostring(Cryptography.Utilities.Base64.Encode(buffer.fromstring(JSON.serialize(packet))));
	}
	static string2packet(str: string): { success: true; data: GeneralSaveConfirmationPayload } | { success: false } {
		const decodedObj = buffer.tostring(Cryptography.Utilities.Base64.Decode(buffer.fromstring(str)));
		const result = JSON.deserialize<GeneralSaveConfirmationPayload>(decodedObj);
		if (!result || !result.payload || !result.signature) return { success: false };
		return { success: true, data: result };
	}
}
