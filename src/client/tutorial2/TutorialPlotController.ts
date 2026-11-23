import { RunService, Workspace } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { Element } from "engine/shared/Element";
import { ArgsSignal } from "engine/shared/event/Signal";
import { Objects } from "engine/shared/fixes/Objects";
import { BlockConfig } from "shared/blockLogic/BlockConfig";
import { BlockManager } from "shared/building/BlockManager";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import { BuildingPlot } from "shared/building/BuildingPlot";
import { Colors } from "shared/Colors";
import { PartUtils } from "shared/utils/PartUtils";
import { VectorUtils } from "shared/utils/VectorUtils";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ClientBuilding, ClientBuildingTypes } from "client/modes/build/ClientBuilding";
import type { BuildTool } from "client/tools/BuildTool";
import type { TutorialControllerGui } from "client/tutorial2/TutorialController";
import type { TutorialStarter } from "client/tutorial2/TutorialStarter";
import type { TutorialBlockState, TutorialTargets } from "client/tutorial2/TutorialTimeline";
import type { MiddlewareResponse } from "engine/shared/Operation";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type { LatestSerializedBlock } from "shared/building/BlocksSerializer";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";
import type { SharedPlot } from "shared/building/SharedPlot";

@injectable
class TutorialPlot extends Component {
	private readonly instance: Folder;

	private readonly plot: BuildingPlot;
	private readonly actualPlot: ReadonlyPlot;

	constructor(
		plot: ReadonlyPlot,
		private readonly blockList: BlockList,
	) {
		super();

		this.actualPlot = plot;

		this.instance = new Instance("Folder");
		this.instance.Name = "TutorialPreview";
		this.instance.Parent = Workspace;
		ComponentInstance.init(this, this.instance);

		this.plot = new BuildingPlot(this.instance, plot.origin, plot.boundingBox, blockList);

		this.onDestroy(() => this.plot.deleteOperation.execute("all"));
	}

	// ghosts of blocks in their finished state; one that already exists keeps its colour, material and settings
	show(states: readonly TutorialBlockState[]) {
		if (states.isEmpty()) return;

		BlocksSerializer.deserializeFromObject(
			{
				version: BlocksSerializer.latestVersion,
				blocks: states.map((state): LatestSerializedBlock => {
					const existing = this.actualPlot.tryGetBlock(state.uuid);
					const from = existing
						? BlocksSerializer.serializeBlockToObject(this.actualPlot, existing)
						: { id: state.id, uuid: state.uuid };

					return { ...from, location: state.location, scale: state.scale } as LatestSerializedBlock;
				}),
			},
			this.plot,
			this.blockList,
		);

		for (const { uuid } of states) {
			const block = this.plot.tryGetBlock(uuid);
			if (!block) continue;

			PartUtils.ghostModel(block, Colors.white);
			Element.create("SelectionBox", {
				Color3: Color3.fromRGB(0, 255, 255),
				LineThickness: 0.05,
				Adornee: block,
				Parent: block,
			});
		}
	}
	hide(uuid: BlockUuid) {
		this.plot.tryGetBlock(uuid)?.Destroy();
	}

	// red outlines on blocks of the real plot
	highlight(uuids: readonly BlockUuid[]): SignalConnection {
		const highlights: Instance[] = [];

		for (const uuid of uuids) {
			const block = this.actualPlot.tryGetBlock(uuid);
			if (!block) continue;

			const selectionBox = new Instance("SelectionBox");
			selectionBox.Adornee = block;
			selectionBox.Color3 = Color3.fromRGB(255);
			selectionBox.SurfaceTransparency = 1;
			selectionBox.Transparency = 0;
			selectionBox.LineThickness = 0.05;
			selectionBox.Parent = block;

			highlights.push(selectionBox);
		}

		return ArgsSignal.connection(() => {
			for (const highlight of highlights) highlight.Destroy();
		});
	}
}

// one thing a step asks for, and the plot state that finishes it
export interface TutorialRequest {
	// ghosts, outlines, guards and its progress line, all owned by the step's scope
	readonly begin: (scope: Component) => void;
	readonly done: () => boolean;
	// sends what is still missing from the finished state
	readonly skip: () => void;
}

// `false` for a block to delete: a Luau table cannot hold nil as a value
type Guarded = {
	readonly kind: "place" | "delete" | "edit";
	readonly targets: ReadonlyMap<BlockUuid, TutorialBlockState | false>;
};

// plot-relative locations, matched on the half-stud grid
const sameLocation = (a: CFrame, b: CFrame) =>
	VectorUtils.roundVector3To(a.Position, 0.5) === VectorUtils.roundVector3To(b.Position, 0.5) &&
	VectorUtils.areCFrameEqual(a.Rotation, b.Rotation);
const sameScale = (a: Vector3, b: Vector3) =>
	VectorUtils.roundVector3To(a, 0.01) === VectorUtils.roundVector3To(b, 0.01);

@injectable
export class TutorialPlotController extends Component {
	private plot: TutorialPlot = undefined!;
	private splot: SharedPlot = undefined!;
	private building: ClientBuilding = undefined!;
	private buildTool: BuildTool = undefined!;
	private blockList: BlockList = undefined!;
	private readonly gui: TutorialControllerGui;

	// what the current step's requests allow; with none active, the plot is left alone
	private readonly guarded = new Set<Guarded>();

	constructor(ts: TutorialStarter) {
		super();
		this.gui = ts.controller.gui;

		this.$onInjectAuto((plot: ReadonlyPlot, splot: SharedPlot, blockList: BlockList, buildMode: BuildingMode) => {
			buildMode.building.deleteOperation.execute({ blocks: "all", plot: splot });
			this.plot = this.parent(new TutorialPlot(plot, blockList));
			this.splot = splot;
			this.building = buildMode.building;
			this.buildTool = buildMode.tools.buildTool;
			this.blockList = blockList;

			this.event.subscribeRegistration(() =>
				this.building.placeOperation.addMiddleware((arg) => this.guardPlace(arg)),
			);
			this.event.subscribeRegistration(() =>
				this.building.deleteOperation.addMiddleware((arg) => {
					const blocks = arg.blocks === "all" ? arg.plot.getBlocks() : arg.blocks;
					return this.allows("delete", blocks) ? { success: true } : { success: false, message: "Not now" };
				}),
			);
			this.event.subscribeRegistration(() =>
				this.building.editOperation.addMiddleware((arg) =>
					this.allows(
						"edit",
						arg.blocks.map((b) => b.instance),
					)
						? { success: true }
						: { success: false, message: "Not now" },
				),
			);
		});
	}

	/** Every request one recorded change makes */
	requests(targets: TutorialTargets): TutorialRequest[] {
		const ret: TutorialRequest[] = [];
		if (!targets.placed.isEmpty()) ret.push(this.placeBlocks(targets.placed));
		if (!targets.deleted.isEmpty()) ret.push(this.deleteBlocks(targets.deleted));
		if (!targets.moved.isEmpty()) ret.push(this.moveBlocks(targets.moved));
		if (!targets.scaled.isEmpty()) ret.push(this.scaleBlocks(targets.scaled));
		if (!targets.configured.isEmpty()) ret.push(this.configureBlocks(targets.configured));

		return ret;
	}

	placeBlocks(states: readonly TutorialBlockState[]): TutorialRequest {
		const missing = () => states.filter((state) => !this.splot.tryGetBlock(state.uuid));

		return {
			begin: (scope) => {
				this.guard(scope, "place", states);
				this.plot.show(missing());
				this.buildTool.gui.blockSelector.highlightedBlocks.set(
					missing()
						.map((s) => s.id)
						.distinct(),
				);
				scope.onDestroy(() => this.buildTool.gui.blockSelector.highlightedBlocks.set([]));

				const progress = scope.parent(this.gui.progress.addTask("Place blocks", states.size()));
				scope.event.subscribe(RunService.Heartbeat, () => {
					for (const state of states) {
						if (this.splot.tryGetBlock(state.uuid)) this.plot.hide(state.uuid);
					}
					progress.setProgress(states.size() - missing().size(), states.size());
				});
				scope.onDestroy(() => {
					for (const state of states) this.plot.hide(state.uuid);
				});
			},
			done: () => states.all((state) => this.isAt(state)),
			skip: () => {
				const blocks = missing().map((state) =>
					BlocksSerializer.serializedBlockToPlaceRequest(state as LatestSerializedBlock, this.splot.origin),
				);
				if (blocks.isEmpty()) return;

				task.spawn(() => this.building.placeOperation.execute({ plot: this.splot, blocks }));
			},
		};
	}

	deleteBlocks(uuids: readonly BlockUuid[]): TutorialRequest {
		const present = () => uuids.filter((uuid) => this.splot.tryGetBlock(uuid) !== undefined);

		return {
			begin: (scope) => {
				this.guard(scope, "delete", uuids);
				const highlight = this.plot.highlight(uuids);
				scope.onDestroy(() => highlight.Disconnect());

				const progress = scope.parent(this.gui.progress.addTask("Delete blocks", uuids.size()));
				scope.event.subscribe(RunService.Heartbeat, () =>
					progress.setProgress(uuids.size() - present().size(), uuids.size()),
				);
			},
			done: () => present().isEmpty(),
			skip: () => {
				const blocks = present().map((uuid) => this.splot.getBlock(uuid));
				if (blocks.isEmpty()) return;

				task.spawn(() => this.building.deleteOperation.execute({ plot: this.splot, blocks }));
			},
		};
	}

	moveBlocks(states: readonly TutorialBlockState[]): TutorialRequest {
		return this.editBlocks("Move blocks", states);
	}
	scaleBlocks(states: readonly TutorialBlockState[]): TutorialRequest {
		return this.editBlocks("Scale blocks", states);
	}

	configureBlocks(states: readonly TutorialBlockState[]): TutorialRequest {
		const configured = (state: TutorialBlockState) => {
			const block = this.splot.tryGetBlock(state.uuid);
			if (!block) return false;

			return Objects.objectDeepEqualsExisting(BlockManager.manager.config.get(block) ?? {}, state.config ?? {});
		};

		return {
			begin: (scope) => {
				const highlight = this.plot.highlight(states.map((s) => s.uuid));
				scope.onDestroy(() => highlight.Disconnect());

				const progress = scope.parent(this.gui.progress.addTask("Configure blocks", states.size()));
				scope.event.subscribe(RunService.Heartbeat, () =>
					progress.setProgress(states.count(configured), states.size()),
				);
			},
			done: () => states.all(configured),
			skip: () => {
				const configs = states
					.filter((state) => !configured(state) && this.splot.tryGetBlock(state.uuid) !== undefined)
					.map((state): ClientBuildingTypes.UpdateConfigArgs["configs"][number] => {
						const block = this.splot.getBlock(state.uuid);
						const current = BlockConfig.addDefaults(
							BlockManager.manager.config.get(block) ?? {},
							this.blockList.blocks[BlockManager.manager.id.get(block)]!.logic!.definition.input,
						);

						return { block, cfg: Objects.deepCombine(current, (state.config ?? {}) as PlacedBlockConfig) };
					});
				if (configs.isEmpty()) return;

				task.spawn(() => this.building.updateConfigOperation.execute({ plot: this.splot, configs }));
			},
		};
	}

	private editBlocks(title: string, states: readonly TutorialBlockState[]): TutorialRequest {
		return {
			begin: (scope) => {
				this.guard(scope, "edit", states);
				this.plot.show(states);
				const highlight = this.plot.highlight(states.map((s) => s.uuid));
				scope.onDestroy(() => highlight.Disconnect());

				const progress = scope.parent(this.gui.progress.addTask(title, states.size()));
				scope.event.subscribe(RunService.Heartbeat, () => {
					for (const state of states) {
						if (this.isAt(state)) this.plot.hide(state.uuid);
					}
					progress.setProgress(
						states.count((s) => this.isAt(s)),
						states.size(),
					);
				});
				scope.onDestroy(() => {
					for (const state of states) this.plot.hide(state.uuid);
				});
			},
			done: () => states.all((state) => this.isAt(state)),
			skip: () => {
				const blocks = states
					.filter((state) => !this.isAt(state) && this.splot.tryGetBlock(state.uuid) !== undefined)
					.map((state): ClientBuildingTypes.EditBlockInfo => {
						const block = this.splot.getBlock(state.uuid);
						return {
							instance: block,
							origPosition: block.GetPivot(),
							newPosition: this.splot.origin.ToWorldSpace(state.location),
							origScale: BlockManager.manager.scale.get(block) ?? Vector3.one,
							newScale: state.scale,
						};
					});
				if (blocks.isEmpty()) return;

				task.spawn(() => this.building.editOperation.execute({ plot: this.splot, blocks }));
			},
		};
	}

	private isAt(state: TutorialBlockState): boolean {
		const block = this.splot.tryGetBlock(state.uuid);
		if (!block) return false;

		return (
			sameLocation(this.splot.origin.ToObjectSpace(block.GetPivot()), state.location) &&
			sameScale(BlockManager.manager.scale.get(block) ?? Vector3.one, state.scale)
		);
	}

	private guard(scope: Component, kind: Guarded["kind"], targets: readonly (TutorialBlockState | BlockUuid)[]) {
		const map = new Map<BlockUuid, TutorialBlockState | false>();
		for (const t of targets) {
			if (typeIs(t, "string")) map.set(t as BlockUuid, false);
			else map.set(t.uuid, t);
		}

		const entry: Guarded = { kind, targets: map };
		this.guarded.add(entry);
		scope.onDestroy(() => this.guarded.delete(entry));
	}

	// with any request active, delete and edit only touch blocks a request names
	private allows(kind: "delete" | "edit", blocks: readonly BlockModel[]): boolean {
		if (this.guarded.isEmpty()) return true;

		return blocks.all((block) => {
			const uuid = BlockManager.manager.uuid.get(block);
			return this.guarded.any((g) => g.kind === kind && g.targets.has(uuid));
		});
	}

	// a placed block counts when its id and position match a missing target; it is then put exactly in place, with
	// the target's uuid and scale and the player's colour and material
	private guardPlace(
		arg: ClientBuildingTypes.PlaceBlocksArgs,
	): MiddlewareResponse<ClientBuildingTypes.PlaceBlocksArgs> {
		if (this.guarded.isEmpty()) return { success: true, arg };

		const area = arg.plot.instance.BuildingArea.CFrame;
		const claimed = new Set<BlockUuid>();
		const blocks: PlaceBlockRequest[] = [];
		for (const request of arg.blocks) {
			const position = VectorUtils.roundVector3To(area.ToObjectSpace(request.location).Position, 0.5);
			let target: TutorialBlockState | undefined;
			for (const g of this.guarded) {
				if (g.kind !== "place") continue;

				for (const [uuid, state] of g.targets) {
					if (!state || claimed.has(uuid) || this.splot.tryGetBlock(uuid)) continue;
					if (state.id !== request.id) continue;
					if (VectorUtils.roundVector3To(state.location.Position, 0.5) !== position) continue;

					target = state;
					break;
				}
				if (target) break;
			}
			if (!target) return { success: false, message: "Invalid placement" };

			claimed.add(target.uuid);
			this.plot.hide(target.uuid);
			blocks.push({
				...request,
				uuid: target.uuid,
				location: area.ToWorldSpace(target.location),
				scale: target.scale,
			});
		}

		return { success: true, arg: { ...arg, blocks } };
	}
}
