import { RunService, ServerStorage, Workspace } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { Objects } from "engine/shared/fixes/Objects";
import { BlockManager } from "shared/building/BlockManager";
import { SharedBuilding } from "shared/building/SharedBuilding";
import type { BuildingPlot } from "shared/building/BuildingPlot";

/** {@link PlotWelder} that automatically subscribes to {@link BuildingPlot} block changing */
@injectable
export class AutoPlotWelder extends Component {
	constructor(plot: BuildingPlot, @inject blockList: BlockList) {
		super();

		const welder = this.parent(new PlotWelder(plot, blockList));

		this.event.subscribe(plot.placeOperation.executed, (arg, result) => welder.weldOnPlot(result.model));
		// this.event.subscribe(plot.multiPlaceOperation.executed, (arg, result) => {
		// 	for (const model of result.models) {
		// 		welder.weldOnPlot(model);
		// 	}
		// });
		this.event.subscribe(plot.deleteOperation.executed, (arg, result) => {
			if (arg === "all") {
				welder.deleteWelds();
			} else {
				for (const block of arg) {
					welder.unweld(block);
					welder.deleteWeld(block);
				}
			}
		});

		this.event.subscribe(plot.editOperation.executing, (arg) => {
			for (const edit of arg) {
				welder.unweldFromOtherBlocks(edit.instance);
			}
		});
		this.event.subscribe(plot.editOperation.executed, (arg) => {
			for (const edit of arg) {
				welder.moveCollisions(edit.instance, edit.instance.GetPivot());
			}
		});
	}
}

@injectable
export class PlotWelder extends Component {
	readonly collidersParent: WorldModel;
	private readonly weldCache = new Map<BasePart, WeldConstraint[]>();

	constructor(
		private readonly plot: BuildingPlot,
		@inject private readonly blockList: BlockList,
	) {
		super();

		this.collidersParent = new Instance("WorldModel");
		this.collidersParent.Name = "PlotCollision";
		this.collidersParent.Parent = RunService.IsClient() ? Workspace : ServerStorage;

		ComponentInstance.init(this, this.collidersParent);
	}

	deleteWelds() {
		this.collidersParent.ClearAllChildren();
	}
	deleteWeld(block: BlockModel) {
		this.collidersParent.FindFirstChild(BlockManager.manager.uuid.get(block))?.Destroy();
	}

	private scaleWeldColliders(block: Model, originalModel: Model, scale: Vector3 | undefined) {
		scale ??= Vector3.one;

		const origModelCenter = originalModel.GetPivot();
		const blockCenter = block.GetPivot();

		const update = (instance: Instance, origInstance: Instance) => {
			// assuming no duplicate instance names on a single layer

			for (const origChild of origInstance.GetChildren()) {
				const name = origChild.Name;
				const child = instance.WaitForChild(name);

				if (child.IsA("BasePart") && origChild.IsA("BasePart")) {
					child.Size = origChild.Size.mul(origChild.CFrame.Rotation.Inverse().mul(scale).Abs());

					const offset = origModelCenter.ToObjectSpace(origChild.CFrame);
					child.Position = blockCenter.ToWorldSpace(new CFrame(offset.Position.mul(scale))).Position;
				}

				update(child, origChild);
			}
		};

		update(block, originalModel);
	}

	weldOnPlot(block: BlockModel) {
		const id = BlockManager.manager.id.get(block);
		if (!id) return;

		const originalCollider = this.blockList.blocks[id]?.weldRegions;
		if (!originalCollider) return;

		const collider = originalCollider.Clone();

		collider.Name = BlockManager.manager.uuid.get(block);
		collider.PivotTo(block.GetPivot());
		this.scaleWeldColliders(collider, originalCollider, BlockManager.manager.scale.get(block));

		collider.Parent = this.collidersParent;

		this.weld(collider, block);
	}

	private weld(colliders: Model, block: BlockModel) {
		const getTarget = (collider: BasePart): BasePart | undefined => {
			const targetBlock = this.plot.getBlock(collider.Parent!.Name as BlockUuid);
			let part: BasePart | undefined;

			const targetstr = collider.GetAttribute("target") as string | undefined;
			if (targetstr !== undefined) {
				part = (targetBlock as unknown as Record<string, BasePart>)[targetstr];
			}

			return (
				part ??
				(targetBlock.GetChildren().find((c) => c.Name.lower() !== "colbox" && c.IsA("BasePart")) as
					| BasePart
					| undefined) ??
				targetBlock.PrimaryPart
			);
		};

		const weldedTo = new Set<BasePart>();
		for (const collider of colliders.GetChildren()) {
			if (!collider.IsA("BasePart")) {
				$err("Found a non-BasePart in a collider!!!");
				continue;
			}

			const touchingWith = (colliders.Parent as WorldRoot).GetPartsInPart(collider);
			if (touchingWith.size() === 0) continue;

			const targetPart = getTarget(collider);
			if (!targetPart) continue;

			for (const anotherCollider of touchingWith) {
				const anotherTargetPart = getTarget(anotherCollider);
				if (!anotherTargetPart) continue;

				if (weldedTo.has(anotherTargetPart)) {
					continue;
				}
				weldedTo.add(anotherTargetPart);

				this.makeJoints(targetPart, anotherTargetPart);
			}
		}

		const weldData = BlockManager.manager.welds.get(block);
		if (weldData) {
			SharedBuilding.applyWelds(block, this.plot, weldData);
		}

		for (const welded of weldedTo) {
			const otherBlock = BlockManager.tryGetBlockModelByPart(welded);
			if (!otherBlock) continue;

			const weldData = BlockManager.manager.welds.get(otherBlock);
			if (weldData) {
				SharedBuilding.applyWelds(otherBlock, this.plot, weldData);
			}
		}
	}

	moveCollisions(block: BlockModel, newpivot: CFrame) {
		const child = this.collidersParent.FindFirstChild(BlockManager.manager.uuid.get(block)) as Model | undefined;
		if (!child) throw "what";

		this.unweldFromOtherBlocks(block);
		child.PivotTo(newpivot);
		this.scaleWeldColliders(
			child,
			this.blockList.blocks[BlockManager.manager.id.get(block)]!.weldRegions,
			BlockManager.manager.scale.get(block),
		);

		this.weld(child, block);
	}

	private makeJoints(part0: BasePart, part1: BasePart) {
		const weld = new Instance("WeldConstraint");

		weld.Part0 = part0;
		weld.Part1 = part1;
		weld.Name = "AutoWeld";

		weld.Parent = part0;

		const c0 = this.weldCache.get(part0);
		if (!c0) {
			this.weldCache.set(part0, [weld]);
			part0.Destroying.Connect(() => this.weldCache.delete(part0));
		} else {
			this.weldCache.set(part0, [...c0, weld]);
		}

		const c1 = this.weldCache.get(part1);
		if (!c1) {
			this.weldCache.set(part1, [weld]);
			part0.Destroying.Connect(() => this.weldCache.delete(part0));
		} else {
			this.weldCache.set(part1, [...c1, weld]);
		}

		weld.Destroying.Connect(() => {
			const c0 = this.weldCache.get(part0);
			if (c0) this.weldCache.set(part0, c0.except([weld]));

			const c1 = this.weldCache.get(part1);
			if (c1) this.weldCache.set(part1, c1.except([weld]));
		});
	}

	unweld(model: BlockModel): Set<BasePart> {
		const connected = new Set<BasePart>();

		const modelParts = model.GetChildren().filter((value) => value.IsA("BasePart") && value.CanCollide);
		for (let i = 0; i < modelParts.size(); i++) {
			const modelPart = modelParts[i] as BasePart;
			const welds = modelPart.GetJoints();
			welds.forEach((element) => {
				if (element.IsA("Constraint")) {
					if (element.Attachment0?.Parent?.IsA("BasePart")) {
						connected.add(element.Attachment0.Parent);
					}
					if (element.Attachment1?.Parent?.IsA("BasePart")) {
						connected.add(element.Attachment1.Parent);
					}
				} else {
					if (element.Part0) connected.add(element.Part0);
					if (element.Part1) connected.add(element.Part1);
				}

				element.Destroy();
			});
		}

		return connected;
	}

	getWeldsToOtherBlocks(model: BlockModel): Set<WeldConstraint> {
		const result = new Set<WeldConstraint>();

		const modelParts = model
			.GetChildren()
			.filter((value) => value.IsA("BasePart") && value.Name.lower() !== "colbox");
		for (let i = 0; i < modelParts.size(); i++) {
			const modelPart = modelParts[i] as BasePart;
			const welds = this.weldCache.get(modelPart) ?? Objects.empty;
			for (const weld of welds) {
				if ((weld.Part0?.IsDescendantOf(model) ?? true) && (weld.Part1?.IsDescendantOf(model) ?? true)) {
					continue;
				}

				result.add(weld);
			}
		}

		return result;
	}
	unweldFromOtherBlocks(model: BlockModel): void {
		for (const weld of this.getWeldsToOtherBlocks(model)) {
			weld.Destroy();
		}
	}
}
