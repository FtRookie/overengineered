import { Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";

export class RockAndBushRotationController extends HostedService {
	private readonly objectNames: readonly string[] = ["Rock", "Bush"];
	constructor() {
		super();

		this.onEnable(() => {
			for (const obj of Workspace.GetDescendants()) {
				if (!obj.IsA("Model") || !this.objectNames.includes(obj.Name)) continue;
				this.randomRotation(obj);
			}
		});
	}

	randomRotation(model: Model) {
		if (!model.PrimaryPart) {
			model.PrimaryPart = (model.FindFirstChild("Main") ?? model.GetChildren()[0]) as BasePart;
		}
		if (!model.PrimaryPart) return;
		const [xRot, yRot, zRot] = [
			//
			math.random(-360, 360),
			math.random(-360, 360),
			math.random(-360, 360),
		];
		const rotation = CFrame.Angles(math.rad(xRot), math.rad(yRot), math.rad(zRot));
		model.PrimaryPart.CFrame = model.PrimaryPart.CFrame.mul(rotation);
	}
}
