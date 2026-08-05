import { GraphData } from "client/gui/graph/GraphSessionStore";
import { Component } from "engine/shared/component/Component";
import { BlockManager } from "shared/building/BlockManager";
import type { GraphGroup, GraphSessionStore } from "client/gui/graph/GraphSessionStore";
import type { BlockLogicTickContext, DebugInfo, GenericBlockLogic } from "shared/blockLogic/BlockLogic";
import type { SharedMachine } from "shared/blockLogic/SharedMachine";

/**
 * Records bound outputs into the store while a machine is running.
 *
 * The buffers belong to the store, not to this component: the machine is destroyed on every ride exit and this
 * goes with it, but the samples stay readable in build mode. Nothing here owns data.
 */
export class GraphSampler extends Component {
	/** Rebuilt per ride — SharedMachine.blocksMap is protected, so the index comes from the public block list. */
	private readonly byUuid = new Map<BlockUuid, GenericBlockLogic>();

	constructor(
		private readonly store: GraphSessionStore,
		machine: SharedMachine,
		/** Whether a group whose window is hidden should still record. */
		private readonly sampleHidden: () => boolean,
	) {
		super();

		for (const logic of machine.blocks.getAll()) {
			const instance = logic.instance;
			if (!instance) continue;

			const uuid = BlockManager.manager.uuid.get(instance);
			if (uuid !== undefined) this.byUuid.set(uuid, logic);
		}

		// Bindings first: a fresh run replaces the previous one, but an output whose block is gone is skipped by
		// the reset, since nothing will sample it again and its buffer holds the only copy of that run.
		this.markBindings();
		this.store.resetAll();

		this.event.subscribeRegistration(() =>
			machine.runner.onAfterTick((ctx) => {
				for (const group of this.store.groups.get()) {
					this.tickGroup(group, ctx);
				}
			}),
		);
	}

	/** Flag outputs whose block is not on this ride — deleted, destroyed, or a different slot loaded. */
	private markBindings() {
		for (const group of this.store.groups.get()) {
			for (const output of group.outputs) {
				output.unbound = !this.byUuid.has(output.uuid);
			}
		}
	}

	private tickGroup(group: GraphGroup, ctx: BlockLogicTickContext) {
		if (group.outputs.isEmpty()) return;
		if (!group.visible.get() && !this.sampleHidden()) return;

		group.elapsed += ctx.dt;

		for (const output of group.outputs) {
			const logic = this.byUuid.get(output.uuid);
			if (!logic) continue;

			// Plain loop rather than find(): a predicate closure would be one allocation per output per tick.
			let entry: DebugInfo | undefined;
			for (const info of logic.getDebugInfo(ctx)) {
				if (info.kind === "output" && info.key === output.outputKey) {
					entry = info;
					break;
				}
			}
			// Skipping instead would freeze the trace and let the next real sample bridge the whole dead span.
			if (!entry) {
				GraphData.pushGap(output, group.elapsed, false);
				continue;
			}

			// Destructured straight from the call: storing the tuple first would pack it into a table.
			const [x, y, z, arity] = GraphData.widen(entry);
			if (arity === 0) {
				// A sentinel, or a type that cannot be plotted: record the hole rather than a misleading zero.
				// Only GARBAGE draws a band; AVAILABLELATER is an ordinary gap.
				GraphData.pushGap(output, group.elapsed, entry.type === "GARBAGE");
				continue;
			}

			GraphData.push(output, group.elapsed, x, y, z, arity);
		}
	}
}
