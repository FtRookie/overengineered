import { Players } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import { Colors } from "shared/Colors";
import { PlasmaProjectile } from "shared/weaponProjectiles/PlasmaProjectileLogic";
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

export type { Logic as PlasmaGunBlockLogic };
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

		// Cache each muzzle's MainPart + Sound once instead of FindFirstChild per shot.
		const muzzleParts = new Map<BlockModel, { mainpart: BasePart; sound: WeaponSound | undefined }>();
		const getMuzzle = (moduleInstance: BlockModel) =>
			muzzleParts.getOrSet(moduleInstance, () => {
				// fixme: indexes MainPart rather than resolving it. Every emitter model happens to have one
				// today, but indexing a missing child throws — that is what took the whole medium machine
				// gun set out. MachineGunLoaderBlock resolves via PrimaryPart instead; match it when touched.
				const mainpart = (moduleInstance as WeaponMuzzle).MainPart;
				return { mainpart, sound: mainpart.FindFirstChild("Sound") as WeaponSound | undefined };
			});

		const fireTrigger = this.initializeInputCache("fireTrigger");
		const projectileColor = this.initializeInputCache("projectileColor");

		// Hold-to-fire: read the trigger straight from the input each tick and pour out shots while
		// held, throttled by the reload gate.
		this.onTicc(() => {
			if (!fireTrigger.get()) return;
			if (!reload.tryFire()) return;

			const color = projectileColor.get();

			for (const e of outputsOf()) {
				const { sound } = getMuzzle(e.module.instance);

				if (sound) sound.pitch.Octave = math.random(1000, 1200) / 10000;
				for (const o of e.outputs) {
					const pp = e.module.instance.PrimaryPart;
					if (!pp) continue;

					sound?.Play();
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
					PlasmaProjectile.spawnProjectile.send({
						startPosition: o.markerInstance.Position.add(direction),
						baseVelocity: direction.add(extraVelocity),
						baseDamage: kineticE,
						modifiers: [
							{ heatDamage: { value: 0.9 } }, // Flat value until upgrader exists
							{ explosiveDamage: { value: kineticE } },
							...e.modifiers,
						],
						owner: Players.LocalPlayer,
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

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
