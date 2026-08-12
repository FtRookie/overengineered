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
	// a gate, not a level: >0 means the cone is up
	readonly intensity: number;
	// Mach half-angle (deg) off the trailing axis
	readonly spread: number;
};

// transonic range
const MACH_MIN = 0.85;
const MACH_PEAK = 1;
const MACH_MAX = 1.15;

/** step below which the band is treated as over */
const INTENSITY_STEP = 0.1;
const COLLAR_RECHECK = 0.5; // seconds between host-block searches
/** degrees the half-angle must move to be worth another remote */
const SPREAD_STEP = 2;
/** quantized 90°: the normal-shock disc every subsonic case falls back to */
const SPREAD_FLAT = 90 / SPREAD_STEP;
// restate a live cone this often even when unchanged, or a steady Mach sends nothing and the receiver
// can't tell a held cone from a silent owner
const KEEPALIVE = 2;
/** dropped after this long unheard; clears KEEPALIVE enough to ride out loss and latency */
const CONE_TTL = 6;

// Prandtl-Glauert condensation cloud on the block the collar wraps. Reliable not unreliable: the state is
// sticky, and a dropped teardown leaves a cone welded on forever
@injectable
export class VaporConeEffect extends EffectBase<Args> {
	private readonly template = ReplicatedStorage.Assets.Effects.VaporCone;
	private readonly cones = new Map<BasePart, { readonly emitter: ParticleEmitter; expiresAt: number }>();
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
		let nextKeepalive = 0;

		RunService.PreRender.Connect(() => {
			// every client sweeps, sender or not: the only teardown not gated on the owner's stop arriving, so
			// it catches a filtered recipient or an owner who left
			this.sweep();

			this.playerInfo ??= this.di.tryResolve<PlayerInfo>();
			const head = this.playerInfo?.head.get();
			// gate the step, not the whole pass, so switching off mid-flight tears down through the same
			// release path as leaving the band
			this.playerData ??= this.di.tryResolve<PlayerDataStorage>();
			const on = this.playerData?.config.get().graphics.vaporCones ?? true;

			let step = 0;
			let spreadStep = SPREAD_FLAT;
			if (head && on) {
				// read here and sent as spread, not left for the observer to derive: AssemblyLinearVelocity is NotReplicated, an observer reads it as zero
				const mach = head.AssemblyLinearVelocity.Magnitude / GameDefinitions.SPEED_OF_SOUND;
				if (mach > MACH_MIN && mach < MACH_MAX) {
					// sin μ = c/V off the trailing axis, the angle coneMask tests. Below Mach 1 there is no
					// conical solution — the shock is normal, a flat 90° disc
					spreadStep = mach <= 1 ? SPREAD_FLAT : math.round(math.deg(math.asin(1 / mach)) / SPREAD_STEP);
					const ramp =
						mach < MACH_PEAK
							? (mach - MACH_MIN) / (MACH_PEAK - MACH_MIN)
							: (MACH_MAX - mach) / (MACH_MAX - MACH_PEAK);
					// thin air carries no water to condense, so the cloud thins with it
					const density = Physics.GetAirDensityModifierOnHeight(
						Physics.LocalHeight.fromGlobal(head.Position.Y),
					);
					step = math.round((ramp * density) / INTENSITY_STEP);
				}
			}

			if (!head || step === 0) {
				if (!host) return;

				// sent even for an already-gone part: the normal despawn case, else observers keep the cone
				this.send(host, { part: host, intensity: 0, spread: 0 });
				host = undefined;
				sentSpread = -1;
				return;
			}

			const now = time();
			if (host === undefined || host.Parent === undefined || now >= nextSearch) {
				nextSearch = now + COLLAR_RECHECK;

				const collar = this.findCollar(head);
				if (collar !== host) {
					if (host) this.send(host, { part: host, intensity: 0, spread: 0 });
					host = collar;
					sentSpread = -1;
				}
			}

			if (!host) return;
			if (spreadStep === sentSpread && now < nextKeepalive) return;

			sentSpread = spreadStep;
			nextKeepalive = now + KEEPALIVE;
			this.send(host, {
				part: host,
				intensity: step * INTENSITY_STEP,
				spread: spreadStep * SPREAD_STEP,
			});
		});
	}

	override justRun({ part, intensity, spread }: Args): void {
		if (!RunService.IsClient()) return;
		if (!part) return;

		// ahead of the parent check: plot teardown unparents blocks a second before destroying them, and a
		// stop inside that second must still land
		if (intensity <= 0) {
			this.remove(part);
			return;
		}

		if (part.Parent === undefined) return;

		const cone = this.ensureCone(part);
		cone.expiresAt = time() + CONE_TTL;
		// per message, not per frame: the angle only moves as the craft crosses the band, and the sender only
		// sends once it moved enough to see
		cone.emitter.SpreadAngle = new Vector2(spread, spread);
	}

	/** reap cones whose owner stopped restating them — went quiet, left, or was filtered out */
	private sweep(): void {
		const now = time();
		for (const [part, cone] of this.cones) {
			if (now < cone.expiresAt) continue;
			this.remove(part);
		}
	}

	/** the block nearest the craft's middle along travel, where the collar stalls */
	private findCollar(head: BasePart): BasePart | undefined {
		this.plot ??= this.di.tryResolve<SharedPlot>();
		const blocks = this.plot?.getBlocks();
		if (!blocks) return undefined;

		const root = head.AssemblyRootPart;
		const forward = head.AssemblyLinearVelocity.Unit;
		// centre of mass, not the bounding midpoint: mass gathers at the fuselage/wing root, and it is one read
		// vs a second pass over every block
		const middle = head.AssemblyCenterOfMass.Dot(forward);

		let collar: BasePart | undefined;
		let nearest = math.huge;
		for (const model of blocks) {
			const part = model.PrimaryPart;
			// a broken-off piece is its own assembly, no longer this craft
			if (!part || part.AssemblyRootPart !== root) continue;

			const offset = math.abs(part.Position.Dot(forward) - middle);
			if (offset < nearest) {
				nearest = offset;
				collar = part;
			}
		}

		return collar;
	}

	private ensureCone(part: BasePart) {
		const existing = this.cones.get(part);
		if (existing) return existing;

		const emitter = this.template.Clone();
		emitter.Parent = part;

		const cone = { emitter, expiresAt: 0 };
		this.cones.set(part, cone);
		part.Destroying.Once(() => this.cones.delete(part));
		return cone;
	}

	private remove(part: BasePart): void {
		const cone = this.cones.get(part);
		if (!cone) return;

		this.cones.delete(part);
		// stop emitting but let airborne particles live out their lifetime, not blink the whole cloud away
		cone.emitter.Enabled = false;
		Debris.AddItem(cone.emitter, this.template.Lifetime.Max);
	}
}
