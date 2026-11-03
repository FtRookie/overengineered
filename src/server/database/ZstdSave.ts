const Zstd = {
	algorithm: Enum.CompressionAlgorithm.Zstd,
	// -7 to 22 (EncodingService:CompressBuffer); 1, Roblox's default, gave 7.4x over 121 real saves at ~2.4ms per MB.
	// On one 342KB save, only 6 and up compressed smaller, by 1-5%, at 3-25x the time; 19 and up took ~0.2s
	level: 1,
	maxInflated: 33_554_432, // 32MiB, the backend's ZstdSave.MAX_INFLATED_BYTES; it refuses to store anything larger
} as const;

/**
 * Saves as the backend stores them: Zstd, and over HTTP `{ zstd: "<base64>" }`. Roblox can compress and
 * decompress Zstd locally, so the stored bytes are what the storage cap measures.
 */
export namespace ZstdSave {
	export const compress = (json: string): buffer =>
		game.GetService("EncodingService").CompressBuffer(buffer.fromstring(json), Zstd.algorithm, Zstd.level);

	export const toBase64 = (blob: buffer): string =>
		buffer.tostring(game.GetService("EncodingService").Base64Encode(blob));

	/** Throws on anything that is not a Zstd frame declaring a size within the backend's limit. */
	export const decode = (base64: string): { readonly blob: buffer; readonly json: string } => {
		const encoding = game.GetService("EncodingService");
		const blob = encoding.Base64Decode(buffer.fromstring(base64));

		// the frame declares its size; a missing or oversized one is refused before anything is inflated
		const size = encoding.GetDecompressedBufferSize(blob, Zstd.algorithm);
		if (size === undefined || size > Zstd.maxInflated) throw `Zstd save declares ${size ?? "no"} inflated size`;

		return { blob, json: buffer.tostring(encoding.DecompressBuffer(blob, Zstd.algorithm)) };
	};
}
