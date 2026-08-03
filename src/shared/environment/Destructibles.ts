import { Colors } from "shared/Colors";
import type { DestructibleSpec } from "shared/environment/DestructibleInstanceController";

type FireHydrant = Model & {
	Main: BasePart & { TriggeredSound?: Sound };
	Collision: BasePart;
	Effect: BasePart & { SprayingSound?: Sound };
};
type ParkingLotLight = Model & {
	"Cube.001": MeshPart & { PointLight: PointLight };
};

/** Upward velocity the hydrant cap leaves with, in studs/s. */
const hydrantLaunchSpeed = 150;
const parkingLightLitColor = Color3.fromRGB(221, 249, 255);

/**
 * Every knock-over-and-respawn map object. `id` is a save key — renaming one resets that toggle for every
 * player, the same way a block id would.
 */
export const destructibleSpecs = [
	{
		id: "firehydrant",
		displayName: "Fire hydrants",
		names: "Fire Hydrant",
		config: {
			// the buried body and its collision box stay put; only the cap pops
			trigger: (model) => (model as FireHydrant).Collision,
			loose: (model) => [(model as FireHydrant).Main],
			onBreak: (model) => {
				const hydrant = model as FireHydrant;
				const emitter = hydrant.Effect?.FindFirstChildOfClass("ParticleEmitter");
				if (!emitter) return;

				// An impulse of mass × speed leaves the part travelling at `speed`, which is what the old
				// BodyVelocity did over its 0.25s lifetime — without an instance, and without an API the
				// character integrity checker treats as an exploit.
				hydrant.Main.ApplyImpulse(new Vector3(0, hydrantLaunchSpeed, 0).mul(hydrant.Main.AssemblyMass));

				hydrant.Main.TriggeredSound?.Play();
				emitter.Enabled = true;
				hydrant.Effect.SprayingSound?.Play();
			},
			onRespawn: (model) => {
				const hydrant = model as FireHydrant;
				const emitter = hydrant.Effect?.FindFirstChildOfClass("ParticleEmitter");
				if (emitter) emitter.Enabled = false;

				hydrant.Effect?.SprayingSound?.Stop();
			},
		},
	},
	{
		id: "parkinglotlight",
		displayName: "Parking lot lights",
		names: "parking lot light2",
		config: {
			// only the post comes loose; the bulb rides with it
			loose: (model) => (model.PrimaryPart ? [model.PrimaryPart] : []),
			onBreak: (model) => {
				const light = (model as ParkingLotLight)["Cube.001"];
				if (!light) return;

				light.Color = Colors.black;
				light.PointLight.Enabled = false;
			},
			onRespawn: (model) => {
				const light = (model as ParkingLotLight)["Cube.001"];
				if (!light) return;

				light.Color = parkingLightLitColor;
				light.PointLight.Enabled = true;
			},
		},
	},
	{
		id: "tyrestack",
		displayName: "Tyre stacks",
		names: ["tyre stack", "tyre stack 1"],
		config: { minimumSpeed: 5 },
	},
] satisfies readonly DestructibleSpec[];
