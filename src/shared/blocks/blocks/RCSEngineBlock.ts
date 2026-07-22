import { Workspace } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { Colors } from "shared/Colors";
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

type singleEngineConfiguration = {
	readonly engine: Engine;
	readonly particleEmitter: Emitter;
	soundEmitter: Sound;
	vectorForce: VectorForce;
};

export type { Logic as RCSEngineBlockLogic };

@injectable
class Logic extends InstanceBlockLogic<typeof definition, RCSEngineModel> {
	// Instances
	private readonly engineData: readonly singleEngineConfiguration[] = [
		{
			engine: this.instance.Engine1,
			particleEmitter: this.instance.Engine1Emitter,
			soundEmitter: undefined!,
			vectorForce: undefined!,
		},
		{
			engine: this.instance.Engine2,
			particleEmitter: this.instance.Engine2Emitter,
			soundEmitter: undefined!,
			vectorForce: undefined!,
		},
		{
			engine: this.instance.Engine3,
			particleEmitter: this.instance.Engine3Emitter,
			soundEmitter: undefined!,
			vectorForce: undefined!,
		},
		{
			engine: this.instance.Engine4,
			particleEmitter: this.instance.Engine4Emitter,
			soundEmitter: undefined!,
			vectorForce: undefined!,
		},
		{
			engine: this.instance.Engine5,
			particleEmitter: this.instance.Engine5Emitter,
			soundEmitter: undefined!,
			vectorForce: undefined!,
		},
	];

	// Math
	private readonly basePower = 500;
	private readonly maxPower;

	// Const
	private readonly maxSoundVolume = 0.25;
	private readonly maxParticlesAcceleration = 120;

	private thrust: Vector3 = Vector3.zero;

	constructor(
		block: InstanceBlockLogicArgs,
		@inject private readonly soundEffect: SoundEffect,
		@inject private readonly particleEffect: ParticleEffect,
	) {
		super(definition, block);

		for (const d of this.engineData) {
			d.vectorForce = d.engine.VectorForce;
			d.soundEmitter = d.engine.Sound;
		}

		// The strength depends on the material

		const blockScale = BlockManager.manager.scale.get(this.instance) ?? Vector3.one;
		const scale = blockScale.X * blockScale.Y * blockScale.Z;

		const material = BlockManager.manager.material.get(this.instance);
		const multiplier = math.max(1, math.round(new PhysicalProperties(material).Density / 2)) * scale;

		// Max power
		this.maxPower = this.basePower * multiplier;
		this.output.maxpower.set("number", this.maxPower);

		const trailColorCache = this.initializeInputCache("trailColor");

		const setEngineThrust = (engine: singleEngineConfiguration, thrustPercentage: number) => {
			if (!engine.particleEmitter.Fire) return;
			// Force
			engine.vectorForce.Force = new Vector3(this.maxPower * thrustPercentage);

			// Particles
			const visualize = thrustPercentage !== 0;
			const newParticleEmitterAcceleration = engine.particleEmitter
				.GetPivot()
				.RightVector.mul(this.maxParticlesAcceleration * thrustPercentage);

			const particleEmmiterHasDifference =
				engine.particleEmitter.Fire.Enabled !== visualize ||
				engine.particleEmitter.Fire.Acceleration.sub(newParticleEmitterAcceleration).Abs().Magnitude > 1;

			engine.particleEmitter.Fire.Enabled = visualize;
			engine.particleEmitter.Fire.Acceleration = newParticleEmitterAcceleration;

			// Sound
			const newVolume =
				Sound.getWorldVolume(this.instance.GetPivot().Y) *
				(this.maxSoundVolume * math.abs(thrustPercentage)) *
				math.sqrt(scale);

			const volumeHasDifference =
				visualize !== engine.soundEmitter.Playing || math.abs(engine.soundEmitter.Volume - newVolume) > 0.005;
			engine.soundEmitter.Playing = visualize;
			engine.soundEmitter.Volume = newVolume;

			if (volumeHasDifference) {
				this.soundEffect.send(this.instance.PrimaryPart!, {
					sound: engine.soundEmitter,
					isPlaying: engine.soundEmitter.Playing,
					volume: engine.soundEmitter.Volume / 2,
				});
			}
			if (particleEmmiterHasDifference) {
				const trailColor = trailColorCache.tryGet();

				this.particleEffect.send(this.instance.PrimaryPart!, {
					particle: engine.particleEmitter?.Fire,
					isEnabled: engine.particleEmitter?.Fire.Enabled,
					acceleration: engine.particleEmitter?.Fire.Acceleration,
					color: trailColor ?? Colors.white,
				});
			}
		};

		const update = () => {
			if (!this.isEnabled()) return;
			const thrustPercent = VectorUtils.apply(this.thrust, (v) => math.clamp(v, -100, 100) / 100);
			setEngineThrust(this.engineData[0], -math.max(thrustPercent.Y, 0));

			setEngineThrust(this.engineData[1], -math.abs(math.max(thrustPercent.X, 0)));
			setEngineThrust(this.engineData[2], -math.abs(math.min(thrustPercent.X, 0)));

			setEngineThrust(this.engineData[4], -math.abs(math.max(thrustPercent.Z, 0)));
			setEngineThrust(this.engineData[3], -math.abs(math.min(thrustPercent.Z, 0)));
		};

		this.event.subscribe(Workspace.GetPropertyChangedSignal("Gravity"), update);
		this.onk(["direction"], ({ direction }) => {
			//nan check
			if (typeIs(direction.X, "number") && direction.X !== direction.X) return;
			if (typeIs(direction.Y, "number") && direction.Y !== direction.Y) return;
			if (typeIs(direction.Z, "number") && direction.Z !== direction.Z) return;

			//the code
			this.thrust = direction;
			update();
		});

		this.onk(["trailLength"], ({ trailLength }) => {
			const val = new NumberRange(trailLength * 0.15);
			for (const engine of this.engineData) {
				engine.particleEmitter.Fire.Lifetime = val;
			}
		});

		this.onk(["trailColor"], ({ trailColor }) => {
			const val = new ColorSequence(trailColor);
			for (const engine of this.engineData) {
				engine.particleEmitter.Fire.Color = val;
			}
		});

		this.onEnable(() => {
			const scale = math.sqrt(BlockManager.manager.scale.get(this.instance)?.findMin() ?? 1);
			for (const emitter of this.engineData.map((d) => d.particleEmitter.Fire)) {
				emitter.Size = new NumberSequence(
					emitter.Size.Keypoints.map((k) => new NumberSequenceKeypoint(k.Time, k.Value * scale, k.Envelope)),
				);

				this.particleEffect.send(this.instance.PrimaryPart!, {
					particle: emitter,
					isEnabled: false,
					acceleration: emitter.Acceleration,
					scale,
				});
			}
		});

		this.onDisable(() => update());
	}
}

export const RCSEngineBlock = {
	...BlockCreation.defaults,
	id: "rcsengine",
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
