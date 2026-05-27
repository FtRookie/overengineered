import { Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { Colors } from "shared/Colors";

type ParkingLotLight = Model & {
	"Cube.001": MeshPart & {
		PointLight: PointLight;
	};
};

export class ParkingLotLightsDestructionController extends HostedService {
	private respawnTime = 35;
	private minimumSpeed = 50;
	constructor() {
		super();

		this.onEnable(() => {
			for (const i of Workspace.GetDescendants()) {
				if (!i.IsA("Model") || i.Name !== "parking lot light2") continue;
				const model = i as ParkingLotLight;
				const light = model["Cube.001"];
				let debounce = false;

				if (!model.PrimaryPart || !light) return;
				const originalCFrame = model.PrimaryPart!.CFrame;
				model.PrimaryPart!.Anchored = true;
				light!.Color = Colors.white;
				light.PointLight.Enabled = true;

				const respawn = () => {
					if (debounce) return;
					debounce = true;
					task.wait(this.respawnTime);
					model.PrimaryPart!.CFrame = originalCFrame;
					light.Color = Color3.fromRGB(221, 249, 255);
					light.PointLight.Enabled = true;
					debounce = false;
				};

				this.event.subscribe(model.PrimaryPart.Touched, (hit) => {
					if (!hit?.IsA("BasePart") || debounce) return;
					const hitVelocity = hit.AssemblyLinearVelocity;
					if (hitVelocity.Magnitude > this.minimumSpeed) {
						model.PrimaryPart!.Anchored = false;
						task.spawn(respawn);
						light.Color = Colors.black;
						light.PointLight.Enabled = false;
					}
				});
			}
		});
	}
}
