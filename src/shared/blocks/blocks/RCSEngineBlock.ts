import { Workspace } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { Sound } from "shared/Sound";
import { VectorUtils } from "shared/utils/VectorUtils";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import type { ParticleEffect } from "shared/effects/ParticleEffect";
import type { SoundEffect } from "shared/effects/SoundEffect";

const definition = {
	inputOrder: ["direction", "trailLength", "trailColor"],
	input: {
		direction: {
			displayName: "Direction",
			tooltip:
				"Each vector axis represents the direction and force of the each engine. Each axis is clamped between -100 and 100.",
			unit: "Vector3 unit",
			types: {
				vector3: {
					config: Vector3.zero,
				},
			},
		},
		trailLength: {
			displayName: "Trail length",
			tooltip: "The length of the burst trail.",
			types: {
				number: {
					config: 1,
					clamp: {
						showAsSlider: true,
						min: 1,
						max: 5,
					},
				},
			},
		},
		trailColor: {
			displayName: "Trail color",
			types: {
				color: {
					config: Color3.fromRGB(255, 255, 255),
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		maxpower: {
			displayName: "Max Power (Newtons)",
			tooltip: "A constant. Shows how much force each engine can output.",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type Emitter = UnionOperation & {
	readonly Fire: ParticleEmitter;
};
type Engine = Instance & {
	readonly VectorForce: VectorForce;
	readonly Sound: Sound;
};
type RCSEngineModel = BlockModel & {
	readonly Engine1Emitter: Emitter;
	readonly Engine2Emitter: Emitter;
	readonly Engine3Emitter: Emitter;
	readonly Engine4Emitter: Emitter;
	readonly Engine5Emitter: Emitter;
	readonly Engine1: Engine;
	readonly Engine2: Engine;
	readonly Engine3: Engine;
	readonly Engine4: Engine;
	readonly Engine5: Engine;
	readonly ColBox: Part;
};

type SingleEngineConfiguration = {
	readonly particleEmitter: Emitter;
	readonly soundEmitter: Sound;
	readonly vectorForce: VectorForce;

	// last values written to the instance; reading a property back costs the same as writing one, so the
	// comparison is kept on the Luau side
	lastForce?: Vector3;
	lastEnabled?: boolean;
	lastAcceleration?: Vector3;
	lastPlaying?: boolean;
	lastVolume?: number;
};

const basePower = 500;
const maxSoundVolume = 0.25;
const maxParticlesAcceleration = 120;

export type { Logic as RCSEngineBlockLogic };

@injectable
class Logic extends InstanceBlockLogic<typeof definition, RCSEngineModel> {
	// Instances
	private readonly engineData: readonly SingleEngineConfiguration[];

	// Math
	private readonly maxPower;

	private thrust: Vector3 = Vector3.zero;

	constructor(
		block: InstanceBlockLogicArgs,
		@inject private readonly soundEffect: SoundEffect,
		@inject private readonly particleEffect: ParticleEffect,
	) {
		super(definition, block);

		const configure = (engine: Engine, particleEmitter: Emitter): SingleEngineConfiguration => ({
			particleEmitter,
			vectorForce: engine.VectorForce,
			soundEmitter: engine.Sound,
		});
		this.engineData = [
			configure(this.instance.Engine1, this.instance.Engine1Emitter),
			configure(this.instance.Engine2, this.instance.Engine2Emitter),
			configure(this.instance.Engine3, this.instance.Engine3Emitter),
			configure(this.instance.Engine4, this.instance.Engine4Emitter),
			configure(this.instance.Engine5, this.instance.Engine5Emitter),
		];

		// The strength depends on the material

		const blockScale = BlockManager.manager.scale.get(this.instance) ?? Vector3.one;
		const scale = blockScale.X * blockScale.Y * blockScale.Z;

		const material = BlockManager.manager.material.get(this.instance);
		const multiplier = math.max(1, math.round(new PhysicalProperties(material).Density / 2)) * scale;

		// Max power
		this.maxPower = basePower * multiplier;
		this.output.maxpower.set("number", this.maxPower);

		let trailColor = definition.input.trailColor.types.color.config;

		// fixed for the block's life; both were being recomputed or re-read on every engine of every update
		const sqrtScale = math.sqrt(scale);
		const primaryPart = this.instance.PrimaryPart!;

		const setEngineThrust = (engine: SingleEngineConfiguration, thrustPercentage: number, worldVolume: number) => {
			const emitter = engine.particleEmitter;
			// Force
			const force = new Vector3(this.maxPower * thrustPercentage);
			if (engine.lastForce !== force) {
				engine.lastForce = force;
				engine.vectorForce.Force = force;
			}

			// Particles
			const visualize = thrustPercentage !== 0;
			const newParticleEmitterAcceleration = emitter
				.GetPivot()
				.RightVector.mul(maxParticlesAcceleration * thrustPercentage);

			const particleEmmiterHasDifference =
				engine.lastEnabled !== visualize ||
				(engine.lastAcceleration ?? Vector3.zero).sub(newParticleEmitterAcceleration).Abs().Magnitude > 1;

			if (particleEmmiterHasDifference) {
				engine.lastEnabled = visualize;
				engine.lastAcceleration = newParticleEmitterAcceleration;
				emitter.Fire.Enabled = visualize;
				emitter.Fire.Acceleration = newParticleEmitterAcceleration;

				this.particleEffect.send(primaryPart, {
					particle: emitter.Fire,
					isEnabled: visualize,
					acceleration: newParticleEmitterAcceleration,
					color: trailColor,
				});
			}

			// Sound
			const newVolume = worldVolume * (maxSoundVolume * math.abs(thrustPercentage)) * sqrtScale;

			const volumeHasDifference =
				engine.lastPlaying !== visualize || math.abs((engine.lastVolume ?? 0) - newVolume) > 0.005;

			if (volumeHasDifference) {
				engine.lastPlaying = visualize;
				engine.lastVolume = newVolume;
				engine.soundEmitter.Playing = visualize;
				engine.soundEmitter.Volume = newVolume;

				this.soundEffect.send(primaryPart, {
					sound: engine.soundEmitter,
					isPlaying: visualize,
					volume: newVolume / 2,
				});
			}
		};

		// Taken as an argument rather than read off `this.thrust`: the shutdown below has to be able to say
		// zero, and every other caller is already torn down by then so there is nothing to guard against.
		const update = (thrust: Vector3) => {
			const thrustPercent = VectorUtils.apply(thrust, (v) => math.clamp(v, -100, 100) / 100);
			// depends on the block, not the engine, so it is read once rather than five times
			const worldVolume = Sound.getWorldVolume(this.instance.GetPivot().Y);

			setEngineThrust(this.engineData[0], -math.max(thrustPercent.Y, 0), worldVolume);

			setEngineThrust(this.engineData[1], -math.abs(math.max(thrustPercent.X, 0)), worldVolume);
			setEngineThrust(this.engineData[2], -math.abs(math.min(thrustPercent.X, 0)), worldVolume);

			setEngineThrust(this.engineData[4], -math.abs(math.max(thrustPercent.Z, 0)), worldVolume);
			setEngineThrust(this.engineData[3], -math.abs(math.min(thrustPercent.Z, 0)), worldVolume);
		};

		this.event.subscribe(Workspace.GetPropertyChangedSignal("Gravity"), () => update(this.thrust));
		this.onk(["direction"], ({ direction }) => {
			//nan check: a vector with a nan component does not equal itself
			if (direction !== direction) return;

			//the code
			this.thrust = direction;
			update(this.thrust);
		});

		this.onk(["trailLength"], ({ trailLength }) => {
			const val = new NumberRange(trailLength * 0.15);
			for (const engine of this.engineData) {
				engine.particleEmitter.Fire.Lifetime = val;
			}
		});

		this.onkFirstInputs(["trailColor"], ({ trailColor: value }) => {
			trailColor = value;

			const val = new ColorSequence(value);
			for (const engine of this.engineData) {
				engine.particleEmitter.Fire.Color = val;
			}
		});

		this.onEnable(() => {
			const particleScale = math.sqrt(BlockManager.manager.scale.get(this.instance)?.findMin() ?? 1);
			for (const emitter of this.engineData.map((d) => d.particleEmitter.Fire)) {
				emitter.Size = new NumberSequence(
					emitter.Size.Keypoints.map(
						(k) => new NumberSequenceKeypoint(k.Time, k.Value * particleScale, k.Envelope),
					),
				);

				this.particleEffect.send(primaryPart, {
					particle: emitter,
					isEnabled: false,
					acceleration: emitter.Acceleration,
					scale: particleScale,
				});
			}
		});

		// Force, particles and sound all have to come down; previously this returned at the guard because the
		// component was already disabled, leaving a burned engine thrusting for the rest of the ride.
		// Deferred so a ride exit, where the model is destroyed anyway, does not pay ten effect sends per block.
		this.onDisable(() =>
			task.defer(() => {
				if (this.isDestroyed()) return;
				update(Vector3.zero);
			}),
		);
	}
}

export const RCSEngineBlock = {
	...BlockCreation.defaults,
	id: "rcsengine",
	limitFamily: "engine",
	displayName: "RCS Engine",
	description: "Small rockets used to reorient a spacecraft, input vector correlates to each axis",
	limit: 50,
	mirror: {
		behaviour: "offset180",
	},
	search: {
		aliases: ["rcs"],
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
