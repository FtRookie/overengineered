import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { ArmoredMachineGunBarrels } from "shared/blocks/blocks/Weaponry/Machinegun/ArmoredMachineGunBarrels";
import { MachineGunAmmoBlocks } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunAmmoBlocks";
import { MachineGunBarrels } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunBarrels";
import { MachineGunMuzzleBrakes } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunMuzzleBrakes";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import { Colors } from "shared/Colors";
import { applyModifiers } from "shared/weaponProjectiles/BaseProjectileLogic";
import { BulletProjectileSpawner } from "shared/weaponProjectiles/BulletProjectileLogic";
import { WeaponFireSound } from "shared/weaponProjectiles/WeaponFireSound";
import { WeaponModule } from "shared/weaponProjectiles/WeaponModuleSystem";
import { WeaponReloadController } from "shared/weaponProjectiles/WeaponReloadController";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import type { WeaponSound } from "shared/weaponProjectiles/WeaponFireSound";

/**
 * Recoil per point of impact damage.
 *
 * There is no calibre value anywhere in the codebase, so the shot's own damage stands in for it: a round
 * that hits harder shoves harder. Chosen so a bare loader still kicks about as hard as the flat impulse it
 * replaces, and a heavy barrel is felt rather than free.
 */
const RECOIL_PER_DAMAGE = 0.08;

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

type MachineGunLoaderModel = BlockModel & {
	readonly ColBox: BasePart;
	readonly MainPart: BasePart;
	readonly moduleMarkers: Folder;
};

export { Logic as MachineGunLoaderBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, MachineGunLoaderModel> {
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

		// Cache each muzzle's body part + Sound once — looking them up via FindFirstChild on
		// every shot is wasteful and was previously done per-output, per-trigger.
		//
		// Not every model names its body "MainPart" — the whole medium set uses MediumBarrel/MediumMuzzle,
		// and so does AmmoBox — so this resolves rather than indexes. Indexing a missing child throws, and
		// inside the firing tick that took the entire weapon out on its first shot.
		const muzzleParts = new Map<BlockModel, { mainpart: BasePart | undefined; sound: WeaponSound | undefined }>();
		const getMuzzle = (moduleInstance: BlockModel) =>
			muzzleParts.getOrSet(moduleInstance, () => ({
				mainpart:
					(moduleInstance.FindFirstChild("MainPart") as BasePart | undefined) ?? moduleInstance.PrimaryPart,
				sound: moduleInstance.FindFirstChild("Sound", true) as WeaponSound | undefined,
			}));

		const fireTrigger = this.initializeInputCache("fireTrigger");
		const projectileColor = this.initializeInputCache("projectileColor");

		// Hold-to-fire: every tick read the trigger straight from the input (fresh, so disable/re-enable
		// needs no special handling) and pour out shots while held, throttled by the reload gate.
		const fireSound = new WeaponFireSound.Broadcaster(this.instance);
		// Everyone stops hearing it when the gun burns, not just when the trigger is released.
		this.onDisableWithoutDespawn(() => fireSound.set(false, 0, () => []));

		this.onTicc((ctx) => {
			if (!fireTrigger.get()) {
				fireSound.set(false, 0, () => []);
				return;
			}

			// Calibre lives in the barrels and muzzles, not the loader — one loader serves light and heavy —
			// so the rate comes from whatever is doing the emitting. Slowest wins when several chains hang off
			// one loader, and the loader's own rate stands in for a bare one. Re-read per tick because the
			// chain is recalculated live and a barrel can be shot off mid-ride.
			let rate: number | undefined;
			for (const e of outputsOf()) {
				const own = e.module.block.weaponConfig?.fireRate;
				if (own === undefined) continue;
				if (rate === undefined || own < rate) rate = own;
			}
			const resolved = rate ?? module.block.weaponConfig?.fireRate;
			reload.setFireRate(resolved);

			// Replicated as a toggle, not per round: the cadence is fixed while the trigger is held, so every
			// client can reproduce it from the interval alone.
			fireSound.set(true, resolved === undefined ? 0 : 1 / resolved, () =>
				outputsOf().map((e) => e.module.instance),
			);

			if (!reload.tryFire()) return;

			const color = projectileColor.get();

			for (const e of outputsOf()) {
				const { mainpart } = getMuzzle(e.module.instance);

				for (const o of e.outputs) {
					const direction = o.markerInstance.GetPivot().RightVector.mul(-1);

					// Every barrel used to share one flat impulse, so the largest one cost only weight and
					// there was never a reason not to mount it. Base 0 to match the projectile: the loader's
					// own 130 arrives as a modifier, not as a starting value.
					const punch = applyModifiers(0, e.modifiers, "impactDamage") * RECOIL_PER_DAMAGE;
					mainpart?.ApplyImpulse(direction.mul(-punch));
					BulletProjectileSpawner.instance?.send(o.markerInstance, {
						originPart: o.markerInstance,
						baseDamage: 0,
						modifiers: e.modifiers,
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
				allowedBlockIds: [
					...MachineGunBarrels,
					...ArmoredMachineGunBarrels,
					...MachineGunMuzzleBrakes,
					...MachineGunAmmoBlocks,
				].map((v) => v.id),
			},
			upgradeMarker: {},
		},
	},

	logic: { definition, ctor: Logic, events: { fire: WeaponFireSound.event } },
} as const satisfies BlockBuilder;
