import { Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";

export class TreeRotationController extends HostedService {
	private readonly treeNames: readonly string[] = ["tree1", "tree2", "deadtree"];
	constructor() {
		super();

		this.onEnable(() => {
			for (const tree of Workspace.GetDescendants()) {
				if (!tree.IsA("Model") || !this.treeNames.includes(tree.Name)) continue;
				this.setRandomRotation(tree, tree.Name === "deadtree");
			}
		});
	}
	private setRandomRotation(model: Model, isDeadTree: boolean) {
		if (!model.PrimaryPart)
			model.PrimaryPart = //
				(model.FindFirstChild("Trunk") ?? model.FindFirstChild("Main") ?? model.GetChildren()[1]) as BasePart;
		if (!model.PrimaryPart) return;

		let [xRot, yRot, zRot]: number[] = [];
		if (isDeadTree) {
			xRot = math.random(-15, 15);
			yRot = math.random(-360, 360);
			zRot = math.random(-15, 15);
		} else {
			xRot = math.random(-5, 5);
			yRot = math.random(-360, 360);
			zRot = math.random(-5, 5);
		}
		const rotation = CFrame.Angles(math.rad(xRot), math.rad(yRot), math.rad(zRot));
		model.PrimaryPart.CFrame = model.PrimaryPart.CFrame.mul(rotation);
	}
}
