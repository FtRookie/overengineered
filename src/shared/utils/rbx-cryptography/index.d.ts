// View the original at:
// https://github.com/daily3014/rbx-cryptography
// With the version being used:
// https://github.com/daily3014/rbx-cryptography/tree/6147c4702726ab59c4b31ed9304dbe8bb843f05f
// This port only contains stuff from /src

// You can view the license at
// https://github.com/daily3014/rbx-cryptography/blob/6147c4702726ab59c4b31ed9304dbe8bb843f05f/LICENSE

// roblox-ts interface ported by @ek587290135 (github @programthat)

// Make sure you research each function before using! Some are not very secure!
// (The luau implementation has more details for each)

// ===============================

// This is repeated a couple of times in the script
type EntropyProvider = (BytesLeft: number) => buffer | undefined;
interface CSPRNG {
	BlockExpansion: boolean;

	SizeTarget: number;
	RekeyAfter: number;

	Key: buffer;
	Nonce: buffer;
	Buffer: buffer;

	Counter: number;
	BufferPosition: number;
	BufferSize: number;
	BytesLeft: number;

	EntropyProviders: Array<EntropyProvider>;

	Reseed: (CustomEntropy?: buffer) => void;
	AddEntropyProvider: (ProviderFunction: EntropyProvider) => void;
	RemoveEntropyProvider: (ProviderFunction: EntropyProvider) => void;

	Random: () => number;
	RandomInt: (Min: number, Max?: number) => number;
	RandomNumber: (Min: number, Max?: number) => number;
	RandomBytes: (Count: number) => buffer;
	RandomString: (Length: number, AsBuffer?: boolean) => string | buffer;
	RandomHex: (Length: number) => string;
	Ed25519ClampedBytes: (Input: buffer) => buffer;
	Ed25519Random: () => buffer;
}

// ===============================

interface Checksums {
	CRC32: (Message: buffer, Mode?: "Jam" | "Iso", Hex?: boolean) => number | string;
}

// ===============================

interface Conversions {
	ToHex: (Buffer: buffer) => string;
	FromHex: (Hex: string | buffer) => buffer;
}

interface Base64 {
	Encode: (Input: buffer) => buffer;
	Decode: (Input: buffer) => buffer;
}

interface Utilities {
	Conversions: Conversions;
	Base64: Base64;
	CSPRNG: CSPRNG;
}

// ===============================

interface X25519 {
	Mask: (SecretKey: buffer) => buffer;
	MaskSignature: (SignatureSecretKey: buffer) => buffer;
	Remask: (MaskedKey: buffer) => buffer;
	MaskComponent: (MaskedKey: buffer) => buffer;
	PublicKey: (MaskedKey: buffer) => buffer;
	Exchange: (MaskedSecretKey: buffer, TheirPublicKey: buffer) => LuaTuple<[buffer, buffer]>;
}

type SignatureEntry = {
	PublicKey: buffer;
	Message: buffer;
	Signature: buffer;
};
interface EdDSA {
	CSPRNG: CSPRNG;
	X25519: X25519;

	PublicKey: (SecretKey: buffer) => buffer;
	Sign: (Message: buffer, SecretKey: buffer, PublicKey: buffer) => buffer;
	Verify: (Message: buffer, PublicKey: buffer, Signature: buffer) => boolean;
	VerifyBatch: (Entries: SignatureEntry[]) => boolean;
}

interface Verification {
	EdDSA: EdDSA;
}

// ===============================

interface CryptographyModule {
	Checksums: Checksums;
	Utilities: Utilities;
	Verification: Verification;
}
declare const Cryptography: CryptographyModule;
export = Cryptography;
