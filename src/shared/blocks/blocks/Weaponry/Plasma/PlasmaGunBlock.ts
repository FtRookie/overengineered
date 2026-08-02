import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import { Colors } from "shared/Colors";
import { PlasmaProjectileSpawner } from "shared/weaponProjectiles/PlasmaProjectileLogic";
import { WeaponFireSound } from "shared/weaponProjectiles/WeaponFireSound";
import { WeaponModule } from "shared/weaponProjectiles/WeaponModuleSystem";
import { WeaponReloadController } from "shared/weaponProjectiles/WeaponReloadController";
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

type PlasmaGunModel = BlockModel & {
	readonly ColBox: BasePart;
	readonly MainPart: BasePart;
	readonly moduleMarkers: Folder;
};

export type { Logic as PlasmaGunBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, PlasmaGunModel> {
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

		const fireTrigger = this.initializeInputCache("fireTrigger");
		const projectileColor = this.initializeInputCache("projectileColor");

		// Hold-to-fire: read the trigger straight from the input each tick and pour out shots while
		// held, throttled by the reload gate.
		const fireSound = new WeaponFireSound.Broadcaster(this.instance);
		// Everyone stops hearing it when the gun burns, not just when the trigger is released.
		this.onDisableWithoutDespawn(() => fireSound.set(false, 0, () => []));

		this.onTicc(() => {
			if (!fireTrigger.get()) {
				fireSound.set(false, 0, () => []);
				return;
			}
			// Replicated as a toggle, not per round: the cadence is fixed while the trigger is held, so every
			// client can reproduce it from the interval alone.
			const resolved = module.block.weaponConfig?.fireRate;
			fireSound.set(true, resolved === undefined ? 0 : 1 / resolved, () =>
				outputsOf().map((e) => e.module.instance),
			);

			if (!reload.tryFire()) return;

			const color = projectileColor.get();

			for (const e of outputsOf()) {
				for (const o of e.outputs) {
					const pp = e.module.instance.PrimaryPart;
					if (!pp) continue;

					const direction = o.markerInstance.GetPivot().RightVector.mul(-1);
					const extraVelocity = direction.mul(5);
					const platformVelocity = pp.AssemblyLinearVelocity;
					// Total (with platform) only scales the kinetic-energy damage; the base adds platform itself.
					const totalVelocity = direction.add(platformVelocity).add(extraVelocity);

					const kineticE = totalVelocity.Magnitude * 0.1;

					// Damage breakdown:
					//	- heatDamage = flat value
					//	- impactDamage = velocity scaled
					//	- explosiveDamage = velocity scaled
					PlasmaProjectileSpawner.instance?.send(o.markerInstance, {
						originPart: o.markerInstance,
						startPosition: o.markerInstance.Position.add(direction),
						baseVelocity: direction.add(extraVelocity),
						baseDamage: kineticE,
						modifiers: [
							{ heatDamage: { value: 0.9 } }, // Flat value until upgrader exists
							{ explosiveDamage: { value: kineticE } },
							...e.modifiers,
						],
						color,
						platformVelocity,
						firingBlock: e.module.instance,
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
	limit: WeaponConfig.limits.plasmaGun,
	weaponConfig: {
		type: "CORE",
		fireRate: 2.5,
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

	logic: { definition, ctor: Logic, events: { fire: WeaponFireSound.event } },
} as const satisfies BlockBuilder;
