import { Debris, ReplicatedStorage, RunService } from "@rbxts/services";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { EffectBase } from "shared/effects/EffectBase";
import { Physics } from "shared/Physics";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { PlayerInfo } from "engine/shared/PlayerInfo";
import type { SharedPlot } from "shared/building/SharedPlot";
import type { EffectCreator } from "shared/effects/EffectBase";

type Args = {
	readonly part: BasePart;
	/** Read as a gate, not a level: anything above 0 means the cone is up. */
	readonly intensity: number;
	/** Mach half-angle in degrees, off the trailing axis. Sent rather than derived because
	 * AssemblyLinearVelocity is NotReplicated and an observer may read it as zero. */
	readonly spread: number;
};

// Transonic range
const MACH_MIN = 0.85;
const MACH_PEAK = 1;
const MACH_MAX = 1.15;

/** Where the band is treated as over. The receiver reads intensity as a gate, not as a level. */
const INTENSITY_STEP = 0.1;
const COLLAR_RECHECK = 0.5; // seconds between searches for the host block
/** Degrees the half-angle must move before it is worth another remote. */
const SPREAD_STEP = 2;
/** Quantized 90°, the normal-shock disc every subsonic case falls back to. */
const SPREAD_FLAT = 90 / SPREAD_STEP;

/**
 * The Prandtl-Glauert condensation cloud, on the block the collar wraps around. Reliable rather
 * than unreliable: the state is sticky, and a dropped teardown would leave a cone welded on forever.
 */
@injectable
export class VaporConeEffect extends EffectBase<Args> {
	private readonly template = ReplicatedStorage.Assets.Effects.VaporCone;
	private readonly cones = new Map<BasePart, ParticleEmitter>();
	private plot?: SharedPlot;
	private playerData?: PlayerDataStorage;
	private playerInfo?: PlayerInfo;

	constructor(
		@inject creator: EffectCreator,
		@inject private readonly di: DIContainer,
	) {
		super(creator, "vapor_cone_effect", "RemoteEvent");
		if (!RunService.IsClient()) return;

		let host: BasePart | undefined;
		let sentSpread = -1;
		let nextSearch = 0;
		let dbgStep = -1; //temp

		RunService.PreRender.Connect(() => {
			this.playerInfo ??= this.di.tryResolve<PlayerInfo>();
			const head = this.playerInfo?.head.get();
			// Gates the step rather than the whole pass, so switching it off mid-flight tears the cone down
			// through the same release path as dropping out of the band.
			this.playerData ??= this.di.tryResolve<PlayerDataStorage>();
			const on = this.playerData?.config.get().graphics.vaporCones ?? true;

			let step = 0;
			let spreadStep = SPREAD_FLAT;
			if (head && on) {
				const mach = head.AssemblyLinearVelocity.Magnitude / GameDefinitions.SPEED_OF_SOUND;
				if (mach > MACH_MIN && mach < MACH_MAX) {
					// sin μ = c/V, off the trailing axis — the same angle coneMask tests against. Below Mach 1
					// there is no conical solution because the shock across the airframe is a normal one, and
					// a flat 90° disc is what that looks like.
					spreadStep = mach <= 1 ? SPREAD_FLAT : math.round(math.deg(math.asin(1 / mach)) / SPREAD_STEP);
					const ramp =
						mach < MACH_PEAK
							? (mach - MACH_MIN) / (MACH_PEAK - MACH_MIN)
							: (MACH_MAX - mach) / (MACH_MAX - MACH_PEAK);
					// Thin air carries no water to condense, so the cloud thins out along with it.
					const density = Physics.GetAirDensityModifierOnHeight(
						Physics.LocalHeight.fromGlobal(head.Position.Y),
					);
					step = math.round((ramp * density) / INTENSITY_STEP);
				}
			}

			//temp
			if (step !== dbgStep) {
				dbgStep = step;
				const mach = head ? head.AssemblyLinearVelocity.Magnitude / GameDefinitions.SPEED_OF_SOUND : 0;
				print(`[vapor] step=${step} mach=${mach} head=${head !== undefined} on=${on}`);
			}

			if (!head || step === 0) {
				if (!host) return;

				if (host.Parent !== undefined) this.send(host, { part: host, intensity: 0, spread: 0 });
				host = undefined;
				sentSpread = -1;
				return;
			}

			const now = time();
			if (host === undefined || host.Parent === undefined || now >= nextSearch) {
				nextSearch = now + COLLAR_RECHECK;

				const collar = this.findCollar(head);
				print(`[vapor] collar=${collar?.GetFullName() ?? "none"} plot=${this.plot !== undefined}`); //temp
				if (collar !== host) {
					if (host && host.Parent !== undefined) {
						this.send(host, { part: host, intensity: 0, spread: 0 });
					}
					host = collar;
					sentSpread = -1;
				}
			}

			if (!host || spreadStep === sentSpread) return;
			sentSpread = spreadStep;
			this.send(host, {
				part: host,
				intensity: step * INTENSITY_STEP,
				spread: spreadStep * SPREAD_STEP,
			});
		});
	}

	override justRun({ part, intensity, spread }: Args): void {
		if (!RunService.IsClient()) return;
		if (!part || part.Parent === undefined) return;

		if (intensity <= 0) {
			this.remove(part);
			return;
		}

		// Written per message rather than per frame: the angle only moves as the craft crosses the band, and
		// the sender only sends once it has moved enough to see.
		this.ensureCone(part).SpreadAngle = new Vector2(spread, spread);
	}

	/** The block nearest the middle of the craft along the direction of travel, where the collar stalls. */
	private findCollar(head: BasePart): BasePart | undefined {
		this.plot ??= this.di.tryResolve<SharedPlot>();
		const blocks = this.plot?.getBlocks();
		if (!blocks) return undefined;

		const root = head.AssemblyRootPart;
		const forward = head.AssemblyLinearVelocity.Unit;
		// Centre of mass rather than the bounding midpoint: mass gathers at the fuselage and wing root, and
		// it costs one read where the midpoint costs a second pass over every block.
		const middle = head.AssemblyCenterOfMass.Dot(forward);

		let collar: BasePart | undefined;
		let nearest = math.huge;
		for (const model of blocks) {
			const part = model.PrimaryPart;
			// A piece that has broken off is its own assembly, and no longer this craft.
			if (!part || part.AssemblyRootPart !== root) continue;

			const offset = math.abs(part.Position.Dot(forward) - middle);
			if (offset < nearest) {
				nearest = offset;
				collar = part;
			}
		}

		return collar;
	}

	private ensureCone(part: BasePart): ParticleEmitter {
		const existing = this.cones.get(part);
		if (existing) return existing;

		const cone = this.template.Clone();
		cone.Parent = part;
		this.cones.set(part, cone);
		// The emitter dies with its parent, but the map entry would keep a destroyed part referenced.
		part.Destroying.Once(() => this.cones.delete(part));
		print(`[vapor] emitter parented to ${part.GetFullName()}`); //temp

		return cone;
	}

	private remove(part: BasePart): void {
		const cone = this.cones.get(part);
		if (!cone) return;

		this.cones.delete(part);
		// Stop emitting but let what is already in the air live out its lifetime, rather than blinking the
		// whole cloud away on the frame the craft leaves the band.
		cone.Enabled = false;
		Debris.AddItem(cone, this.template.Lifetime.Max);
	}
}
