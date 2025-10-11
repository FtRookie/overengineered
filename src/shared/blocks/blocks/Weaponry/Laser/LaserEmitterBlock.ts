import { Players, RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { Colors } from "shared/Colors";
import { LaserProjectile } from "shared/weaponProjectiles/LaserProjectileLogic";
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

export type { Logic as LaserEmitterBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		// get outputs and the module
		const relativeOuts = new Map<BasePart, CFrame>();
		const module = WeaponModule.allModules[this.instance.Name];

		const mainpart = (this.instance as BlockModel & { MainPart: BasePart & { Sound: Sound } }).MainPart;
		const sound = mainpart.FindFirstChild("Sound") as Sound & {
			pitch: PitchShiftSoundEffect;
		};

		this.onFirstInputs(({ projectileColor }) => {
			(this.instance.FindFirstChild("Lens") as BasePart).Color = projectileColor;
		});

		const destroyProjectile = () => {
			for (const e of module.parentCollection.calculatedOutputs) {
				for (const o of e.outputs) {
					LaserProjectile.destroyProjectile.send({
						originPart: o.markerInstance,
					});
				}
			}
		};

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
			if (!fireTrigger) {
				sound?.Stop();
				destroyProjectile();
				return;
			}

			for (const e of module.parentCollection.calculatedOutputs) {
				if (sound) sound.pitch.Octave = math.random(1000, 1200) / 10000;
				for (const o of e.outputs) {
					sound?.Play();
					LaserProjectile.spawnProjectile.send({
						originPart: o.markerInstance,
						baseDamage: 1,
						modifier: e.modifier,
						color: projectileColor,
						owner: Players.LocalPlayer,
					});
				}
			}
		});
	}
}

export const LaserEmitterBlock = {
	...BlockCreation.defaults,
	id: "laseremitter",
	displayName: "Laser Emitter",
	description: "",

	weaponConfig: {
		type: "CORE",
		modifier: {
			speedModifier: {
				value: 10,
			},
		},
		markers: {
			inputMarker: {
				allowedBlockIds: [],
			},
			marker1: {
				emitsProjectiles: true,
				allowedBlockIds: ["laserlens"],
			},
		},
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
