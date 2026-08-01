import { ReplicatedStorage, Workspace } from "@rbxts/services";
import { Interface } from "engine/client/gui/Interface";
import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { ComponentStateContainer } from "engine/shared/component/ComponentStateContainer";
import { Transforms } from "engine/shared/component/Transforms";
import { Element } from "engine/shared/Element";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { BuildingManager } from "shared/building/BuildingManager";
import { SharedPlot } from "shared/building/SharedPlot";
import { Colors } from "shared/Colors";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { ActionController } from "client/modes/build/ActionController";
import type { PlayerDataStorageRemotes } from "shared/remotes/PlayerDataRemotes";

type CM = readonly [pos: Vector3, mass: number];

/** Mass-weighted mean position; undefined when there is no mass. */
const weightedAverage = (values: readonly CM[]): Vector3 | undefined => {
	let sum = Vector3.zero;
	let totalMass = 0;

	for (const [pos, mass] of values) {
		sum = sum.add(pos.mul(mass));
		totalMass += mass;
	}

	return totalMass > 0 ? sum.div(totalMass) : undefined;
};

/** A block's centre of mass. Undefined when all parts are massless. */
const getBlockCM = (block: BlockModel): CM | undefined => {
	let mass = 0;
	let weighted = Vector3.zero;

	for (const part of block.GetDescendants()) {
		if (!part.IsA("BasePart") || part.Massless) continue;

		mass += part.Mass;
		weighted = weighted.add(part.Position.mul(part.Mass));
	}

	return mass > 0 ? [weighted.div(mass), mass] : undefined;
};

/** Centre and total mass of a group. Undefined when it carries no mass. */
const groupCM = (group: ReadonlySet<BlockModel>, cmOf: (block: BlockModel) => CM | undefined): CM | undefined => {
	const cms: CM[] = [];
	for (const block of group) {
		const cm = cmOf(block);
		if (cm) cms.push(cm);
	}

	const center = weightedAverage(cms);
	if (!center) return undefined;

	let mass = 0;
	for (const [, m] of cms) {
		mass += m;
	}

	return [center, mass];
};

/** Connected groups, one centre each. Start block added explicitly — an unjoined block answers empty. */
const groupCentersOfMass = (
	blocks: readonly BlockModel[],
	connected: (block: BlockModel) => readonly BlockModel[],
	cmOf: (block: BlockModel) => CM | undefined,
): readonly CM[] => {
	const used = new Set<BlockModel>();
	const result: CM[] = [];

	for (const block of blocks) {
		if (used.has(block)) continue;

		const group = new Set<BlockModel>(connected(block));
		group.add(block);
		for (const b of group) {
			used.add(b);
		}

		const cm = groupCM(group, cmOf);
		if (cm) result.push(cm);
	}

	return result;
};

@injectable
export class CenterOfMassVisualizer extends Component {
	private readonly viewportFrame: ViewportFrame;

	private renderedBalls: Model[] = [];
	/** Groups held together through constraints, not just welds. */
	private assemblyBalls: Model[] = [];
	private machineCOM: Model | undefined;

	constructor(
		parent: Instance,
		@inject actionController: ActionController,
		@inject playerRemotes: PlayerDataStorageRemotes,
	) {
		super();

		this.viewportFrame = Element.create("ViewportFrame", {
			Name: "CenterOfMass",
			Size: UDim2.fromScale(1, 1),
			CurrentCamera: Workspace.CurrentCamera,
			Transparency: 1,
			Ambient: Colors.white,
			LightColor: Colors.white,
			ZIndex: -1000,
			Parent: Interface.getInterface(),
		});
		ComponentInstance.init(this, this.viewportFrame);

		const update = () => {
			const blocks = parent.GetChildren() as BlockModel[];
			const [welded, assemblies] = this.calculateCentersOfMass(blocks);

			this.syncMarkers(this.renderedBalls, ReplicatedStorage.Assets.Helpers.CenterOfMassWelded, welded);
			this.syncMarkers(this.assemblyBalls, ReplicatedStorage.Assets.Helpers.CenterOfMassAssembly, assemblies);

			//average pos divided by amount of CoMs
			//this.machineCOM?.PivotTo(new CFrame(machineCOMpost.div(pos.size()))); //<---- nesting hell :D
			// both groupings cover all the mass
			const machineCenter = weightedAverage(welded);
			if (!machineCenter) {
				// empty plot: the marker would sit at the world origin
				this.machineCOM?.Destroy();
				this.machineCOM = undefined;
				return;
			}

			if (!this.machineCOM) {
				this.machineCOM = ReplicatedStorage.Assets.Helpers.CenterOfMassMachine.Clone();
				this.machineCOM.Parent = this.viewportFrame;
			}
			this.machineCOM.PivotTo(new CFrame(machineCenter));
		};

		const clear = () => {
			for (const b of this.renderedBalls) b.Destroy();
			for (const b of this.assemblyBalls) b.Destroy();
			this.machineCOM?.Destroy();
			this.machineCOM = undefined;

			this.renderedBalls.clear();
			this.assemblyBalls.clear();
		};

		this.event.subscribe(actionController.onRedo, update);
		this.event.subscribe(actionController.onUndo, update);
		this.event.subscribe(playerRemotes.slots.load.sent, clear);
		this.event.subscribe(playerRemotes.slots.load.completed, (v) => (v.success ? update() : undefined));
		this.event.subscribe(SharedPlot.anyChanged, update);

		this.onEnabledStateChange((enabled) => {
			if (enabled) update();
			else clear();
		});
	}

	/** Resizes the pool to `centers` and moves each marker onto its centre. */
	private syncMarkers(pool: Model[], template: Model, centers: readonly CM[]): void {
		while (pool.size() < centers.size()) {
			const marker = template.Clone();
			marker.Parent = this.viewportFrame;
			pool.push(marker);
		}
		while (pool.size() > centers.size()) {
			const index = pool.size() - 1;
			pool[index].Destroy();
			pool.remove(index);
		}

		for (let i = 0; i < centers.size(); i++) {
			pool[i].PivotTo(new CFrame(centers[i][0]));
		}
	}

	/** Both levels: welded groups and constraint-linked groups. Block centres cached — both levels read every block. */
	private calculateCentersOfMass(
		blocks: readonly BlockModel[],
	): LuaTuple<[welded: readonly CM[], assemblies: readonly CM[]]> {
		const cache = new Map<BlockModel, CM>();
		const cmOf = (block: BlockModel): CM | undefined => {
			const cached = cache.get(block);
			if (cached) return cached;

			const cm = getBlockCM(block);
			if (cm) cache.set(block, cm);
			return cm;
		};

		return $tuple(
			groupCentersOfMass(blocks, BuildingManager.getAssemblyBlocks, cmOf),
			groupCentersOfMass(blocks, BuildingManager.getMachineBlocks, cmOf),
		);
	}
}

@injectable
export class CenterOfMassController extends Component {
	constructor(
		@inject mainScreen: MainScreenLayout,
		@inject plot: SharedPlot,
		@inject actionController: ActionController,
		@inject playerRemotes: PlayerDataStorageRemotes,
	) {
		super();

		const visualizerState = ComponentStateContainer.create(
			this,
			new CenterOfMassVisualizer(plot.instance.WaitForChild("Blocks"), actionController, playerRemotes),
		);

		const enabledByButton = new ObservableValue(false);
		visualizerState.subscribeAndFrom({ enabledByButton });
		const button = this.parentGui(mainScreen.registerTopRightButton("CenterOfMass")) //
			.addButtonAction(() => enabledByButton.set(!enabledByButton.get()));

		this.event.subscribeObservable(
			visualizerState,
			(enabled) =>
				Transforms.create()
					.transform(button.instance, "Transparency", enabled ? 0 : 0.5, Transforms.commonProps.quadOut02)
					.run(button.instance),
			true,
		);
	}
}
