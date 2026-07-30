import { Players } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
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

		const module = WeaponModule.allModules[this.instance.Name];
		const outputs = module.parentCollection.calculatedOutputs;

		const mainpart = (this.instance as BlockModel & { MainPart: BasePart & { Sound: Sound } }).MainPart;
		const sound = mainpart.FindFirstChild("Sound") as Sound & {
			pitch: PitchShiftSoundEffect;
		};

		this.onk(["projectileColor"], ({ projectileColor }) => {
			(this.instance.FindFirstChild("Lens") as BasePart).Color = projectileColor;
		});

		const fireTrigger = this.initializeInputCache("fireTrigger");
		const projectileColor = this.initializeInputCache("projectileColor");

		// persistent beam keyed by origin marker; reconcile to the live outputs each tick so a
		// moved/disconnected lens drops its beam and a newly active output marker gets one
		const activeLasers = new Set<BasePart>();
		const currentMarkers = new Set<BasePart>();
		let firing = false;
		let lastColor: Color3 | undefined;

		const stopAll = () => {
			for (const marker of activeLasers) LaserProjectile.destroyProjectile.send({ originPart: marker });
			activeLasers.clear();
			sound?.Stop();
			firing = false;
			lastColor = undefined;
		};

		// without this, exiting ride mode while firing leaves orphan beams
		this.onDisable(stopAll);

		this.onTicc(() => {
			if (!fireTrigger.get()) {
				if (firing) stopAll();
				return;
			}

			if (!firing) {
				firing = true;
				if (sound) {
					sound.pitch.Octave = math.random(1000, 1200) / 10000;
					sound.Play();
				}
			}

			const color = projectileColor.tryGet() ?? Colors.pink;
			const refreshAll = color !== lastColor; // color changed -> respawn beams with the new color
			lastColor = color;

			currentMarkers.clear();
			for (const e of outputs) {
				for (const o of e.outputs) currentMarkers.add(o.markerInstance);
			}

			for (const marker of activeLasers) {
				if (currentMarkers.has(marker) && !refreshAll) continue;
				LaserProjectile.destroyProjectile.send({ originPart: marker });
				activeLasers.delete(marker);
			}

			for (const e of outputs) {
				for (const o of e.outputs) {
					if (activeLasers.has(o.markerInstance)) continue;
					LaserProjectile.spawnProjectile.send({
						originPart: o.markerInstance,
						baseDamage: 1,
						modifiers: e.modifiers,
						color,
						owner: Players.LocalPlayer,
					});
					activeLasers.add(o.markerInstance);
				}
			}
		});
	}
}

export const LaserEmitterBlock = {
	...BlockCreation.defaults,
	id: "laseremitter",
	displayName: "Laser Emitter",
	description: "Annoy pilots",
	limit: WeaponConfig.limits.laserEmitter,
	weaponConfig: {
		type: "CORE",
		modifier: {
			speedModifier: {
				value: 10, // Why does it need this???
			},
			heatDamage: { value: 0.125 },
			impactDamage: { value: 0, isRelative: true },
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
