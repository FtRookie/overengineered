import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { MachineGunAmmoBlocks } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunAmmoBlocks";
import { MachineGunBarrels } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunBarrels";
import { MachineGunMuzzleBrakes } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunMuzzleBrakes";
import { Colors } from "shared/Colors";
import { BulletProjectile } from "shared/weaponProjectiles/BulletProjectileLogic";
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

export type { Logic as MachineGunLoaderBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const module = WeaponModule.allModules[this.instance.Name];
		const markers = new WeaponMarkerController(this, module);

		// Cache each muzzle's MainPart + Sound once — looking them up via FindFirstChild on
		// every shot is wasteful and was previously done per-output, per-trigger.
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
				const { mainpart, sound } = getMuzzle(e.module.instance);

				if (sound) sound.pitch.Octave = math.random(1000, 1200) / 10000;
				for (const o of e.outputs) {
					sound?.Play();
					const direction = o.markerInstance.GetPivot().RightVector.mul(-1);
					mainpart.ApplyImpulse(direction.mul(-100));
					BulletProjectile.spawnProjectile.send({
						startPosition: o.markerInstance.Position.add(direction),
						baseVelocity: direction, //e.module.instance.PrimaryPart!.AssemblyLinearVelocity.add(direction),
						baseDamage: 0,
						modifiers: e.modifiers,
						// color: projectileColor,
					});
				}
			}
		});
	}
}

export const MachineGunLoader = {
	...BlockCreation.defaults,
	id: "mgloader",
	displayName: "Machine Gun Loader",
	description: "",

	weaponConfig: {
		type: "CORE",
		modifier: {
			impactDamage: {
				value: 130,
			},
			speedModifier: {
				value: 1000,
			},
		},
		markers: {
			output1: {
				emitsProjectiles: true,
				allowedBlockIds: [...MachineGunBarrels, ...MachineGunMuzzleBrakes, ...MachineGunAmmoBlocks].map(
					(v) => v.id,
				),
			},
			upgradeMarker: {},
		},
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
