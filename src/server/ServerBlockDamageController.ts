import { RunService, Workspace } from "@rbxts/services";
import { Materials } from "engine/shared/data/Materials";
import { HostedService } from "engine/shared/di/HostedService";
import { ArgsSignal } from "engine/shared/event/Signal";
import { BlockManager } from "shared/building/BlockManager";
import { PlayerConfigDefinition } from "shared/config/PlayerConfig";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { Physics } from "shared/Physics";
import { RemoteEvents } from "shared/RemoteEvents";
import { CustomRemotes } from "shared/Remotes";
import { TerrainDataInfo } from "shared/TerrainDataInfo";
import { TagUtils } from "shared/utils/TagUtils";
import type { BlockDamage } from "engine/shared/BlockDamageController";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { HeatGlowEffect } from "shared/effects/HeatGlowEffect";
import type { SparksEffect } from "shared/effects/SparksEffect";

type health = number;

// Fallbacks when the owner's settings can't be read (match PlayerConfigDefinition defaults).
const cfgImpact = PlayerConfigDefinition.environment.config.physics.impactDestruction;
const DEFAULT_BLOCK_STRENGTH = cfgImpact.blockHealthModifier;
const DEFAULT_MIN_DAMAGE_PERCENT = cfgImpact.blockMinimalDamageThreshold;

const testYourLuck = (chance: number): boolean => math.random() < chance;

/** Heat constants are tuned per-tick at 60 Hz; `dt * REFERENCE_FPS` makes them frame-rate independent. */

const Impact = {
	minSpeed: 500, // stud/s
	heatConversion: 0.0005, // multiplied by impact damage as heat
} as const;

const Fire = {
	dps: 7, // BlockHP/s
	duration: 25, // keep in sync with FireEffect.NATURAL_FADE_SEC
	batch: 25, // # sent per tick
} as const;

const Radiation = {
	heatPerSec: 2.5,
	radius: 6, // studs
	emissivity: 0.02, // minimum cooling
	floor: 0.001,
	glowThreshold: 0.12, // visual update is sent when diff passes this value
} as const;

const Ignition = {
	impulseFrames: 300, // heat landing at once: blasts, collisions, projectile hits
	breakFrames: 60, // necessary for impact breaks
	breakHeat: 3, // heat applied at epicenter, drops off with radius
	breakRadius: 4, // specifically for impact breaks
} as const;

const radiationOverlapParams = new OverlapParams();
radiationOverlapParams.CollisionGroup = "Blocks";

/**
 * Compatibility seam for a non-block in the block damage system
 */
export interface Damageable {
	primaryPart(): BasePart | undefined;
	size(): Vector3;
	material(): Enum.Material;
	ownerId(): number | undefined;
	id(): string | undefined;
	readonly isVital: boolean; // head/torso
	ignitableParts(): BasePart[];
	break(queue: BasePart[]): void;
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
	// once-init values for faster indexing
	private readonly damageables = new Map<Instance, Damageable>();
	private readonly maxHealth = new Map<Instance, health>();
	private readonly materialProperties = new Map<Instance, PhysicalProperties>();
	private readonly minDamageModifier = new Map<Instance, number>();
	private readonly impactHeatStrength = new Map<Instance, number>();
	private readonly hasHeatGlow = new Map<Instance, boolean>();
	private readonly thermalResilience = new Map<Instance, number>();

	// don't change
	private readonly health = new Map<Instance, health>();
	private readonly blockHeat = new Map<Instance, number>();
	private readonly lastGlowIntensity = new Map<Instance, number>(); // prevent visual replication overload
	private readonly burningState = new Map<Instance, { startTime: number; lastTime: number }>();
	private readonly burningOrder: Instance[] = []; // stores iteration order for burningState
	private burnCursor = 0;
	private breakQueue: BasePart[] = [];
	private scatteringBreakHeat = false; // prevent fire chaining on block break

	private readonly checked = new Set<Instance>();

	readonly blockBurnedOut = new ArgsSignal<[Instance]>(); // remove Burn tag if didn't get destroyed

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

	/** Returns the Damageable object corresponding to this Instance */
	private damageableOf(block: Instance): Damageable {
		return this.damageables.getOrSet(block, () => new BlockDamageable(block as BlockModel));
	}

	getHealth(instance: Instance): number | undefined {
		return this.health.get(instance);
	}
	getMaxHealth(instance: Instance): number | undefined {
		return this.maxHealth.get(instance);
	}

	/**
	 * Restore HP toward maxHealth — full when `amount` is omitted
	 * @remark Broken connections are not repaired.
	 */
	heal(instance: Instance, amount?: number) {
		const max = this.maxHealth.get(instance);
		if (max === undefined) return;
		const current = this.health.get(instance) ?? 0;
		if (current >= max) return;
		this.health.set(instance, amount === undefined ? max : math.min(current + amount, max));
	}

	/**
	 * Unlike a block there cannot be a DescendantRemoving hook
	 * The caller owns the lifecycle and must call {@link unregister}.
	 */
	registerDamageable(instance: Instance, damageable: Damageable, health: number) {
		this.damageables.set(instance, damageable);
		this.health.set(instance, health);
		this.maxHealth.set(instance, health);
		const material = damageable.material();
		this.materialProperties.set(instance, new PhysicalProperties(material));
		this.minDamageModifier.set(instance, DEFAULT_MIN_DAMAGE_PERCENT / 100);
		this.impactHeatStrength.set(instance, 1);
		this.hasHeatGlow.set(instance, false);
		const thermal = Materials.Properties[material.Name]?.thermalProperties;
		const defaultThermal = Materials.Properties.Default.thermalProperties!;
		this.thermalResilience.set(
			instance,
			math.clamp(thermal?.thermalResilience ?? defaultThermal.thermalResilience!, 0, 1),
		);
	}

	unregister(instance: Instance) {
		this.forget(instance);
	}

	/** Resolve a swept part to its damageable target: a block's model, or a registered limb (itself). */
	private targetForPart(part: BasePart): Instance | undefined {
		const block = BlockManager.tryGetBlockModelByPart(part);
		if (block) return block;
		return this.damageables.has(part) ? part : undefined;
	}

	getIgnitionChanceOf = (block: Instance): number => {
		const matData = Materials.Properties[this.damageableOf(block).material().Name]?.thermalProperties;
		const baseChance = matData?.ignitionChance ?? Materials.Properties.Default.thermalProperties!.ignitionChance!;
		return baseChance * (1 - (matData?.thermalResilience ?? 0));
	};

	private tick(dt: number) {
		const frames = dt * GameDefinitions.REFERENCE_FPS;
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

			if (newHeat <= Radiation.floor) {
				this.fadeGlow(block, coolCoeff > 0 ? 1 / (coolCoeff * GameDefinitions.REFERENCE_FPS) : 0);
				cooled.push(block);
				continue;
			}

			// Ignite once heat exceeds thermal mass.
			if (newHeat >= mass && !this.isSubmerged(block)) {
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
		const batch = math.min(Fire.batch, total);
		for (let processed = 0; processed < batch; processed++) {
			if (this.burnCursor >= this.burningOrder.size()) this.burnCursor = 0;
			const block = this.burningOrder[this.burnCursor];

			if (this.burnBlock(block, now)) {
				this.burningState.delete(block);
				this.removeBurningAt(this.burnCursor); // swapped-in element lands here — don't advance
				// Every way a fire ends has to clear the Burn tag, not only the full-duration one: burning to
				// death or off the map left the tag set, and a tagged part goes on igniting whatever touches it.
				this.blockBurnedOut.Fire(block);
			} else {
				this.burnCursor++;
			}
		}
	}

	/** Apply one block's accumulated fire damage. Returns true when it should stop burning. */
	private burnBlock(block: Instance, now: number): boolean {
		const state = this.burningState.get(block);
		if (!state || !block.IsDescendantOf(Workspace)) return true;
		if (this.isSubmerged(block)) return true;
		if (now - state.startTime >= Fire.duration) return true;

		const elapsed = now - state.lastTime;
		state.lastTime = now;

		// Warm nearby blocks toward their own ignition threshold (radiative spread).
		this.radiateHeat(block, elapsed);

		const hp = this.health.get(block);
		if (hp === undefined || hp <= 0) return true;

		const newHp = hp - Fire.dps * elapsed;
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

		const checked = this.checked;
		checked.clear();
		checked.add(source); // never radiate back into the block that is burning

		for (const part of Workspace.GetPartBoundsInRadius(origin, Radiation.radius, radiationOverlapParams)) {
			const block = BlockManager.tryGetBlockModelByPart(part);
			if (!block || checked.has(block)) continue;
			checked.add(block);
			// Already on fire — it's draining HP, not waiting to ignite.
			if (this.burningState.has(block)) continue;

			const pos = this.damageableOf(block).primaryPart()?.Position;
			if (!pos) continue;

			const falloff = 1 - origin.sub(pos).Magnitude / Radiation.radius;
			if (falloff <= 0) continue;
			this.applyDamage(block, { heatDamage: Radiation.heatPerSec * elapsed * falloff });
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
		return (surfaceArea * (conductivity * pressureFactor + Radiation.emissivity)) / thermalMass;
	}

	/** Send glow intensity on a Radiation.glowThreshold change (the client interpolates), but always saturate to full at the ignition threshold. */
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
		if (intensity < 1 && math.abs(intensity - last) < Radiation.glowThreshold) return;

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

	/** Remove an instance from the Damage system*/
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

	private isSubmerged(block: Instance): boolean {
		const pp = this.damageableOf(block).primaryPart();
		return pp !== undefined && pp.Position.Y <= TerrainDataInfo.waterLevel;
	}

	/**
	 * Ignite from heat that lands in one go
	 * It cools back under the threshold within a few frames, too fast to wait on the per-frame roll,
	 * so it takes a single roll weighted by `exposureFrames` instead.
	 */
	private igniteIfOverThreshold(block: Instance, exposureFrames: number) {
		if (this.isSubmerged(block)) return;
		if (this.burningState.has(block)) return;
		const chance = this.getIgnitionChanceOf(block);
		if (chance <= 0) return;
		const properties = this.materialProperties.get(block);
		const heat = this.blockHeat.get(block);
		if (!properties || heat === undefined) return;
		if (heat < this.thermalMass(block, properties)) return;
		if (!testYourLuck(1 - (1 - chance) ** exposureFrames)) return;

		this.blockHeat.delete(block);
		this.fadeGlow(block, 0);
		RemoteEvents.Burn.send(this.damageableOf(block).ignitableParts());
	}

	private forceBreakBlock(block: Instance) {
		if (!this.scatteringBreakHeat) {
			const pp = this.damageableOf(block).primaryPart();
			if (pp) {
				this.scatteringBreakHeat = true;
				this.applyRadialDamage(
					pp.Position,
					Ignition.breakRadius,
					0,
					Ignition.breakHeat,
					undefined,
					Ignition.breakFrames,
				);
				this.scatteringBreakHeat = false;
			}
		}

		this.damageableOf(block).break(this.breakQueue);
	}

	applyDamage(block: Instance, damage: BlockDamage, attacker?: Player) {
		if (!block || !block.IsDescendantOf(Workspace)) return;
		if (block.IsA("BasePart") && !this.damageables.has(block)) return;
		if (!this.canDamage(block, attacker)) return;

		const { explosiveDamage = 0 } = damage;
		let { heatDamage = 0, impactDamage = 0 } = damage;

		// Lazy init on first damage using the owner's settings.
		let currentHealth = this.health.get(block);
		if (currentHealth === undefined) currentHealth = this.initHealth(block);
		if (currentHealth === undefined || currentHealth <= 0) return;

		heatDamage *= 1 - (this.thermalResilience.get(block) ?? 0);

		const pp = this.damageableOf(block).primaryPart();
		if (!pp) return;

		// Sparks only
		const minMod = currentHealth * (this.minDamageModifier.get(block) ?? 0.05);
		if (impactDamage < minMod && impactDamage > minMod * 0.5) {
			this.sparksEffect.send(pp, { part: pp });
			impactDamage = 0;
		}

		const properties = this.materialProperties.get(block);
		const converted = impactDamage * Impact.heatConversion;
		const heatStrength = this.impactHeatStrength.get(block) ?? 1;
		const impactHeat =
			impactDamage >= Impact.minSpeed && properties
				? (converted / math.max(0.5, properties.Density / 3.5)) * heatStrength
				: 0;

		const newHealth = currentHealth - (heatDamage + impactDamage + explosiveDamage);
		this.health.set(block, newHealth);

		const totalHeat = heatDamage + impactHeat;
		if (totalHeat > 0) {
			this.blockHeat.set(block, (this.blockHeat.get(block) ?? 0) + totalHeat);
			this.updateGlow(block);
		}

		if (impactHeat > 0 || (damage.impulseHeat === true && heatDamage > 0)) {
			this.igniteIfOverThreshold(block, Ignition.impulseFrames);
		}

		if (newHealth <= 0) {
			this.damageableOf(block).broadcastBroken();
			this.forceBreakBlock(block);
			return;
		}

		if (explosiveDamage > 0) {
			const shakeChance = math.min(explosiveDamage / currentHealth, 1) * 0.5;
			if (testYourLuck(shakeChance)) this.forceBreakBlock(block);
		}
	}

	/**
	 * Applies `explosive` damage with quadratic dropoff
	 * Optional `heat` with linear dropoff
	 */
	applyRadialDamage(
		epicenter: Vector3,
		radius: number,
		pressure: number,
		flammableHeat = 0,
		attacker?: Player,
		exposureFrames: number = Ignition.impulseFrames,
	) {
		if (radius <= 0) return;

		const checked = new Set<Instance>();
		const targets: Array<{ block: Instance; distance: number }> = [];
		for (const part of Workspace.GetPartBoundsInRadius(epicenter, radius)) {
			const block = this.targetForPart(part);
			if (!block || checked.has(block)) continue;
			checked.add(block);

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

			if (flammableHeat > 0) this.igniteIfOverThreshold(block, exposureFrames);
		}
	}
}
