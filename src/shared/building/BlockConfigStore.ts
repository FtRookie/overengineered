import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";

/**
 * Per-runtime store of block logic configs, keyed by plot then block uuid.
 *
 * `config` used to live as a replicated attribute on each block Model, which let any client read every
 * other player's logic/wiring. It now lives here instead: authoritative on the server, a per-owner cache
 * on the client (seeded from the slot-load reply, maintained by the owner's own edits), and empty for
 * non-owners — so a foreign block's config resolves to `undefined`.
 */
export namespace BlockConfigStore {
	const byPlot = new Map<Instance, Map<BlockUuid, PlacedBlockConfig>>();

	function plotOf(block: BlockModel): Instance | undefined {
		return block.Parent?.Parent;
	}
	function uuidOf(block: BlockModel): BlockUuid | undefined {
		return block.GetAttribute("uuid") as BlockUuid | undefined;
	}

	export function get(block: BlockModel): PlacedBlockConfig | undefined {
		const plot = plotOf(block);
		const uuid = uuidOf(block);
		if (!plot || uuid === undefined) return undefined;

		return byPlot.get(plot)?.get(uuid);
	}
	export function set(block: BlockModel, value: PlacedBlockConfig | undefined): void {
		const plot = plotOf(block);
		const uuid = uuidOf(block);
		if (!plot || uuid === undefined) return;

		if (value === undefined) {
			const inner = byPlot.get(plot);
			if (!inner) return;

			inner.delete(uuid);
			if (inner.size() === 0) byPlot.delete(plot);
			return;
		}

		byPlot.getOrSet(plot, () => new Map()).set(uuid, value);
	}

	/** Seed a plot's configs by uuid — used on the owner client, where block Models may not have replicated yet. */
	export function load(plot: Instance, configs: Record<BlockUuid, PlacedBlockConfig>): void {
		const inner = new Map<BlockUuid, PlacedBlockConfig>();
		for (const [uuid, config] of pairs(configs)) {
			inner.set(uuid, config);
		}

		if (inner.size() === 0) {
			byPlot.delete(plot);
			return;
		}

		byPlot.set(plot, inner);
	}

	/** Snapshot a plot's configs by uuid, for delivery to the owner client. */
	export function snapshot(plot: Instance): Record<BlockUuid, PlacedBlockConfig> {
		const result: Record<BlockUuid, PlacedBlockConfig> = {};
		const inner = byPlot.get(plot);
		if (!inner) return result;

		for (const [uuid, config] of inner) {
			result[uuid] = config;
		}

		return result;
	}

	/** Drop a whole plot's configs (plot teardown / owner change). */
	export function dropPlot(plot: Instance): void {
		byPlot.delete(plot);
	}
}
