# Save Export / Import

Allows a player to export a slot (or their current build) as a portable string, configure access control (whitelist/blacklist/public), set an expiration, and share it. Another player can import the string to load the build into their own plot (if they have the correct permissions).

All encryption import/export related files live in `<src/server/...>`. The [`rbx-cryptography`](/src/shared/utils/rbx-cryptography) library at `<src/shared/utils>` provides EdDSA signing, CRC32 checksums, and Base85/Base64 encoding.

In this file `payload` refers to the full signed payload object the user receives (Base64-encoded JSON).<br>
The **build** is the thing *on* the plot, and the **slot** is the *save of that build* (in the database)

---

## What it does

- **Export (from slot)**: Located when selecting a slot, exports the chosen slot as a string.
  - **Reference mode**: Exports a reference to the slot on the external database. It becomes invalid if anything changes. Only works for slots that have been synced to the external database.
  - **Static mode**: Exports the actual block data (compressed) inside the payload. Independent of the database; the build is frozen at export time.
- **Export (from current build)**: Located in the header of the slot list ("Export Build"), exports the player's current plot as a static payload (always static mode, no database reference).
- **Import**: Located at the end of the slot list ("Import & Load"), accepts a string and loads it accordingly into the player's current plot.
  - Validates signature, checksum, expiration, and access control.
  - Handles invalid/missing blocks (prompts user to confirm or cancel).
  - Auto-centers the build if it's outside the plot bounds.

If a user is in the blacklist, they are denied no matter if in the whitelist, or isPublic.

---

## Theft prevention

- **EdDSA signature**: The payload is signed with the originating game's Ed25519 private key. The public key is derived from the private key (or fetched from the trusted game's `/saveexport_publickey` endpoint). Tampering makes the signature invalid.
- **Trusted games only**: Cross-game imports only work for games listed in `TRUSTED_GAMES` (hardcoded in `ExternalDatabaseLoader.ts`).
- **CRC32 checksum**: A quick integrity check over the signable string. Catches corruption/truncation.
- **Access control**: The payload carries:
  - `whitelist` (user IDs allowed)
  - `blacklist` (user IDs denied)
  - `isPublic` (if true, anyone not blacklisted can load)
  - `expiration` (Unix timestamp or `"NEVER"`)
- **Game identity**: `originGameId` (e.g., `"ftrookie/oe"`) and `creatorId` (original owner's user ID) are included in the signed data. Only games listed in `TRUSTED_GAMES` are accepted.
- **Content hash**: The `contentHash` (SHA-256 of the block data) is included in the signed body. If the referenced slot changes, then its signature changes, which makes the payload invalid (Only applies to reference, static doesnt depend on a slot's data).


---

## File format

The on-the-wire format is a **Base64-encoded JSON string** of `GeneralSaveConfirmationPayload`.

### Type definitions (from `ExternalDatabaseLoader.ts`)

```ts
type StaticVersions = "v1" | "v2";

type SaveReferenceBody = {
	mode: "reference";
	contentHash: string;      // SHA-256 of the block data
	slotIndex: number;        // index of the target slot
	lastSaved: number;        // Unix timestamp (ms) when the slot was saved
};

type SaveStaticBody = {
	mode: "static";
	contentHash: string;      // SHA-256 of the block data
	blocks: string;           // compressed block data (Base85 + Zstd for v2, or raw for v1)
	version: StaticVersions;  // compression version
};

type SaveBody = SaveReferenceBody | SaveStaticBody;

type GeneralSaveConfirmationPayload = {
	signature: string;        // Base64-encoded Ed25519 signature
	keyVersion: "v1";         // key version (for future migration)
	payload: {
		creatorId: string;           // original creator's user ID (stringified)
		originGameId: string;        // e.g. "ftrookie/oe"
		whitelist: string[];         // allowed user IDs (stringified)
		blacklist: string[];         // denied user IDs (stringified)
		isPublic: boolean;           // if true, anyone not blacklisted can load
		expiration: `${number}` | "NEVER";  // Unix timestamp (seconds) or "NEVER"
		checksum: number;            // CRC32 of the signable string
		body: SaveBody;              // the actual body (reference or static)
	};
};
```

### Signable string (what gets signed)

The signature covers a canonical string built by `getSignableString(payload)`:

```
${creatorId}|${originGameId}|${sortedWhitelist}|${sortedBlacklist}|${isPublic}|${expiration}||${bodyStr}
```

Where `bodyStr` is:
- **Reference**: `${contentHash}|reference|${slotIndex}|${lastSaved}`
- **Static**: `${contentHash}|static|${version}|${SHA256(blocks)}`

with `sortedWhitelist` being `whitelist.sort().join(',')` and `sortedBlacklist` being `blacklist.sort().join(',')`

The CRC32 checksum is computed over this string, then `|${checksum}` is appended and signed.

### Compression versions (static mode only)

| Version | Description |
|---------|-------------|
| `v1` | Raw JSON (no compression) |
| `v2` | JSON → Zstd (level 1) → Base85 |

`v2` is the current default, though v1 is sometimes used if <50 blocks and smaller. The version is stored in the payload so 'older' payloads can still be decompressed.

---

## Export flow

1. Client requests export with: `mode`, `slotIndex`, `whitelist`, `blacklist`, `isPublic`, `expiration`.
2. Server produces and signs a payload and returns it to the client

---

## Import flow (Two-Phase, Non-Blocking)

The import system uses a **two-phase, server-authoritative flow** to avoid holding server threads while waiting for user input.

### Phase 1: Validate & Preview

1. Client sends the payload string to the validation endpoint.
2. Server decodes and validates the payload (signature, checksum, expiration, access control).
3. Server fetches blocks (static: decompress; reference: HTTP GET to external database).
4. Server computes all issues upfront:
   - `invalidBlocks`: Unknown block IDs (and count) found in the payload.
   - `wouldOverwrite`: Whether the player's plot currently has blocks.
5. Server generates a request token, and returns the token along with the detected issues.

### Phase 2: Execute

1. Client shows any issues (replace confirmation, invalid block confirmation).
2. Client either returns early in case of not overwriting existing, or calls the execute endpoint with the token and user choices.
3. Server applies choices, bounds shift (centering), deletes old blocks, and places new blocks.
4. Server deletes request token and returns if the build was shifted, at which the client displays if so.

**Key properties:**
- **Zero blocking**: No server threads held during user think-time.
- **Server-validated**: The server re-checks the signature, hash and access list on execute; the confirm prompts are client-side only.
- **Token is per player**

---

## QOL Features

- **Out-of-bounds centering**: If the imported build doesn't fit in the plot, it's automatically moved towards the center (whole-stud alignment when possible).
- **Invalid block handling**: If invalid blocks are detected it asks the player if they still want to load (or to skip the invalid ones).
- **Public export forces static mode**: If `isPublic` is enabled, reference mode is disabled (denied by server if invalid).
- **Current build export**: Allows exporting the current build without saving into a slot, always static mode (no database reference possible).

One of the main goals is to not store anything on the database (except the `/saveexport_publickey` key which is optional), hence the payload / signature system.

---

## Known issues / limitations

- **No dynamic saves**: Reference mode gives access to a slot *as it exists at export time*. If the slot changes later, its `contentHash` no longer matches the one in the payload, and so becomes invalid (There is no "live access" to a slot because slots lack a unique and stable ID across saves).
- **Static payload size**: Large builds in static mode produce long strings (Base85 + Zstd helps, but there's a practical limit). These might be especially laggy for mobile players (at which reference mode is recommended instead).
- **No revocation**: Once a payload is issued, it cannot be revoked before expiration (except if in reference mode the slot changes, or if the giving database changes its private key, then all payloads signed with it would become invalid).

---

## Testing checklist

- [ ] Export/import round-trip leaves the build identical (block positions, configs, wires).
- [ ] A playload you're not whitelisted on gets refused (when you are not the owner).
- [ ] Invalid blocks are detected and prompt the user.
- [ ] Corrupt, truncated, or tampered payloads are rejected (checksum/signature).
- [ ] Expired payloads are rejected.
- [ ] Reference mode fails if slot not synced / empty / no version / local copy newer.
- [ ] Out-of-bounds build is centered on import.
- [ ] Compression versions v1/v2+ all decompress correctly.
- ~~[ ] Cross-game import works for trusted games (if configured).~~
