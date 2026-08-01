import { UserInputService } from "@rbxts/services";
import { GraphData } from "client/gui/graph/GraphSessionStore";
import { MarkerWireVisualizer } from "client/gui/MarkerWireVisualizer";
import { HoveredPartHighlighter } from "client/tools/highlighters/HoveredPartHighlighter";
import { Interface } from "engine/client/gui/Interface";
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { Objects } from "engine/shared/fixes/Objects";
import { BlockManager } from "shared/building/BlockManager";

/** A picked output: the block it belongs to, its connector key, and a name for the series row. */
export type PickedOutput = {
	readonly uuid: BlockUuid;
	readonly outputKey: string;
	readonly name: string;
	/** Declared channel count, so a series has its rows before a ride has produced any sample. */
	readonly arity: 1 | 3;
};

/** The base class is abstract only to stop it being used bare; nothing needs overriding. */
class OutputMarker extends MarkerWireVisualizer.Marker {}

/**
 * Two-stage output picker: click a block, then click one of its output markers.
 *
 * Markers are built for the clicked block alone and torn down as soon as the pick ends, so nothing exists on a
 * large machine at rest. Works in both modes — blocks stay parented under the plot's Blocks folder during a ride,
 * and the logic `definition` is plain data on the block descriptor, so no running machine is needed.
 */
@injectable
export class GraphOutputPicker extends Component {
	private readonly stage = this.parent(new ComponentChild<Component>(true));
	private readonly markers = this.parent(new ComponentChildren<OutputMarker>(true));

	constructor(@inject private readonly blockList: BlockList) {
		super();
	}

	/** Fired once when the current pick ends for any reason, so the caller can restore its button. */
	private ending?: () => void;

	/** True while a pick is in progress, through both stages, so a second press cancels rather than re-arming. */
	isArmed(): boolean {
		return this.stage.get() !== undefined || !this.markers.getAll().isEmpty();
	}

	/** Notify the caller that its pick is over. Cleared first so a handler that re-arms cannot recurse. */
	private endPick() {
		const ending = this.ending;
		this.ending = undefined;
		ending?.();
	}

	cancel() {
		this.markers.clear();
		this.stage.clear();
		this.endPick();
	}

	arm(picked: (output: PickedOutput) => void, ended?: () => void) {
		// Supersedes any pick in progress, which notifies whichever button owned it.
		this.cancel();
		this.ending = ended;

		const stage = this.stage.set(new Component());

		const highlighter = stage.parent(
			new HoveredPartHighlighter<BlockModel>((part) => {
				const block = BlockManager.tryGetBlockModelByPart(part);
				if (!block) return undefined;

				return this.graphableOutputs(block).isEmpty() ? undefined : block;
			}),
		);
		highlighter.enable();

		const choose = () => {
			const block = highlighter.highlightedPart.get();
			if (!block) return this.cancel();

			this.showMarkers(block, picked);
		};

		stage.event.subscribe(UserInputService.InputEnded, (input, processed) => {
			if (processed || Interface.isCursorOnVisibleGui()) return;
			if (input.UserInputType !== Enum.UserInputType.MouseButton1) return;

			choose();
		});
		stage.event.subscribe(UserInputService.TouchTap, (_, processed) => {
			if (processed || Interface.isCursorOnVisibleGui()) return;

			choose();
		});
	}

	/** Output keys on a block that can actually be plotted, in the order the wire tool would place them. */
	private graphableOutputs(block: BlockModel): string[] {
		const definition = this.blockList.blocks[BlockManager.manager.id.get(block)]?.logic?.definition;
		if (!definition) return [];

		const keys: string[] = [];
		for (const key of definition.outputOrder ?? Objects.keys(definition.output)) {
			const output = definition.output[key];
			if (!output || output.connectorHidden) continue;
			if (!GraphData.isGraphable(output.types)) continue;

			keys.push(key);
		}

		return keys;
	}

	private showMarkers(block: BlockModel, picked: (output: PickedOutput) => void) {
		const id = BlockManager.manager.id.get(block);
		const descriptor = this.blockList.blocks[id];
		const definition = descriptor?.logic?.definition;
		const origin = block.PrimaryPart;
		const prefab = descriptor?.model.PrimaryPart;
		if (!descriptor || !definition || !origin || !prefab) return this.cancel();

		const uuid = BlockManager.manager.uuid.get(block);
		if (uuid === undefined) return this.cancel();

		// Stage one is done: replacing the stage drops the block highlighter so its hover box stops following the
		// cursor, while keeping a stage alive so a click away from the markers still cancels.
		const stage = this.stage.set(new Component());
		// Deferred so the very click that chose this block cannot immediately cancel the markers it just opened.
		task.defer(() => {
			if (stage.isDestroyed()) return;

			const clickedAway = () => this.cancel();
			stage.event.subscribe(UserInputService.InputEnded, (input, processed) => {
				// A marker press counts as being on GUI, so choosing one never reaches this.
				if (processed || Interface.isCursorOnVisibleGui()) return;
				if (input.UserInputType !== Enum.UserInputType.MouseButton1) return;

				clickedAway();
			});
			stage.event.subscribe(UserInputService.TouchTap, (_, processed) => {
				if (processed || Interface.isCursorOnVisibleGui()) return;

				clickedAway();
			});
		});

		const scale = BlockManager.manager.scale.get(block) ?? Vector3.one;
		const keys = this.graphableOutputs(block);
		// Counters are shared across a block's connectors, matching how the wire tool lays markers out.
		const slots = MarkerWireVisualizer.newConnectorSlots();

		for (const key of keys) {
			const offset = MarkerWireVisualizer.resolveConnectorOffset(
				descriptor.markerPositions,
				definition,
				key,
				"output",
				keys.size(),
				slots,
			);

			const instance = OutputMarker.createInstanceAt(origin, offset, scale, prefab);
			const marker = this.markers.add(new OutputMarker(instance));

			const name = `${descriptor.displayName} · ${definition.output[key].displayName}`;
			const arity = GraphData.arityOf(definition.output[key].types);
			marker.event.subscribe(instance.TextButton.MouseButton1Down, () => {
				this.markers.clear();
				this.stage.clear();
				this.endPick();
				picked({ uuid, outputKey: key, name, arity });
			});
		}

		if (this.markers.getAll().isEmpty()) this.cancel();
	}
}
