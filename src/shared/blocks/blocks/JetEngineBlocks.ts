import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { GameEnvironment } from "shared/data/GameEnvironment";
import { Physics } from "shared/Physics";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults, BlockLogicInfo } from "shared/blocks/Block";
import type { SoundEffect } from "shared/effects/SoundEffect";

/** Newtons. Below one part in 10^5 of a jet's output. */
const FORCE_EPSILON = 1;

const definition = {
	inputOrder: ["thrust", "strength"],
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
	},
	output: {
		maxpower: {
			displayName: "Force",
			unit: "Rowtons",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type JetModel = BlockModel & {
	readonly TurbineShaft: MeshPart & {
		readonly Working: Sound;
		readonly Idle: Sound;
		readonly Start: Sound;
		readonly Shut: Sound;
	};
	readonly TurbineBody: (UnionOperation | Part | MeshPart) & {
		readonly VectorForce: VectorForce;
		readonly BladeLocation: Attachment;
	};
	readonly ColBox: Part;
};

type EngineProfile = {
	/**
	 * Static thrust / dry weight.
	 * - 6.0 — GE90 (777)
	 * - 4.6 — J79 (F-4 Phantom II)
	 * - 7.8 — F404 (F/A-18 Hornet)
	 * - 8.0 — F100 (F-15, F-16)
	 * - 9.0 — F119 (F-22 Raptor)
	 * - 10.5 — F135 (F-35 Lightning II)
	 */
	readonly thrustToWeight: number;
	/**
	 * Ve as Mach. Thrust reaches zero at this airspeed.
	 * - 0.9 — high-bypass turbofan, 300 m/s (GE90)
	 * - 1.7 — turbojet dry, 600 m/s (Olympus 593, Concorde)
	 * - 2.9 — reheated, 1000 m/s (F135, F119)
	 * - 4.0 — ramjet (J58 at cruise, SR-71)
	 */
	readonly exhaustMach: number;
	/**
	 * Ve/Vc. Peak (1+g)²/4g at (g-1)/2g·Ve.
	 * - 2 — 1.13x @ M0.73 (subsonic transport)
	 * - 4 — 1.56x @ M1.09 (supersonic fighter)
	 * - 6 — 2.04x @ M1.21 (interceptor)
	 * - 9 — 2.78x @ M1.29 (ramjet-assisted)
	 */
	readonly ramGain: number;
};

/** High-bypass fan (GE90). Peaks M0.38, gone by M1.5. */
const civilProfile: EngineProfile = { thrustToWeight: 6, exhaustMach: 1.5, ramGain: 2 };
/** Reheated low-bypass turbofan (F135, 0.57:1). Peaks M1.09, gone by M2.9. */
const militaryProfile: EngineProfile = { thrustToWeight: 10.5, exhaustMach: 2.9, ramGain: 4 };

export type { Logic as JetBlockLogic };

class Logic extends InstanceBlockLogic<typeof definition, JetModel> {
	// Instances
	private readonly vectorForce;

	// Math
	private readonly maxPower;
	private readonly exhaustSpeed;

	constructor(
		profile: EngineProfile,
		block: InstanceBlockLogicArgs,
		private readonly soundEffect: SoundEffect,
	) {
		super(definition, block);

		// const
		const maxSoundVolume = 0.5;

		// vals
		const thrust = this.initializeInputCache("thrust");

		// Instances
		const shaft = this.instance.TurbineShaft;
		const body = this.instance.TurbineBody;
		// const hinge = shaft.HingeConstraint;

		this.vectorForce = body.VectorForce;

		// Sounds
		const wSound = shaft.Working;
		const iSound = shaft.Idle;
		const stSound = shaft.Start;
		const shSound = shaft.Shut;
		const soundStageArray = [stSound, shSound];

		// Math
		const scale = BlockManager.manager.scale.get(this.instance) ?? Vector3.one;

		let mass = 0;
		for (const part of this.instance.GetDescendants()) {
			if (!part.IsA("BasePart") || part.Massless) continue;
			mass += part.Mass;
		}

		// F ∝ intake area (Y·Z); mass carries X, so X divides out. Material is carried by mass, ratio fixed.
		this.maxPower = (profile.thrustToWeight * mass * GameEnvironment.EarthGravity) / scale.X;
		this.output.maxpower.set("number", this.maxPower);

		// √ so player scaling does not run away: X1 — M1.5/2.9, X2 — M2.1/4.1, X3 — M2.6/5.0.
		this.exhaustSpeed = GameDefinitions.SPEED_OF_SOUND * profile.exhaustMach * math.sqrt(scale.X);

		let playing: Sound = iSound;
		const stopOtherSoundAndPlayNewOne = (sound: Sound) => {
			if (playing === sound) return;

			this.soundEffect.send(this.instance.PrimaryPart!, {
				sound: playing,
				isPlaying: false,
				volume: playing.Volume,
			});

			this.soundEffect.send(this.instance.PrimaryPart!, {
				sound: sound,
				isPlaying: true,
				volume: playing.Volume,
			});

			playing = sound;
		};

		const updateSound = (volume: number, currentThrust: number, previousThrust: number) => {
			const changed = currentThrust !== previousThrust;
			// update volume
			for (const s of soundStageArray) s.Volume = volume;

			if (!changed) return;
			this.soundEffect.send(this.instance.PrimaryPart!, {
				sound: iSound,
				isPlaying: true,
				volume: volume,
			});

			if (currentThrust > previousThrust) return stopOtherSoundAndPlayNewOne(stSound);
			return stopOtherSoundAndPlayNewOne(shSound);
		};

		// RelativeTo = Attachment0, force on X — so its world RightVector is the intake/exhaust axis.
		const thrustAxis = this.vectorForce.Attachment0;
		let lastForce = -1;

		const updateForce = (modifier: number) => {
			const density = Physics.GetAirDensityModifierOnHeight(
				Physics.LocalHeight.fromGlobal(this.instance.GetPivot().Y),
			);

			let intake = 1;
			if (thrustAxis && modifier > 0) {
				const axis = thrustAxis.WorldCFrame.RightVector;
				const velocity = body.AssemblyLinearVelocity;
				const speed = velocity.Magnitude;

				// F = [ṁV]e − [ṁV]0 over static, ṁ = ρAV. Civil / military:
				// - M0.0 — 1.00 / 1.00
				// - M0.4 — 1.13 / 1.31 (civil peak)
				// - M1.1 — 0.71 / 1.56 (military peak)
				// - M1.5 — 0.00 / 1.48
				// - M2.9 — 0.00 / 0.00
				const forward = math.max(0, axis.Dot(velocity));
				const reach = math.clamp(forward / this.exhaustSpeed, 0, 1);
				const ram = (1 + profile.ramGain * reach) * (1 - reach);

				// Compressor share 1/(1+g·reach) ignores heading; the rammed share does not. 90° floor,
				// civil / military:
				// - M0.0 — 1.00 / 1.00
				// - M0.5 — 0.60 / 0.59
				// - M1.0 — 0.43 / 0.42
				// - M2.0 — 0.33 / 0.27
				const alignment = speed > 0 ? math.max(0, axis.Dot(velocity.div(speed))) : 1;
				const drawn = 1 / (1 + profile.ramGain * math.min(1, speed / this.exhaustSpeed));

				intake = ram * (drawn + (1 - drawn) * alignment);
			}

			const force = this.maxPower * modifier * density * intake;
			// Writing the property crosses into the engine, so an unchanged force is not worth re-sending.
			if (math.abs(force - lastForce) < FORCE_EPSILON) return;

			lastForce = force;
			this.vectorForce.Force = new Vector3(force);
		};

		let lastThrust = 0;
		let thrustPercent = 0;
		let strengthPercent = 0;
		this.onAlwaysInputs(({ thrust, strength }) => {
			//nan check
			if (typeIs(thrust, "number") && thrust !== thrust) return;

			//the code
			thrustPercent = thrust / 100;
			strengthPercent = strength / 100;

			updateSound(thrustPercent * maxSoundVolume, thrust, lastThrust);

			lastThrust = thrust;
		});

		// Speed and heading move without any input changing, so the force is recomputed every physics step
		// rather than only when the throttle does.
		this.event.subscribe(RunService.PostSimulation, () => updateForce(thrustPercent * strengthPercent));

		let rotationAccumulator = 0;
		const bladeLocation = body.BladeLocation;
		this.event.subscribe(RunService.PreRender, (dt) => {
			const spin = math.deg((thrust.tryGet() ?? 0) * dt);
			if (spin === 0) return;

			rotationAccumulator = (rotationAccumulator + spin) % 360;
			// X and Y follow the vehicle's own rotation, so only the spin axis may be overwritten
			const orn = bladeLocation.Orientation;
			bladeLocation.Orientation = new Vector3(orn.X, orn.Y, rotationAccumulator);
		});

		this.onDisable(() => {
			updateForce(0);
			updateSound(0, 0, 0);
			playing.Stop();
		});
	}
}

@injectable
class CivilJet extends Logic {
	constructor(block: InstanceBlockLogicArgs, @inject soundEffect: SoundEffect) {
		super(civilProfile, block, soundEffect);
	}
}

@injectable
class MilitaryJet extends Logic {
	constructor(block: InstanceBlockLogicArgs, @inject soundEffect: SoundEffect) {
		super(militaryProfile, block, soundEffect);
	}
}

const search = { partialAliases: ["turbine", "engine", "military", "civil", "engine", "afterburner"] };
const civilLogic: BlockLogicInfo = { definition, ctor: CivilJet };
const militaryLogic: BlockLogicInfo = { definition, ctor: MilitaryJet };
const list: BlockBuildersWithoutIdAndDefaults = {
	jetenginecivil: {
		limitFamily: "engine",
		displayName: "Civil Jet Engine",
		description: "Engines your jet or whatever",
		logic: civilLogic,
		search,
	},
	jetenginemilitaryold: {
		limitFamily: "engine",
		displayName: "Military Jet Engine (Old Model)",
		description: "Long live military jet engine! ",
		hidden: true,
		logic: militaryLogic,
		search,
	},
	jetenginemilitary: {
		limitFamily: "engine",
		displayName: "Military Jet Engine",
		description: "Engines your jet or whatever (military grade)",
		logic: militaryLogic,
		search,
	},
};
export const JetEngineBlocks = BlockCreation.arrayFromObject(list);
