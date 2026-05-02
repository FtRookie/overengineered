import { RunService, Workspace } from "@rbxts/services";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { Signal } from "engine/shared/event/Signal";
import { BB } from "engine/shared/fixes/BB";
import { BlockManager } from "shared/building/BlockManager";

const getPlotBuildingRegion = (plot: PlotModel): BB => {
	const heightLimit = 400;
	const buildingPlane = plot.BuildingArea;

	return new BB(
		buildingPlane.GetPivot().add(new Vector3(0, heightLimit / 2, 0)),
		buildingPlane.Size.add(new Vector3(0, heightLimit, 0)).add(new Vector3(0.2, 0.2, 0.2)),
	);
};

export class SharedPlot extends InstanceComponent<PlotModel> {
	/** @client */
	private static readonly _anyChanged = new Signal<(plot: SharedPlot) => void>();
	/** @client */
	static readonly anyChanged = this._anyChanged.asReadonly();

	/** @client */
	readonly changed = new Signal();

	readonly version;
	readonly ownerId;
	readonly blacklistedPlayers;
	readonly isolationMode;
	readonly bounds: BB;

	readonly origin: CFrame;
	readonly boundingBox: BB;

	constructor(instance: PlotModel) {
		super(instance);

		this.changed.Connect(() => SharedPlot._anyChanged.Fire(this));

		this.version = this.event.observableFromAttribute<number>(instance, "version");
		if (RunService.IsClient()) {
			this.version.subscribe(() => this.changed.Fire());
		}

		this.ownerId = this.event.observableFromAttribute<number>(instance, "ownerid");
		this.blacklistedPlayers = this.event.observableFromAttributeJson<readonly number[]>(instance, "blacklisted");
		this.isolationMode = this.event.observableFromAttribute<boolean>(instance, "isolation");
		this.bounds = getPlotBuildingRegion(instance);
		this.origin = this.getCenter();
		this.boundingBox = this.bounds;
	}

	getCenter() {
		return this.instance.BuildingArea.GetPivot();
	}

	/** @deprecated TOBEDELETED */
	getBlockDatas(): readonly PlacedBlockData[] {
		return this.getBlocks().map(BlockManager.getBlockDataByBlockModel);
	}
	/** @deprecated TOBEDELETED */
	getBlocks(): readonly BlockModel[] {
		return this.instance.WaitForChild("Blocks").GetChildren() as BlockModel[];
	}
	getBlock(uuid: BlockUuid): BlockModel {
		return (this.instance.WaitForChild("Blocks") as unknown as Record<BlockUuid, BlockModel>)[uuid];
	}
	tryGetBlock(uuid: BlockUuid): BlockModel | undefined {
		return this.instance.WaitForChild("Blocks").FindFirstChild(uuid) as BlockModel | undefined;
	}
	getSpawnCFrame() {
		return new CFrame(this.getSpawnPosition()).mul(CFrame.Angles(0, math.rad(90), 0));
	}
	getSpawnPosition() {
		return this.instance.BuildingArea.GetPivot().Position.add(
			new Vector3(this.instance.BuildingArea.ExtentsSize.X / 2 + 2, 10, 0),
		);
	}

	/** Is the provided `Instance` is a plot model */
	static isPlot(model: Instance | undefined): model is PlotModel {
		return model?.Parent === Workspace.FindFirstChild("Plots");
	}

	/** Is the provided instance a block on this plot */
	hasBlock(instance: BlockModel | BasePart): boolean {
		if (!instance) {
			return false;
		}

		const fastcheck = instance.IsA("Model") ? instance.Parent?.Parent : undefined;
		if (fastcheck && SharedPlot.isPlot(fastcheck)) {
			return true;
		}

		let parent = instance.Parent;
		while (parent) {
			if (SharedPlot.isPlot(parent)) {
				return true;
			}

			parent = parent.Parent;
		}

		return false;
	}

	/** Is player allowed to build on this plot */
	isBuildingAllowed(playerId: number): boolean {
		return this.ownerId.get() === playerId;
	}

	isBlacklisted(player: Player): boolean {
		return this.isolationMode.get() === true || this.blacklistedPlayers.get()?.includes(player.UserId) === true;
	}
}
