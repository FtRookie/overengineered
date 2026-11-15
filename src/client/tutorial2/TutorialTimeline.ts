import { Objects } from "engine/shared/fixes/Objects";
import type { BuildingDiffChange } from "client/tutorial2/BuildingDiffer";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";

// a block as a step leaves it, plot-relative; `config` holds only the keys a step asked for
export type TutorialBlockState = {
	readonly id: BlockId;
	readonly uuid: BlockUuid;
	readonly location: CFrame;
	readonly scale: Vector3;
	readonly config?: PartialThrough<PlacedBlockConfig>;
};

// one recorded change as the finished state of every block it touches
export type TutorialTargets = {
	readonly placed: readonly TutorialBlockState[];
	readonly deleted: readonly BlockUuid[];
	readonly moved: readonly TutorialBlockState[];
	readonly scaled: readonly TutorialBlockState[];
	readonly configured: readonly TutorialBlockState[];
};

/** The plot as a tutorial's recorded changes leave it, replayed once when the tutorial is set up */
export class TutorialTimeline {
	private readonly blocks = new Map<BlockUuid, TutorialBlockState>();

	apply(change: BuildingDiffChange): TutorialTargets {
		const placed = new Set<BlockUuid>();
		const deleted: BlockUuid[] = [];
		const moved = new Set<BlockUuid>();
		const scaled = new Set<BlockUuid>();
		const configured = new Set<BlockUuid>();

		const update = (uuid: BlockUuid, func: (state: TutorialBlockState) => TutorialBlockState) => {
			const state = this.blocks.get(uuid);
			if (!state) return false;

			this.blocks.set(uuid, func(state));
			return true;
		};

		for (const { id, uuid, location, scale } of change.added ?? []) {
			this.blocks.set(uuid, { id, uuid, location, scale: scale ?? Vector3.one });
			placed.add(uuid);
		}
		for (const uuid of change.removed ?? []) {
			this.blocks.delete(uuid);
			deleted.push(uuid);
		}
		for (const { uuid, to } of change.moved ?? []) {
			if (update(uuid, (s) => ({ ...s, location: s.location.Rotation.add(to) }))) moved.add(uuid);
		}
		for (const { uuid, to } of change.rotated ?? []) {
			if (update(uuid, (s) => ({ ...s, location: to.Rotation.add(s.location.Position) }))) moved.add(uuid);
		}
		for (const { uuid, to } of change.scaled ?? []) {
			if (update(uuid, (s) => ({ ...s, scale: to }))) scaled.add(uuid);
		}
		for (const [uuid, config] of pairs(change.configChanged ?? {})) {
			const combined = (s: TutorialBlockState) =>
				s.config ? Objects.deepCombine(s.config as PlacedBlockConfig, config as never) : config;
			if (update(uuid, (s) => ({ ...s, config: combined(s) }))) configured.add(uuid);
		}

		// a block both moved and scaled is one scale request: it carries the location too
		const finished = (uuids: readonly BlockUuid[]) => uuids.mapFiltered((uuid) => this.blocks.get(uuid));
		return {
			placed: finished([...placed]),
			deleted,
			moved: finished([...moved].filter((uuid) => !scaled.has(uuid))),
			scaled: finished([...scaled]),
			configured: finished([...configured]),
		};
	}

	centre(): Vector3 | undefined {
		if (this.blocks.isEmpty()) return;

		let sum = Vector3.zero;
		for (const [, state] of this.blocks) sum = sum.add(state.location.Position);

		return sum.div(this.blocks.size());
	}
}
