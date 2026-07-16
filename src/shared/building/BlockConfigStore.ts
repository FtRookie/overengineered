import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";

/**
 * Per-runtime store of block logic configs, keyed by the plot's Blocks folder then block uuid.
 *
 * `config` used to live as a replicated attribute on each block Model, which let any client read every
 * other player's logic/wiring. It now lives here instead: authoritative on the server, a per-owner cache
 * on the client (seeded from the slot-load reply, maintained by the owner's own edits), and empty for
 * non-owners — so a foreign block's config resolves to `undefined`.
 *
 * Keyed by the Blocks folder, NOT the plot model: plot teardown unparents the folder before the quit
 * snapshot serializes, and a plot-keyed lookup would resolve nothing at exactly that moment.
 */
export namespace BlockConfigStore {
	const byFolder = new Map<Instance, Map<BlockUuid, PlacedBlockConfig>>();

	function folderOf(block: BlockModel): Instance | undefined {
		return block.Parent;
	}
	function uuidOf(block: BlockModel): BlockUuid | undefined {
		return block.GetAttribute("uuid") as BlockUuid | undefined;
	}

	export function get(block: BlockModel): PlacedBlockConfig | undefined {
		const folder = folderOf(block);
		const uuid = uuidOf(block);
		if (!folder || uuid === undefined) return undefined;

		return byFolder.get(folder)?.get(uuid);
	}
	export function set(block: BlockModel, value: PlacedBlockConfig | undefined): void {
		const folder = folderOf(block);
		const uuid = uuidOf(block);
		if (!folder || uuid === undefined) return;

		if (value === undefined) {
			unset(folder, uuid);
			return;
		}

		byFolder.getOrSet(folder, () => new Map()).set(uuid, value);
	}
	/** Remove a single entry by folder+uuid — for when the block model itself is already destroyed */
	export function unset(folder: Instance, uuid: BlockUuid): void {
		const inner = byFolder.get(folder);
		if (!inner) return;

		inner.delete(uuid);
		if (inner.size() === 0) byFolder.delete(folder);
	}

	/** Seed a folder's configs by uuid — used on the owner client, where block Models may not have replicated yet. */
	export function load(folder: Instance, configs: Record<BlockUuid, PlacedBlockConfig>): void {
		const inner = new Map<BlockUuid, PlacedBlockConfig>();
		for (const [uuid, config] of pairs(configs)) {
			inner.set(uuid, config);
		}

		if (inner.size() === 0) {
			byFolder.delete(folder);
			return;
		}

		byFolder.set(folder, inner);
	}

	/** Snapshot a folder's configs by uuid, for delivery to the owner client. */
	export function snapshot(folder: Instance): Record<BlockUuid, PlacedBlockConfig> {
		const result: Record<BlockUuid, PlacedBlockConfig> = {};
		const inner = byFolder.get(folder);
		if (!inner) return result;

		for (const [uuid, config] of inner) {
			result[uuid] = config;
		}

		return result;
	}

	/** Drop a whole folder's configs (plot teardown / owner change). */
	export function dropPlot(folder: Instance): void {
		byFolder.delete(folder);
	}
}
