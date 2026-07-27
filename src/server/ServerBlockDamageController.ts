import { RunService, Workspace } from "@rbxts/services";
import { Materials } from "engine/shared/data/Materials";
import { HostedService } from "engine/shared/di/HostedService";
import { ArgsSignal } from "engine/shared/event/Signal";
import { BlockManager } from "shared/building/BlockManager";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { Physics } from "shared/Physics";
import { RemoteEvents } from "shared/RemoteEvents";
import { CustomRemotes } from "shared/Remotes";
import { TagUtils } from "shared/utils/TagUtils";
import type { damageType } from "engine/shared/BlockDamageController";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { HeatGlowEffect } from "shared/effects/HeatGlowEffect";
import type { SparksEffect } from "shared/effects/SparksEffect";

type health = number;

// Fallbacks when the owner's settings can't be read (match PlayerConfigDefinition defaults).
const DEFAULT_BLOCK_STRENGTH = 1100;
const DEFAULT_MIN_DAMAGE_PERCENT = 15;

const testYourLuck = (chance: number): boolean => math.random() < chance;

/** Min impact speed (studs/s) that generates heat. */
const MIN_IMPACT_HEAT_SPEED = 500;
/** Heat per impact unit; divided by material strength so lighter materials heat more. */
const IMPACT_HEAT_FACTOR = 0.0005;
/** Heat constants are tuned per-tick at 60 Hz; `dt * REFERENCE_FPS` makes them frame-rate independent. */
const REFERENCE_FPS = 60;
/** Re-send glow only when intensity moves this much (the client interpolates between). */
const GLOW_STEP = 0.12;
/** Radiative emissivity coefficient; provides a cooling floor in vacuum independent of air pressure. */
const RADIATION_EMISSIVITY = 0.02;
/** Heat below this is negligible ambient residue; drop from tracking to avoid infinite Newton tail. */
const HEAT_FLOOR = 0.001;
/** Burning blocks processed per tick — caps work so a big fire doesn't scan every block each frame. */
const BURN_BATCH = 25;
/** Fire HP damage per second to a burning block (placeholder; tune later). */
const FIRE_DPS = 25;
/** How long a block burns before the fire dies out — keep in sync with FireEffect.NATURAL_FADE_SEC. */
const BURN_DURATION = 25;
/** Heat/sec a burning block radiates to neighbours (×falloff); must beat their cooling to ignite them. */
const RADIATION_HEAT_PER_SEC = 3;
/** Radius (studs) a burning block radiates heat within; linear falloff to the edge. */
const RADIATION_RADIUS = 6;

/** Reused across radiation scans to avoid a per-tick OverlapParams allocation. */
const radiationOverlapParams = new OverlapParams();
radiationOverlapParams.CollisionGroup = "Blocks";

/**
 * What the damage/fire core reads from anything that can burn or break. Blocks are the first implementer;
 * player limbs will be the second (see docs/PLAYER_MORTALITY.md), so the core reads through this instead of
 * hard-coding Instance. Getters read live, so a value never goes stale between resolves.
 */
interface Damageable {
	primaryPart(): BasePart | undefined;
	size(): Vector3;
	material(): Enum.Material;
	ownerId(): number | undefined;
	/** Block id for per-block physics tuning; undefined for a non-block. */
	id(): string | undefined;
	/** Head/HRP on a character; always false for a block. */
	readonly isVital: boolean;
	/** BaseParts to set alight — a block's are all its parts but the PrimaryPart. */
	ignitableParts(): BasePart[];
	/** Break it — a block queues its parts onto the ImpactBreak queue. */
	break(queue: BasePart[]): void;
	/** Announce destruction to clients — a block fires the broken remote (limbs handle their own death). */
	broadcastBroken(): void;
}

/** Damageable backed by a placed block; every method delegates to the same BlockManager call it replaced. */
class BlockDamageable implements Damageable {
	readonly isVital = false;
	constructor(private readonly block: BlockModel) {}

	primaryPart(): BasePart | undefined {
		return this.block.PrimaryPart;
	}
	size(): Vector3 {
		return BlockManager.manager.scale.get(this.block) ?? Vector3.one;
	}
	material(): Enum.Material {
		return BlockManager.manager.material.get(this.block);
	}
	ownerId(): number | undefined {
		// block -> Blocks folder -> plot model, which carries the owner id attribute.
		return this.block.Parent?.Parent?.GetAttribute("ownerid") as number | undefined;
	}
	id(): string | undefined {
		return BlockManager.manager.id.get(this.block);
	}
	ignitableParts(): BasePart[] {
		return this.block
			.GetDescendants()
			.filter((v): v is BasePart => v.IsA("BasePart") && v !== this.block.PrimaryPart);
	}
	break(queue: BasePart[]): void {
		for (const p of this.block.GetDescendants()) {
			if (p.IsA("BasePart") || p.IsA("UnionOperation") || p.IsA("MeshPart")) queue.push(p);
		}
	}
	broadcastBroken(): void {
		CustomRemotes.damageSystem.broken.send("everyone", this.block);
	}
}

/**
 * Server-authoritative block health. Clients send (batched) damage requests; the server owns HP,
 * decides breaks, drives ignition/sparks, and broadcasts breaks back (so clients can react, e.g. TNT
 * chains). HP is initialised lazily on first damage from the owner's physics settings.
 */
@injectable
export class ServerBlockDamageController extends HostedService {
	private readonly health = new Map<Instance, health>();
	private readonly maxHealth = new Map<Instance, health>();
	private readonly materialProperties = new Map<Instance, PhysicalProperties>();
	/** The owner's spark/forced-break threshold (fraction of HP), captured at init. */
	private readonly minDamageModifier = new Map<Instance, number>();
	private readonly impactHeatStrength = new Map<Instance, number>();
	private readonly hasHeatGlow = new Map<Instance, boolean>();
	/** Material's resistance to thermal damage (0–1); scales incoming heatDamage down, captured at init. */
	private readonly thermalResilience = new Map<Instance, number>();
	private readonly blockHeat = new Map<Instance, number>();
	/** Last glow intensity broadcast per block — drives the GLOW_STEP change gate. */
	private readonly lastGlowIntensity = new Map<Instance, number>();
	/** Blocks on fire and their burn state; SpreadingFireController feeds this via markBurning. */
	private readonly burningState = new Map<Instance, { startTime: number; lastTime: number }>();
	/** Parallel iteration order for round-robin batching of the burning set. */
	private readonly burningOrder: Instance[] = [];
	/** A block finished its burn but survived (HP left). SpreadingFireController clears its fire tag so it can reignite later. */
	readonly blockBurnedOut = new ArgsSignal<[Instance]>();
	private burnCursor = 0;
	/** Reused per radiation scan to dedupe multi-part blocks without a per-call Set allocation. */
	private readonly radiationSeen = new Set<Instance>();
	private breakQueue: BasePart[] = [];
	/** Memoized Damageable adapter per target, so the wrapper isn't reallocated per tick. */
	private readonly damageables = new Map<Instance, Damageable>();

	constructor(
		@inject private readonly sparksEffect: SparksEffect,
		@inject private readonly heatGlowEffect: HeatGlowEffect,
		@inject private readonly blockList: BlockList,
		@inject private readonly playerDatabase: PlayerDatabase,
	) {
		super();

		this.event.subscribe(CustomRemotes.damageSystem.damage.invoked, (player, batch) => {
			for (const entry of batch) this.applyDamage(entry.block, entry.damage, player);
		});

		this.event.subscribe(RunService.PostSimulation, (dt) => this.tick(dt));
	}

	/**
	 * The Damageable view of a target, memoized so the adapter isn't reallocated per tick. Limbs will
	 * pre-register their own LimbDamageable, so this lazy fallback only ever fires for a real block — hence the cast.
	 */
	private damageableOf(block: Instance): Damageable {
		return this.damageables.getOrSet(block, () => new BlockDamageable(block as BlockModel));
	}

	/** Material flammability (0 = never), Default-backed. Must be a block to burn*/
	getIgnitionChanceOf = (block: Instance): number => {
		const matData = Materials.Properties[this.damageableOf(block).material().Name]?.thermalProperties;
		const baseChance = matData?.ignitionChance ?? Materials.Properties.Default.thermalProperties!.ignitionChance!;
		return baseChance * (1 - (matData?.thermalResilience ?? 0));
	};

	private tick(dt: number) {
		// Scale per-tick rates by elapsed frames so they don't drift with the server frame rate.
		const frames = dt * REFERENCE_FPS;
		const defaultThermal = Materials.Properties.Default.thermalProperties!;
		const cooled: Instance[] = [];

		for (const [block, heat] of this.blockHeat) {
			const properties = this.materialProperties.get(block);
			if (heat <= 0 || !properties) {
				cooled.push(block);
				continue;
			}

			const matData = Materials.Properties[this.damageableOf(block).material().Name]?.thermalProperties;
			const conductivity = matData?.conductivity ?? defaultThermal.conductivity!;
			const mass = this.thermalMass(block, properties);
			const coolCoeff = this.coolingRate(block, conductivity, mass);
			// Newton's Law: rate ∝ current heat — hotter blocks cool faster toward ambient (20°C).
			const newHeat = heat * math.max(1 - coolCoeff * frames, 0);

			if (newHeat <= HEAT_FLOOR) {
				this.fadeGlow(block, coolCoeff > 0 ? 1 / (coolCoeff * REFERENCE_FPS) : 0);
				cooled.push(block);
				continue;
			}

			// Ignite once heat exceeds thermal mass.
			if (newHeat >= mass) {
				const ignitionChance = this.getIgnitionChanceOf(block);
				// Compound the per-frame chance over elapsed frames so a lag spike can't push it past certainty.
				if (testYourLuck(1 - (1 - ignitionChance) ** frames)) {
					this.fadeGlow(block, 0);
					cooled.push(block);
					if (!this.burningState.has(block))
						RemoteEvents.Burn.send(this.damageableOf(block).ignitableParts());
					continue;
				}
			}

			this.blockHeat.set(block, newHeat);
			this.updateGlow(block);
		}

		for (const block of cooled) this.blockHeat.delete(block);

		this.tickBurning();

		if (this.breakQueue.size() > 0) {
			// Server-originated ImpactBreak reuses the existing break + replicate path.
			RemoteEvents.ImpactBreak.send(this.breakQueue);
			this.breakQueue = [];
		}
	}

	/** A block caught fire — start draining its HP. Called by SpreadingFireController. */
	markBurning(block: Instance) {
		if (this.burningState.has(block)) return;
		const now = time();
		this.burningState.set(block, { startTime: now, lastTime: now });
		this.burningOrder.push(block);
	}

	/** Stop a block burning (extinguished, destroyed, or gone). */
	unmarkBurning(block: Instance) {
		if (!this.burningState.delete(block)) return;
		const index = this.burningOrder.indexOf(block);
		if (index >= 0) this.removeBurningAt(index);
	}

	private removeBurningAt(index: number) {
		const last = this.burningOrder.size() - 1;
		this.burningOrder[index] = this.burningOrder[last];
		this.burningOrder.pop();
	}

	/** Drain HP from a batch of burning blocks. Damage scales by each block's elapsed time, so the
	 * per-block burn rate is constant no matter how big the fire is. */
	private tickBurning() {
		const total = this.burningOrder.size();
		if (total === 0) return;

		const now = time();
		const batch = math.min(BURN_BATCH, total);
		for (let processed = 0; processed < batch; processed++) {
			if (this.burnCursor >= this.burningOrder.size()) this.burnCursor = 0;
			const block = this.burningOrder[this.burnCursor];

			if (this.burnBlock(block, now)) {
				this.burningState.delete(block);
				this.removeBurningAt(this.burnCursor); // swapped-in element lands here — don't advance
			} else {
				this.burnCursor++;
			}
		}
	}

	/** Apply one block's accumulated fire damage. Returns true when it should stop burning. */
	private burnBlock(block: Instance, now: number): boolean {
		const state = this.burningState.get(block);
		if (!state || !block.IsDescendantOf(Workspace)) return true;
		if (now - state.startTime >= BURN_DURATION) {
			this.blockBurnedOut.Fire(block);
			return true;
		}

		const elapsed = now - state.lastTime;
		state.lastTime = now;

		// Warm nearby blocks toward their own ignition threshold (radiative spread).
		this.radiateHeat(block, elapsed);

		const hp = this.health.get(block);
		if (hp === undefined || hp <= 0) return true;

		const newHp = hp - FIRE_DPS * elapsed;
		this.health.set(block, newHp);
		if (newHp <= 0) {
			this.damageableOf(block).broadcastBroken();
			this.forceBreakBlock(block);
			return true;
		}
		return false;
	}

	/** Heat nearby non-burning blocks toward ignition; `elapsed`-scaled so batching doesn't skew the total. */
	private radiateHeat(source: Instance, elapsed: number) {
		const pp = this.damageableOf(source).primaryPart();
		if (!pp) return;
		const origin = pp.Position;

		const seen = this.radiationSeen;
		seen.clear();
		seen.add(source);

		for (const part of Workspace.GetPartBoundsInRadius(origin, RADIATION_RADIUS, radiationOverlapParams)) {
			const block = BlockManager.tryGetBlockModelByPart(part);
			if (!block || seen.has(block)) continue;
			seen.add(block);
			// Already on fire — it's draining HP, not waiting to ignite.
			if (this.burningState.has(block)) continue;

			const pos = this.damageableOf(block).primaryPart()?.Position;
			if (!pos) continue;

			const falloff = 1 - origin.sub(pos).Magnitude / RADIATION_RADIUS;
			if (falloff <= 0) continue;
			this.applyDamage(block, { heatDamage: RADIATION_HEAT_PER_SEC * elapsed * falloff });
		}
	}

	/** Volume × density; bigger/denser blocks need more heat to glow / ignite. */
	private thermalMass(block: Instance, properties: PhysicalProperties): number {
		const scale = this.damageableOf(block).size();
		return scale.X * scale.Y * scale.Z * properties.Density;
	}

	/** Newton cooling coefficient (heat fraction lost per reference frame). Convection scales with air pressure; radiation provides a floor in vacuum. Divided by thermalMass so larger blocks cool slower (temperature drives loss, not raw heat). */
	private coolingRate(block: Instance, conductivity: number, thermalMass: number): number {
		const scale = this.damageableOf(block).size();
		const surfaceArea = (scale.X * scale.Y + scale.Y * scale.Z + scale.Z * scale.X) / 3;
		const height = Physics.LocalHeight.fromGlobal(
			this.damageableOf(block).primaryPart()?.Position.Y ?? GameDefinitions.HEIGHT_OFFSET,
		);
		const pressureFactor = Physics.GetAirDensityModifierOnHeight(height);
		return (surfaceArea * (conductivity * pressureFactor + RADIATION_EMISSIVITY)) / thermalMass;
	}

	/** Send glow intensity on a GLOW_STEP change (the client interpolates), but always saturate to full at the ignition threshold. */
	private updateGlow(block: Instance) {
		if (!this.hasHeatGlow.get(block)) return;
		const pp = this.damageableOf(block).primaryPart();
		const properties = this.materialProperties.get(block);
		if (!pp || !properties) return;

		// thermalMass is the ignition threshold, so intensity hits 1 exactly when the block can ignite.
		const intensity = math.clamp((this.blockHeat.get(block) ?? 0) / this.thermalMass(block, properties), 0, 1);
		const last = this.lastGlowIntensity.get(block) ?? 0;
		if (intensity === last) return;
		// Throttle intermediate steps, but never let the gate swallow the final jump to full glow.
		if (intensity < 1 && math.abs(intensity - last) < GLOW_STEP) return;

		this.lastGlowIntensity.set(block, intensity);
		// hasHeatGlow gates this above and is only ever set for blocks, so the target here is always a block.
		this.heatGlowEffect.send(pp, { block: block as BlockModel, intensity });
	}

	/** Fade the glow back to the original colour over `fadeTime` seconds. */
	private fadeGlow(block: Instance, fadeTime: number) {
		this.lastGlowIntensity.delete(block);
		if (!this.hasHeatGlow.get(block)) return;
		const pp = this.damageableOf(block).primaryPart();
		if (pp) this.heatGlowEffect.send(pp, { block: block as BlockModel, intensity: 0, fadeTime });
	}

	private ownerIdOf(block: Instance): number | undefined {
		return this.damageableOf(block).ownerId();
	}

	private ownerSettings(block: Instance): PlayerConfig | undefined {
		const ownerId = this.ownerIdOf(block);
		if (ownerId === undefined) return undefined;
		return this.playerDatabase.get(ownerId).settings as PlayerConfig | undefined;
	}

	/** PvP gate: own blocks always; another player's only if both have PvP on. No attacker = bypass. */
	private canDamage(block: Instance, attacker: Player | undefined): boolean {
		if (!attacker) return true;

		const ownerId = this.ownerIdOf(block);
		if (ownerId === undefined || ownerId === attacker.UserId) return true;

		const attackerPvp = this.playerDatabase.get(attacker.UserId).settings?.replication?.pvp ?? true;
		const ownerPvp = this.playerDatabase.get(ownerId).settings?.replication?.pvp ?? true;
		return attackerPvp && ownerPvp;
	}

	private initHealth(block: Instance): number | undefined {
		const pp = this.damageableOf(block).primaryPart();
		if (!pp) return undefined;

		const settings = this.ownerSettings(block);
		const blockStrength =
			settings?.environment?.physics?.impactDestruction?.blockHealthModifier ?? DEFAULT_BLOCK_STRENGTH;
		const minDamageModifier =
			(settings?.environment?.physics?.impactDestruction?.blockMinimalDamageThreshold ??
				DEFAULT_MIN_DAMAGE_PERCENT) / 100;

		const material = this.damageableOf(block).material();
		const properties = new PhysicalProperties(material);
		this.materialProperties.set(block, properties);
		block.DescendantRemoving.Once(() => this.forget(block));

		// Smallest axis (floored at 0.7) so giant sheets aren't absurdly tough nor tiny parts fragile.
		const sizeModifier = math.max(pp.Size.findMin(), 0.7);

		let blockHealth =
			blockStrength *
			properties.Density *
			(1 - properties.Elasticity) *
			properties.ElasticityWeight *
			sizeModifier;

		if (pp.HasTag(TagUtils.allTags.IMPACT_STRONG)) blockHealth *= 2;

		const blockID = this.damageableOf(block).id();
		const physicsConfig = blockID !== undefined ? this.blockList.blocks[blockID]?.physics : undefined;
		const impactStrengthModifier = physicsConfig?.impactDamageStrength ?? 1;
		const forcedThresholdModifier = math.max(physicsConfig?.impactDamageStrength ?? 0, minDamageModifier);

		const randomHealthPercentMultiplier = 0.15;
		blockHealth *=
			1 +
			(math.random(0, 100) / 100) *
				randomHealthPercentMultiplier *
				impactStrengthModifier *
				forcedThresholdModifier;

		this.health.set(block, blockHealth);
		this.maxHealth.set(block, blockHealth);
		this.minDamageModifier.set(block, minDamageModifier);
		this.impactHeatStrength.set(block, physicsConfig?.impactHeatStrength ?? 1);
		const thermal = Materials.Properties[material.Name]?.thermalProperties;
		const defaultThermal = Materials.Properties.Default.thermalProperties!;
		this.hasHeatGlow.set(block, thermal?.heatGlow ?? defaultThermal.heatGlow!);
		this.thermalResilience.set(
			block,
			math.clamp(thermal?.thermalResilience ?? defaultThermal.thermalResilience!, 0, 1),
		);
		return blockHealth;
	}

	private forget(block: Instance) {
		this.health.delete(block);
		this.maxHealth.delete(block);
		this.materialProperties.delete(block);
		this.minDamageModifier.delete(block);
		this.impactHeatStrength.delete(block);
		this.hasHeatGlow.delete(block);
		this.thermalResilience.delete(block);
		this.blockHeat.delete(block);
		this.lastGlowIntensity.delete(block);
		this.damageables.delete(block);
		this.unmarkBurning(block);
	}

	private forceBreakBlock(block: Instance) {
		this.damageableOf(block).break(this.breakQueue);
	}

	applyDamage(block: Instance, damage: damageType, attacker?: Player) {
		if (!block || !block.IsDescendantOf(Workspace)) return;
		if (!this.canDamage(block, attacker)) return;

		const { explosiveDamage = 0 } = damage;
		let { heatDamage = 0, impactDamage = 0 } = damage;

		// Lazy init on first damage using the owner's settings.
		let currentHealth = this.health.get(block);
		if (currentHealth === undefined) currentHealth = this.initHealth(block);
		if (currentHealth === undefined || currentHealth <= 0) return;

		// Thermal resilience softens incoming heat damage — both the HP hit and the heat that feeds ignition.
		heatDamage *= 1 - (this.thermalResilience.get(block) ?? 0);

		const pp = this.damageableOf(block).primaryPart();
		if (!pp) return;

		// A glancing impact (below the threshold) only throws sparks, no HP loss.
		const minMod = currentHealth * (this.minDamageModifier.get(block) ?? 0.05);
		if (impactDamage < minMod && impactDamage > minMod * 0.5) {
			this.sparksEffect.send(pp, { part: pp });
			impactDamage = 0;
		}

		const properties = this.materialProperties.get(block);
		const impactHeat =
			impactDamage >= MIN_IMPACT_HEAT_SPEED && properties
				? ((impactDamage * IMPACT_HEAT_FACTOR) / math.max(0.5, properties.Density / 3.5)) *
					(this.impactHeatStrength.get(block) ?? 1)
				: 0;

		const newHealth = currentHealth - (heatDamage + impactDamage + explosiveDamage);
		this.health.set(block, newHealth);

		const totalHeat = heatDamage + impactHeat;
		if (totalHeat > 0) {
			this.blockHeat.set(block, (this.blockHeat.get(block) ?? 0) + totalHeat);
			this.updateGlow(block);
		}

		if (newHealth <= 0) {
			this.damageableOf(block).broadcastBroken();
			this.forceBreakBlock(block);
			return;
		}

		// A surviving block can still be shaken off the assembly; chance scales with HP eaten (≤50%).
		if (explosiveDamage > 0) {
			const shakeChance = math.min(explosiveDamage / currentHealth, 1) * 0.5;
			if (testYourLuck(shakeChance)) this.forceBreakBlock(block);
		}
	}

	/**
	 * Explosive damage to every block within `radius`, quadratic falloff. Targets are snapshotted
	 * first so a chain reaction (a hit block detonating) can't mutate the set mid-iteration.
	 * `flammableHeat` (0 = none) feeds the ignition pipeline — distance-scaled, material-aware heat.
	 */
	applyRadialDamage(epicenter: Vector3, radius: number, pressure: number, flammableHeat = 0, attacker?: Player) {
		if (radius <= 0) return;

		const seen = new Set<Instance>();
		const targets: Array<{ block: Instance; distance: number }> = [];
		for (const part of Workspace.GetPartBoundsInRadius(epicenter, radius)) {
			const block = BlockManager.tryGetBlockModelByPart(part);
			if (!block || seen.has(block)) continue;
			seen.add(block);

			const pos = this.damageableOf(block).primaryPart()?.Position;
			if (!pos) continue;

			const distance = epicenter.sub(pos).Magnitude;
			if (distance > radius) continue;
			targets.push({ block, distance });
		}

		for (const { block, distance } of targets) {
			const falloff = 1 - distance / radius;
			this.applyDamage(
				block,
				{
					explosiveDamage: pressure * falloff * falloff,
					heatDamage: flammableHeat * falloff,
				},
				attacker,
			);
		}
	}
}
