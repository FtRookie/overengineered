import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { Colors } from "shared/Colors";
import { Sound } from "shared/Sound";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults, BlockLogicInfo } from "shared/blocks/Block";
import type { ParticleEffect } from "shared/effects/ParticleEffect";
import type { SoundEffect } from "shared/effects/SoundEffect";

const rocketEngineLogicDefinition = {
	inputOrder: ["thrust", "strength", "flameColor"],
	input: {
		thrust: {
			displayName: "Thrust",
			unit: "Percentage",
			types: {
				number: {
					config: 0,
					clamp: {
						showAsSlider: false,
						min: 0,
						max: 100,
					},
					control: {
						config: {
							enabled: true,
							startValue: 0,
							mode: {
								type: "smooth",
								instant: {
									mode: "onRelease",
								},
								smooth: {
									speed: 20,
									mode: "stopOnRelease",
								},
							},
							keys: [
								{ key: "W", value: 100 },
								{ key: "S", value: 0 },
							],
						},
					},
				},
			},
		},
		strength: {
			displayName: "Strength",
			unit: "Percentage",
			types: {
				number: {
					config: 100,
					clamp: {
						showAsSlider: true,
						max: 100,
						min: 0,
					},
				},
			},
		},
		flameColor: {
			displayName: "Flame Color",
			types: {
				color: {
					config: Color3.fromRGB(255, 250, 185),
				},
			},
		},
	},
	output: {
		maxpower: {
			displayName: "Force",
			unit: "Rowtons",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type RocketModel = BlockModel & {
	readonly EffectEmitter: Part & {
		readonly Fire: ParticleEmitter;
	};
	readonly Engine: Instance & {
		readonly VectorForce: VectorForce;
		readonly Sound: Sound;
	};
	readonly ColBox: Part;
};

export type { Logic as RocketBlockLogic };

@injectable
class Logic extends InstanceBlockLogic<typeof rocketEngineLogicDefinition, RocketModel> {
	// Instances
	private readonly engine;
	private readonly vectorForce;
	private readonly particleEmitter;
	private readonly sound;

	// Math
	private readonly basePower = 30_000;
	private readonly maxPower;

	// Const
	private readonly maxSoundVolume = 0.5;
	private readonly maxParticlesAcceleration = 120;

	private cachedThrust = 0;
	// last values written to the instance, so a held throttle costs no engine crossings
	private lastForce: Vector3 | undefined;
	private lastEmitterEnabled: boolean | undefined;
	private lastEmitterAcceleration: Vector3 | undefined;
	private lastSoundPlaying: boolean | undefined;
	private lastSoundVolume: number | undefined;
	private readonly multipler;

	constructor(
		block: InstanceBlockLogicArgs,
		@inject private readonly soundEffect: SoundEffect,
		@inject private readonly particleEffect: ParticleEffect,
	) {
		super(rocketEngineLogicDefinition, block);

		// Instances
		const colbox = this.instance.ColBox;
		this.engine = this.instance.Engine;
		this.vectorForce = this.engine.VectorForce;
		this.sound = this.engine.Sound;
		this.particleEmitter = this.instance.EffectEmitter.Fire;

		// Math
		let multiplier = (colbox.Size.X * colbox.Size.Y * colbox.Size.Z) / 8;
		this.multipler = multiplier;

		// The strength depends on the material
		const material = BlockManager.manager.material.get(this.instance);
		multiplier *= math.max(1, new PhysicalProperties(material).Density / 2);

		// Max power
		this.maxPower = this.basePower * multiplier;
		this.output.maxpower.set("number", this.maxPower);

		this.onk(["flameColor"], ({ flameColor }) => {
			this.particleEmitter.Color = new ColorSequence([
				new ColorSequenceKeypoint(0, flameColor),
				new ColorSequenceKeypoint(0.0868, flameColor.Lerp(Colors.black, 0.0868)),
				new ColorSequenceKeypoint(1, Colors.black),
			]);

			this.particleEffect.send(this.instance.PrimaryPart!, {
				particle: this.particleEmitter,
				colorSequence: this.particleEmitter.Color,
			});
		});

		this.onAlwaysInputs(({ thrust, strength }) => {
			//nan check
			if (typeIs(thrust, "number") && thrust !== thrust) return;

			//the code
			this.cachedThrust = thrust;
			this.update(thrust, strength);
		});

		this.onEnable(() => {
			const scale = math.sqrt(BlockManager.manager.scale.get(this.instance)?.findMin() ?? 1);
			this.particleEmitter.Size = new NumberSequence(
				this.particleEmitter.Size.Keypoints.map(
					(k) => new NumberSequenceKeypoint(k.Time, k.Value * scale, k.Envelope),
				),
			);

			this.particleEffect.send(this.instance.PrimaryPart!, {
				particle: this.particleEmitter,
				isEnabled: false,
				acceleration: this.particleEmitter.Acceleration,
				scale,
			});
		});

		this.onDisable(() => this.update(0, 0));
	}

	private update(thrust: number, strength: number) {
		const thrustPercent = thrust / 100;
		const strengthPercent = strength / 100;

		// Force
		const newForce = new Vector3(this.maxPower * thrustPercent * strengthPercent);
		if (this.lastForce !== newForce) {
			this.lastForce = newForce;
			this.vectorForce.Force = newForce;
		}

		// Particles
		const visualize = thrustPercent !== 0;
		const newParticleEmitterAcceleration = this.instance
			.GetPivot()
			.RightVector.mul(this.maxParticlesAcceleration * thrustPercent * strengthPercent);

		const particleEmmiterHasDifference =
			this.lastEmitterEnabled !== visualize ||
			(this.lastEmitterAcceleration ?? Vector3.zero).sub(newParticleEmitterAcceleration).Abs().Magnitude > 1;

		if (this.lastEmitterEnabled !== visualize) {
			this.lastEmitterEnabled = visualize;
			this.particleEmitter.Enabled = visualize;
		}
		if (this.lastEmitterAcceleration !== newParticleEmitterAcceleration) {
			this.lastEmitterAcceleration = newParticleEmitterAcceleration;
			this.particleEmitter.Acceleration = newParticleEmitterAcceleration;
		}

		// Sound
		const newVolume =
			Sound.getWorldVolume(this.instance.GetPivot().Y) *
			(this.maxSoundVolume * thrustPercent * strengthPercent) *
			math.sqrt(this.multipler);

		const volumeHasDifference =
			visualize !== this.lastSoundPlaying || math.abs((this.lastSoundVolume ?? 0) - newVolume) > 0.005;

		if (this.lastSoundPlaying !== visualize) {
			this.lastSoundPlaying = visualize;
			this.sound.Playing = visualize;
		}
		if (this.lastSoundVolume !== newVolume) {
			this.lastSoundVolume = newVolume;
			this.sound.Volume = newVolume;
		}

		if (volumeHasDifference) {
			this.soundEffect.send(this.instance.PrimaryPart!, {
				sound: this.sound,
				isPlaying: visualize,
				volume: newVolume,
			});
		}
		if (particleEmmiterHasDifference) {
			this.particleEffect.send(this.instance.PrimaryPart!, {
				particle: this.particleEmitter,
				isEnabled: visualize,
				acceleration: newParticleEmitterAcceleration,
			});
		}
	}

	getThrust() {
		return this.cachedThrust;
	}
}

const logic: BlockLogicInfo = { definition: rocketEngineLogicDefinition, ctor: Logic };
const list: BlockBuildersWithoutIdAndDefaults = {
	rocketengine: {
		displayName: "Rocket Engine",
		description: "Engines your rocket into the space and onto the ground",
		logic,
		mirror: {
			behaviour: "offset180",
		},
		limit: 50,
	},
	smallrocketengine: {
		displayName: "Small Rocket Engine",
		description: "Engines your rocket into the space and onto the ground, but smaller",
		logic,
		mirror: {
			behaviour: "offset180",
		},
		limit: 50,
	},
};
export const RocketBlocks = BlockCreation.arrayFromObject(list);
