import { Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";

export class TireStackDestructionController extends HostedService {
	private respawnTime = 35;
	private minimumSpeed = 5;
	private readonly tyreNames: readonly string[] = ["tyre stack", "tyre stack 1"];
	constructor() {
		super();

		this.onEnable(() => {
			for (const model of Workspace.GetDescendants()) {
				if (!model.IsA("Model") || !this.tyreNames.includes(model.Name)) continue;
				if (!model.PrimaryPart) continue;
				const originalCFrame = model.PrimaryPart.CFrame;
				let debounce = false;

				const respawn = () => {
					if (debounce) return;
					debounce = true;

					task.wait(this.respawnTime);
					model.PrimaryPart!.CFrame = originalCFrame;

					for (const part of model.GetDescendants().filter((i) => i.IsA("BasePart"))) {
						part.AssemblyLinearVelocity = Vector3.zero;
					}
					debounce = false;
				};

				this.event.subscribe(model.PrimaryPart.Touched, (hit) => {
					if (hit && hit.IsA("BasePart") && !debounce) {
						const hitVelocity = hit.AssemblyLinearVelocity;
						if (hitVelocity.Magnitude >= this.minimumSpeed) {
							task.spawn(respawn);
						}
					}
				});
			}
		});
	}
}
