import { Players } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { CannonBases } from "shared/blocks/blocks/Weaponry/Cannon/CannonBases";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import { Colors } from "shared/Colors";
import { ShellProjectile } from "shared/weaponProjectiles/ShellProjectileLogic";
import { WeaponModule } from "shared/weaponProjectiles/WeaponModuleSystem";
import { WeaponReloadController } from "shared/weaponProjectiles/WeaponReloadController";
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

export type { Logic as CannonBreechBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	readonly reload: WeaponReloadController;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const module = WeaponModule.allModules[this.instance.Name];
		const outputs = module.parentCollection.calculatedOutputs;
		this.reload = new WeaponReloadController(this, module.block.weaponConfig?.fireRate);

		// Cache each muzzle's MainPart + Sound once — looking them up via FindFirstChild on
		// every shot is wasteful and was previously done per-output, per-trigger.
		const muzzleParts = new Map<BlockModel, { mainpart: BasePart; sound: WeaponSound | undefined }>();
		const getMuzzle = (moduleInstance: BlockModel) =>
			muzzleParts.getOrSet(moduleInstance, () => {
				const mainpart = (moduleInstance as WeaponMuzzle).MainPart;
				return { mainpart, sound: mainpart.FindFirstChild("Sound") as WeaponSound | undefined };
			});

		const fireTrigger = this.initializeInputCache("fireTrigger");

		// Hold-to-fire: read the trigger straight from the input each tick and pour out shots while
		// held, throttled by the reload gate.
		this.onTicc(() => {
			if (!fireTrigger.get()) return;
			if (!this.reload.tryFire()) return;
			for (const e of outputs) {
				const { mainpart, sound } = getMuzzle(e.module.instance);

				if (sound) sound.pitch.Octave = math.random(1000, 1200) / 10000;
				for (const o of e.outputs) {
					sound?.Play();
					const direction = o.markerInstance.GetPivot().RightVector.mul(-1);
					mainpart.ApplyImpulse(direction.mul(-100));
					ShellProjectile.spawnProjectile.send({
						startPosition: o.markerInstance.Position.add(direction),
						baseVelocity: direction,
						baseDamage: 0,
						modifiers: e.modifiers,
						owner: Players.LocalPlayer,
						platformVelocity: mainpart.AssemblyLinearVelocity,
						// color: projectileColor,
					});
				}
			}
		});
	}
}

export const CannonBreech = {
	...BlockCreation.defaults,
	id: "cannonbreech",
	displayName: "Cannon Breech",
	description: "The tried and true method of destroying things",
	limit: WeaponConfig.limits.cannon,
	weaponConfig: {
		type: "CORE",
		fireRate: 0.3,
		modifier: {
			speedModifier: {
				value: 1,
			},
		},
		markers: {
			output1: {
				emitsProjectiles: false,
				allowedBlockIds: [...CannonBases.map((v) => v.id)],
			},
		},
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
