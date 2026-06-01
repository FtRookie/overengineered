import { Players } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { Colors } from "shared/Colors";
import { PlasmaProjectile } from "shared/weaponProjectiles/PlasmaProjectileLogic";
import { WeaponMarkerController } from "shared/weaponProjectiles/WeaponMarkerController";
import { WeaponModule } from "shared/weaponProjectiles/WeaponModuleSystem";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

type WeaponSound = Sound & { pitch: PitchShiftSoundEffect };
type WeaponMuzzle = BlockModel & { MainPart: BasePart & { Sound: Sound } };

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

		const module = WeaponModule.allModules[this.instance.Name];
		const markers = new WeaponMarkerController(this, module);

		// Cache each muzzle's MainPart + Sound once instead of FindFirstChild per shot.
		const muzzleParts = new Map<BlockModel, { mainpart: BasePart; sound: WeaponSound | undefined }>();
		const getMuzzle = (moduleInstance: BlockModel) =>
			muzzleParts.getOrSet(moduleInstance, () => {
				const mainpart = (moduleInstance as WeaponMuzzle).MainPart;
				return { mainpart, sound: mainpart.FindFirstChild("Sound") as WeaponSound | undefined };
			});

		// fire on button press
		this.onk(["fireTrigger", "projectileColor"], ({ fireTrigger, projectileColor }) => {
			if (!fireTrigger) return;
			for (const e of markers.outputs) {
				const { sound } = getMuzzle(e.module.instance);

				if (sound) sound.pitch.Octave = math.random(1000, 1200) / 10000;
				for (const o of e.outputs) {
					const pp = e.module.instance.PrimaryPart;
					if (!pp) continue;

					sound?.Play();
					const direction = o.markerInstance.GetPivot().RightVector.mul(-1);
					const extraVelocity = direction.mul(5);
					const totalVelocity = direction.add(pp.AssemblyLinearVelocity).add(extraVelocity);

					PlasmaProjectile.spawnProjectile.send({
						startPosition: o.markerInstance.Position.add(direction),
						baseVelocity: totalVelocity,
						baseDamage: 60,
						modifiers: [{ heatDamage: { value: 0.01 } }, ...e.modifiers],
						owner: Players.LocalPlayer,
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
	description: '"Hey, just what you see pal"',

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
