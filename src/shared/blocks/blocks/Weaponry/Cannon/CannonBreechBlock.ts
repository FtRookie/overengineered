import { Players } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { CannonBases } from "shared/blocks/blocks/Weaponry/Cannon/CannonBases";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import { Colors } from "shared/Colors";
import { applyModifiers } from "shared/weaponProjectiles/BaseProjectileLogic";
import { ShellProjectile } from "shared/weaponProjectiles/ShellProjectileLogic";
import { WeaponModule } from "shared/weaponProjectiles/WeaponModuleSystem";
import { WeaponReloadController } from "shared/weaponProjectiles/WeaponReloadController";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

type WeaponSound = Sound & { pitch: PitchShiftSoundEffect };
type WeaponMuzzle = BlockModel & { MainPart: BasePart & { Sound: Sound } };

/** Recoil per point of impact damage. Kept in step with the machine gun, whose loader documents the choice. */
const RECOIL_PER_DAMAGE = 0.08;

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
	/** Absent only when the block failed to find its weapon module and burned itself. */
	readonly reload?: WeaponReloadController;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const module = WeaponModule.forBlock(this.instance);
		if (!module) {
			this.disableAndBurn();
			return;
		}

		// Read live rather than captured: collections merge as the chain is built, and the survivor is
		// whichever module happened to update first — so an array captured here can be superseded, leaving
		// the weapon reading one that is never recalculated again.
		const outputsOf = () => module.parentCollection.calculatedOutputs;
		const reload = new WeaponReloadController(this, module.block.weaponConfig?.fireRate);
		this.reload = reload;

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

			// Calibre lives in the bases and barrels, not the breech — one breech serves all three — so the
			// rate comes from whatever is doing the emitting. Slowest wins when several chains hang off one
			// breech, and the breech's own rate stands in for a bare one. Re-read per tick because the chain
			// is recalculated live and a barrel can be shot off mid-ride.
			let rate: number | undefined;
			for (const e of outputsOf()) {
				const own = e.module.block.weaponConfig?.fireRate;
				if (own === undefined) continue;
				if (rate === undefined || own < rate) rate = own;
			}
			reload.setFireRate(rate ?? module.block.weaponConfig?.fireRate);

			if (!reload.tryFire()) return;
			for (const e of outputsOf()) {
				const { mainpart, sound } = getMuzzle(e.module.instance);

				if (sound) sound.pitch.Octave = math.random(1000, 1200) / 10000;
				for (const o of e.outputs) {
					sound?.Play();
					const direction = o.markerInstance.GetPivot().RightVector.mul(-1);

					// Was a flat impulse shared by every calibre, so a bigger barrel cost only weight. Base 0
					// to match the projectile: the breech's own damage arrives as a modifier, not as a start.
					const punch = applyModifiers(0, e.modifiers, "impactDamage") * RECOIL_PER_DAMAGE;
					mainpart.ApplyImpulse(direction.mul(-punch));
					ShellProjectile.spawnProjectile.send({
						originPart: o.markerInstance,
						baseDamage: 0,
						modifiers: e.modifiers,
						owner: Players.LocalPlayer,
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
