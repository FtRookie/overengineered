import { Players } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { MachineGunAmmoBlocks } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunAmmoBlocks";
import { MachineGunBarrels } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunBarrels";
import { MachineGunMuzzleBrakes } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunMuzzleBrakes";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import { Colors } from "shared/Colors";
import { applyModifiers } from "shared/weaponProjectiles/BaseProjectileLogic";
import { BulletProjectile } from "shared/weaponProjectiles/BulletProjectileLogic";
import { WeaponModule } from "shared/weaponProjectiles/WeaponModuleSystem";
import { WeaponReloadController } from "shared/weaponProjectiles/WeaponReloadController";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

/**
 * Recoil per point of impact damage.
 *
 * There is no calibre value anywhere in the codebase, so the shot's own damage stands in for it: a round
 * that hits harder shoves harder. Chosen so a bare loader still kicks about as hard as the flat impulse it
 * replaces, and a heavy barrel is felt rather than free.
 */
const RECOIL_PER_DAMAGE = 0.08;

type WeaponSound = Sound & { pitch: PitchShiftSoundEffect };
type WeaponMuzzle = BlockModel & { MainPart: BasePart & { Sound: Sound } };

const definition = {
	input: {
		projectileColor: {
			displayName: "Tracer Color",
			types: {
				color: {
					config: Colors.yellow,
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

export { Logic as MachineGunLoaderBlockLogic };
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
		const projectileColor = this.initializeInputCache("projectileColor");

		// Hold-to-fire: every tick read the trigger straight from the input (fresh, so disable/re-enable
		// needs no special handling) and pour out shots while held, throttled by the reload gate.
		this.onTicc((ctx) => {
			if (!fireTrigger.get()) return;
			if (!this.reload.tryFire()) return;

			const color = projectileColor.get();

			for (const e of outputs) {
				const { mainpart, sound } = getMuzzle(e.module.instance);

				if (sound) sound.pitch.Octave = math.random(1000, 1200) / 10000;
				for (const o of e.outputs) {
					sound?.Play();
					const direction = o.markerInstance.GetPivot().RightVector.mul(-1);

					// Every barrel used to share one flat impulse, so the largest one cost only weight and
					// there was never a reason not to mount it. Base 0 to match the projectile: the loader's
					// own 130 arrives as a modifier, not as a starting value.
					const punch = applyModifiers(0, e.modifiers, "impactDamage") * RECOIL_PER_DAMAGE;
					mainpart.ApplyImpulse(direction.mul(-punch));
					BulletProjectile.spawnProjectile.send({
						originPart: o.markerInstance,
						baseDamage: 0,
						modifiers: e.modifiers,
						owner: Players.LocalPlayer,
						color,
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
	description: "Pew pew",
	limit: WeaponConfig.limits.mgLoader,

	weaponConfig: {
		type: "CORE",
		fireRate: 5.3,
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
