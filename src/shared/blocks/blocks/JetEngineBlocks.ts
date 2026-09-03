import { RunService, Workspace } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { WingGeometry } from "shared/blocks/blocks/grouped/WingsBlocks";
import { BlockManager } from "shared/building/BlockManager";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { GameEnvironment } from "shared/data/GameEnvironment";
import { Physics } from "shared/Physics";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type {
	BlockLogicFullBothDefinitions,
	GenericBlockLogic,
	InstanceBlockLogicArgs,
} from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults, BlockLogicInfo } from "shared/blocks/Block";
import type { SoundEffect } from "shared/effects/SoundEffect";

/** Newtons. Below one part in 10^5 of a jet's output. */
const FORCE_EPSILON = 1;
/** Seconds between wash casts. Engine and wing are rigid to each other unless a servo moves one. */
const WASH_REFRESH = 0.1;
/** Panels one plume is walked through before it is called done. */
const WASH_MAX_PANELS = 10;
/** Below this share of the thrust still pointing down the nozzle, the plume is spent. */
const WASH_CUTOFF = 0.01;
/**
 * Share of the intercepted momentum that leaves as coherent redirected flow. Exhaust does not follow a panel
 * as willingly as a projection implies — most of what a deflector takes compresses and disperses, costing the
 * engine its thrust without pushing anything. The loss is the full geometric one either way; this only sets
 * how much of it turns. 0 makes a panel a pure airbrake, 1 a perfect vane.
 */
const WASH_TURN = 0.3;

const definition = {
	inputOrder: ["thrust", "strength", "deflectable"],
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
		deflectable: {
			displayName: "Deflectable",
			tooltip: "Placing wing panels behind the exhaust can redirect the thrust",
			types: {
				bool: {
					config: true,
				},
			},
			connectorHidden: true,
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

export type { Logic as JetBlockLogic };
abstract class Logic extends InstanceBlockLogic<typeof definition, JetModel> {
	// Instances
	private readonly vectorForce;

	// Math
	private readonly maxPower;
	private readonly exhaustSpeed;

	// Exhaust wash. Filtered to the machine's own wings, filled once the machine is known.
	private washParams?: RaycastParams;
	private washWings?: ReadonlyMap<BlockModel, GenericBlockLogic>;

	constructor(
		profile: EngineProfile,
		block: InstanceBlockLogicArgs,
		private readonly soundEffect: SoundEffect,
		private readonly blockList: BlockList,
	) {
		super(definition, block);

		let playerData: PlayerDataStorage | undefined;
		this.$onInjectAuto((data?: PlayerDataStorage) => (playerData = data));

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

		// Exhaust marks the nozzle exit plane. Only the military model carries one; without it the engine
		// keeps its undeflected thrust.
		const exhaust = this.instance.FindFirstChild("Exhaust") as BasePart | undefined;
		let washReach = 0;
		let washRadius = 0;
		let washPlumeArea = 0;
		if (exhaust) {
			const params = new RaycastParams();
			params.IgnoreWater = true;
			this.washParams = params;

			// X, not the mesh's long axis: TurbineBody is rotated inside the model, so it reads as Z-long
			// while the ColBox — and the nozzle plane the Exhaust sits on — put the engine's length on X.
			washReach = this.instance.ColBox.Size.X;
			washRadius = math.max(exhaust.Size.Y, exhaust.Size.Z) / 2;
			washPlumeArea = math.pi * washRadius * washRadius;
		}

		// rebuilt in place each pass: the engine, plus every panel already spent, so a concave stack cannot
		// deflect off the same wing twice
		const washSpent: Instance[] = [this.instance];

		// config-only, so it is read once and held rather than polled; false until it arrives
		let deflectable = false;
		this.onkFirstInputs(["deflectable"], (values) => (deflectable = values.deflectable));

		// force sits on the attachment's X, so (1, 0, 0) is undeflected thrust
		let wash = Vector3.xAxis;
		let lastWash = Vector3.xAxis;
		let washCheckedAt = 0;

		// Exhaust blowing onto the machine's own wing cannot push it — the wing pushes back just as hard and
		// the pair cancels. What the panels take is gone from the jet, so thrust drops by their share and
		// steers by whatever part of it stayed coherent.
		const updateWash = (world: CFrame, axis: Vector3) => {
			const params = this.washParams;
			if (!deflectable || !exhaust || !params) return;

			const now = time();
			if (now - washCheckedAt < WASH_REFRESH) return;
			washCheckedAt = now;
			wash = Vector3.xAxis;

			const wings = this.washWings;
			if (!wings || wings.isEmpty()) return;

			// Every panel bills the plume for the component normal to it, and those are summed rather than
			// folded in one at a time. Sequential projection depends on the order the casts happened to find
			// the panels, so a symmetric pair of vanes left a lateral remainder and yawed the machine.
			const exhaustDir = axis.mul(-1);
			const direction = exhaustDir.mul(washReach);
			let removed = Vector3.zero;

			table.clear(washSpent);
			washSpent.push(this.instance);

			for (let panel = 0; panel < WASH_MAX_PANELS; panel++) {
				params.ExcludeInstances = washSpent;

				// Same origin and heading every pass — only the spent panels are added to the filter, so each
				// cast reaches the next one back. A sphere the nozzle's width gives the plume its girth.
				const hit = Workspace.Spherecast(exhaust.Position, washRadius, direction, params);
				if (!hit) break;

				const model = BlockManager.tryGetBlockModelByPart(hit.Instance);
				if (!model) break;

				// a wing switched off by its config disables itself and stops making lift, so it is inert
				// geometry rather than a deflector
				if (wings.get(model)?.isEnabled() !== true) break;

				// The deflecting surface, not the contact point: a wing block is five parts, so the cast's
				// own normal is usually the ColBox face or an edge it clipped.
				const surface = model.FindFirstChild("WingSurface") as BasePart | undefined;
				if (!surface) break;

				// A panel narrower than the plume only intercepts its share of it. The angle is already
				// carried by the dot below, so this is the head-on area ratio and nothing more.
				const face = WingGeometry.face(surface);
				const coverage = math.min(1, face.area / washPlumeArea);
				removed = removed.add(face.normal.mul(exhaustDir.Dot(face.normal) * coverage));

				washSpent.push(model);
			}

			// Summing can overshoot where two panels face the same way, and with several the remainder can
			// point back up the nozzle — a stack that has taken all the forward momentum stops the plume
			// rather than reversing it.
			const surviving = exhaustDir.sub(removed);
			if (surviving.Dot(exhaustDir) < WASH_CUTOFF) {
				wash = Vector3.zero;
				return;
			}

			// Magnitude is the full loss: everything the panels took is gone from the jet either way. Only the
			// coherent share steers, so the heading turns by less than the geometry alone would give.
			const heading = exhaustDir.sub(removed.mul(WASH_TURN)).Unit;
			wash = world.VectorToObjectSpace(heading.mul(-surviving.Magnitude));
		};

		const updateForce = (modifier: number) => {
			const density = Physics.GetAirDensityModifierOnHeight(
				Physics.LocalHeight.fromGlobal(this.instance.GetPivot().Y),
				playerData?.config.get().environment.physics.airDensityMultiplier,
			);

			let intake = 1;
			if (thrustAxis && modifier > 0) {
				const world = thrustAxis.WorldCFrame;
				const axis = world.RightVector;
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

				updateWash(world, axis);
			}

			const force = this.maxPower * modifier * density * intake;
			// Writing the property crosses into the engine, so an unchanged force is not worth re-sending.
			if (math.abs(force - lastForce) < FORCE_EPSILON && wash === lastWash) return;

			lastForce = force;
			lastWash = wash;
			this.vectorForce.Force = wash.mul(force);
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

	initializeInputs(config: PlacedBlockConfig, allBlocks: ReadonlyMap<BlockUuid, GenericBlockLogic>): void {
		super.initializeInputs(config, allBlocks);

		const params = this.washParams;
		if (!params) return;

		// Own wings are the entire filter: a fuselage block sitting between the nozzle and the wing does not
		// stop the plume, and another machine's wing is a separate body whose reaction would not cancel.
		const wings = new Map<BlockModel, GenericBlockLogic>();
		const targets: Instance[] = [];
		for (const [, logic] of allBlocks) {
			const model = logic.instance;
			if (!model) continue;
			if (this.blockList.blocks[BlockManager.manager.id.get(model)]?.limitFamily !== "wing") continue;

			wings.set(model, logic);
			targets.push(model);
		}

		this.washWings = wings;
		params.IncludeInstances = targets;
	}
}

/** High-bypass fan (GE90). Power peak at M0.38, gone by M1.5. */
@injectable
class CivilJet extends Logic {
	constructor(block: InstanceBlockLogicArgs, @inject soundEffect: SoundEffect, @inject blockList: BlockList) {
		super(
			{
				thrustToWeight: 8, // temp power boost
				exhaustMach: 1.5,
				ramGain: 2,
			},
			block,
			soundEffect,
			blockList,
		);
	}
}

/** Reheated low-bypass turbofan (F135, 0.57:1). Power peak at M1.09, gone by M2.9. */
@injectable
class MilitaryJet extends Logic {
	constructor(block: InstanceBlockLogicArgs, @inject soundEffect: SoundEffect, @inject blockList: BlockList) {
		super(
			{
				thrustToWeight: 10.5,
				exhaustMach: 2.9,
				ramGain: 4,
			},
			block,
			soundEffect,
			blockList,
		);
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
