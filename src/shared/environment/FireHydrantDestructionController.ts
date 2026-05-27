import { Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";

export class FireHydrantDestructionController extends HostedService {
	private respawnTime = 35;
	private forceTime = 0.25;
	private forceStrength = 150;
	private minimumSpeed = 50;
	private waterForceStrength = 1900;
	private waterForceRadius = 10;

	constructor() {
		super();

		this.onEnable(() => {
			for (const model of Workspace.GetDescendants()) {
				if (!model.IsA("Model") || model.Name !== "Fire Hydrant") continue;
				const main = model.FindFirstChild("Main") as BasePart;
				if (!main) continue;
				const collision = model.FindFirstChild("Collision") as BasePart;
				if (!collision) continue;
				const effect = model.FindFirstChild("Effect") as BasePart;
				if (!effect) continue;
				const particleEmitter = effect.FindFirstChildOfClass("ParticleEmitter");
				if (!particleEmitter) continue;

				let debounce = false;
				let isApplyingForce = false;

				const triggeredSound = main.FindFirstChild("TriggeredSound") as Sound;
				const sprayingSound = effect.FindFirstChild("SprayingSound") as Sound;
				const originalCFrame = main.CFrame;

				const applyWaterForce = () => {
					if (!isApplyingForce) return;
					const hydrantPosition = effect.Position;

					for (const object of Workspace.GetDescendants()) {
						if (!object.IsA("BasePart") || object.Anchored) continue;
						const objectPosition = object.Position;
						const distance = objectPosition.sub(hydrantPosition).Magnitude;
						if (distance <= this.waterForceRadius && objectPosition.Y > hydrantPosition.Y) {
							const forceMagnitude = (1 - distance / this.waterForceRadius) * this.waterForceStrength;
							const force = new Vector3(0, forceMagnitude, 0);
							object.ApplyImpulse(force.mul(object.GetMass()));
						}
					}
				};

				const respawn = () => {
					task.wait(this.respawnTime);
					main.CFrame = originalCFrame;
					main.Anchored = true;
					particleEmitter.Enabled = false;
					if (sprayingSound) sprayingSound.Stop();
					isApplyingForce = false;
					debounce = false;
				};

				const activateHydrant = () => {
					if (debounce) return;
					debounce = true;
					main.Anchored = false;
					if (triggeredSound) triggeredSound.Play();

					const force = new Instance("BodyVelocity");
					force.Velocity = new Vector3(0, this.forceStrength, 0);
					force.MaxForce = new Vector3(math.huge);
					force.Parent = main;

					task.wait(this.forceTime);
					force.Destroy();

					particleEmitter.Enabled = true;
					if (sprayingSound) sprayingSound.Play();

					task.spawn(respawn);
				};

				this.event.subscribe(collision.Touched, (hit) => {
					if (!hit?.IsA("BasePart") || debounce) return;
					const hitVelocity = hit.AssemblyLinearVelocity;
					if (hitVelocity.Magnitude >= this.minimumSpeed) {
						activateHydrant();
					}
				});
			}
		});
	}
}
