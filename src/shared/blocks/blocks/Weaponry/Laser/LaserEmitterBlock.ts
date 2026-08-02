import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import { Colors } from "shared/Colors";
import { LaserProjectileSpawner } from "shared/weaponProjectiles/LaserProjectileLogic";
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

type LaserEmitterModel = BlockModel & {
	readonly ColBox: BasePart;
	readonly MainPart: BasePart;
	readonly moduleMarkers: Folder;
	readonly Lens: BasePart;
};

export type { Logic as LaserEmitterBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, LaserEmitterModel> {
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

		// The model ships no Sound, so every use below is guarded rather than assumed.
		const sound = this.instance.MainPart.FindFirstChild("Sound") as
			(Sound & { pitch: PitchShiftSoundEffect }) | undefined;

		this.onk(["projectileColor"], ({ projectileColor }) => {
			this.instance.Lens.Color = projectileColor;
		});

		const fireTrigger = this.initializeInputCache("fireTrigger");
		const projectileColor = this.initializeInputCache("projectileColor");

		// persistent beam keyed by origin marker; reconcile to the live outputs each tick so a
		// moved/disconnected lens drops its beam and a newly active output marker gets one
		const activeLasers = new Set<BasePart>();
		const currentMarkers = new Set<BasePart>();
		let firing = false;
		let lastColor: Color3 | undefined;

		// Spawn and teardown share one channel, so a stop carries the same shape with firing off.
		const stopBeam = (marker: BasePart) =>
			LaserProjectileSpawner.instance?.send(marker, {
				originPart: marker,
				firing: false,
				baseDamage: 0,
				modifiers: [],
				color: Colors.pink,
			});

		const stopAll = () => {
			for (const marker of activeLasers) stopBeam(marker);
			activeLasers.clear();
			sound?.Stop();
			firing = false;
			lastColor = undefined;
		};

		// A burned emitter would otherwise leave orphan beams; on a despawn they self-destruct once their
		// origin marker leaves the workspace.
		this.onDisableWithoutDespawn(stopAll);

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
			for (const e of outputsOf()) {
				for (const o of e.outputs) currentMarkers.add(o.markerInstance);
			}

			for (const marker of activeLasers) {
				if (currentMarkers.has(marker) && !refreshAll) continue;
				stopBeam(marker);
				activeLasers.delete(marker);
			}

			for (const e of outputsOf()) {
				for (const o of e.outputs) {
					if (activeLasers.has(o.markerInstance)) continue;
					LaserProjectileSpawner.instance?.send(o.markerInstance, {
						originPart: o.markerInstance,
						firing: true,
						baseDamage: 1,
						modifiers: e.modifiers,
						color,
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
