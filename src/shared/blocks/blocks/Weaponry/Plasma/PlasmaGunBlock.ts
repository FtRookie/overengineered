import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { Colors } from "shared/Colors";
import { PlasmaProjectile } from "shared/weaponProjectiles/PlasmaProjectileLogic";
import { WeaponModule } from "shared/weaponProjectiles/WeaponModuleSystem";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		projectileColor: {
			displayName: "Projectile Color",
			types: {
				color: {
					config: Colors.pink,
				},
			},
		},
		fireTrigger: {
			displayName: "Fire",
			types: {
				bool: {
					config: false,
					control: {
						config: {
							enabled: true,
							key: "F",
							switch: false,
							reversed: false,
						},
						canBeReversed: false,
						canBeSwitch: false,
					},
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as PlasmaGunBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		// get outputs and the module
		const relativeOuts = new Map<BasePart, CFrame>();
		const module = WeaponModule.allModules[this.instance.Name];

		// disable markers
		module.parentCollection.setMarkersVisibility(false);

		// get relative directions
		for (const p of module.parentCollection.calculatedOutputs)
			for (const o of p.outputs)
				relativeOuts.set(o.markerInstance, this.instance.GetPivot().ToObjectSpace(o.markerInstance.CFrame));

		//update marker positions
		this.event.subscribe(RunService.Heartbeat, () => {
			const pivo = this.instance.GetPivot();
			for (const e of module.parentCollection.calculatedOutputs) {
				for (const o of e.outputs) {
					o.markerInstance.PivotTo(pivo.ToWorldSpace(relativeOuts.get(o.markerInstance)!));
				}
			}
		});

		// fire on button press
		this.onk(["fireTrigger", "projectileColor"], ({ fireTrigger, projectileColor }) => {
			if (!fireTrigger) return;
			for (const e of module.parentCollection.calculatedOutputs) {
				const mainpart = (e.module.instance as BlockModel & { MainPart: BasePart & { Sound: Sound } }).MainPart;
				const sound = mainpart.FindFirstChild("Sound") as Sound & {
					pitch: PitchShiftSoundEffect;
				};

				if (sound) sound.pitch.Octave = math.random(1000, 1200) / 10000;
				for (const o of e.outputs) {
					sound?.Play();
					const direction = o.markerInstance.GetPivot().RightVector.mul(-1);
					mainpart.ApplyImpulse(direction.mul(-100));
					PlasmaProjectile.spawnProjectile.send({
						startPosition: o.markerInstance.Position.add(direction),
						baseVelocity: e.module.instance.PrimaryPart!.AssemblyLinearVelocity.add(direction),
						baseDamage: 100,
						modifier: e.modifier,
						color: projectileColor,
					});
				}
			}
		});
	}
}

export const PlasmaGunBlock = {
	...BlockCreation.defaults,
	id: "plasmagun",
	displayName: "Plasma Gun",
	description: "",

	weaponConfig: {
		type: "CORE",
		modifier: {
			speedModifier: {
				value: 10,
			},
		},
		markers: {
			output1: {
				emitsProjectiles: true,
				allowedBlockIds: ["plasmagunbarrel", "plasmaseparatormuzzle", "plasmashotgunmuzzle"],
			},
		},
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
