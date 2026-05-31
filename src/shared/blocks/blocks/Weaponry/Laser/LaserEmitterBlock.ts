import { Players } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { Colors } from "shared/Colors";
import { LaserProjectile } from "shared/weaponProjectiles/LaserProjectileLogic";
import { WeaponMarkerController } from "shared/weaponProjectiles/WeaponMarkerController";
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

		const module = WeaponModule.allModules[this.instance.Name];
		const markers = new WeaponMarkerController(this, module);

		const mainpart = (this.instance as BlockModel & { MainPart: BasePart & { Sound: Sound } }).MainPart;
		const sound = mainpart.FindFirstChild("Sound") as Sound & {
			pitch: PitchShiftSoundEffect;
		};

		this.onFirstInputs(({ projectileColor }) => {
			(this.instance.FindFirstChild("Lens") as BasePart).Color = projectileColor;
		});

		const destroyProjectile = () => {
			for (const e of markers.outputs) {
				for (const o of e.outputs) {
					LaserProjectile.destroyProjectile.send({
						originPart: o.markerInstance,
					});
				}
			}
		};

		// Tear down any active laser when the block disables (mode change, GARBAGE input,
		// destroy). Without this, exiting ride mode while firing leaves orphan visuals.
		this.onDisable(() => {
			sound?.Stop();
			destroyProjectile();
		});

		// fire on button press
		this.onk(["fireTrigger", "projectileColor"], ({ fireTrigger, projectileColor }) => {
			if (!fireTrigger) {
				sound?.Stop();
				destroyProjectile();
				return;
			}

			for (const e of markers.outputs) {
				if (sound) sound.pitch.Octave = math.random(1000, 1200) / 10000;
				for (const o of e.outputs) {
					sound?.Play();
					LaserProjectile.spawnProjectile.send({
						originPart: o.markerInstance,
						baseDamage: 1,
						modifiers: e.modifiers,
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
