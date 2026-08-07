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
import type { PlayModeController } from "server/modes/PlayModeController";
import type { HeatGlowEffect } from "shared/effects/HeatGlowEffect";
import type { SparksEffect } from "shared/effects/SparksEffect";

type health = number;

// Fallbacks when the owner's settings can't be read (match PlayerConfigDefinition defaults).
const cfgImpact = PlayerConfigDefinition.environment.config.physics.impactDestruction;
const DEFAULT_BLOCK_STRENGTH = cfgImpact.blockHealthModifier;
const DEFAULT_MIN_DAMAGE_PERCENT = cfgImpact.blockMinimalDamageThreshold;

const testYourLuck = (chance: number): boolean => math.random() < chance;

const defaultThermal = Materials.Properties.Default.thermalProperties!;

/** Heat constants are tuned per-tick at 60 Hz; `elapsed * REFERENCE_FPS` makes them frame-rate independent. */

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
	heatPerSec: 5, // heat damage
	radius: 6, // studs per unit of sqrt(surface area)
	maxRadius: 24, // studs; one huge block should not sweep the map every tick
	minDistance: 0.5, // studs; floors the near field for very small sources
	emissivity: 0.02, // minimum cooling
	floor: 0.02, // fraction of thermal mass below which heat is dropped and the glow faded
	glowThreshold: 0.12, // visual update is sent when diff passes this value
} as const;

const Conduction = {
	heatPerSec: 10, // heat damage, per welded neighbour
} as const;

const Heat = {
	batch: 60, // # cooled per tick
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
	private readonly heatTime = new Map<Instance, number>(); // last visit, so batching can't skew cooling
	private readonly heatOrder: Instance[] = []; // stores iteration order for blockHeat
	private heatCursor = 0;
	private readonly lastGlowIntensity = new Map<Instance, number>(); // prevent visual replication overload
	private readonly burningState = new Map<Instance, { startTime: number; lastTime: number }>();
	private readonly burningOrder: Instance[] = []; // stores iteration order for burningState
	private burnCursor = 0;
	private breakQueue: BasePart[] = [];
	private suppressBreakHeat = false; // true while scattering break heat (chain guard) and during heatless blasts

	private readonly checked = new Set<Instance>();
	private readonly conducted = new Set<Instance>();
	private playMode?: PlayModeController;

	readonly blockBurnedOut = new ArgsSignal<[Instance]>(); // remove Burn tag if didn't get destroyed

	constructor(
		@inject private readonly sparksEffect: SparksEffect,
		@inject private readonly heatGlowEffect: HeatGlowEffect,
		@inject private readonly blockList: BlockList,
		@inject private readonly playerDatabase: PlayerDatabase,
		@inject private readonly di: DIContainer,
	) {
		super();

		this.event.subscribe(CustomRemotes.damageSystem.damage.invoked, (player, batch) => {
			for (const entry of batch) this.applyDamage(entry.block, entry.damage, player);
		});

		this.event.subscribe(RunService.PreSimulation, () => this.tick());
	}

	/** Returns the Damageable object corresponding to this Instance */
	private getDamageableOf(block: Instance): Damageable {
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
		this.thermalResilience.set(
			instance,
			math.clamp(thermal?.thermalResilience ?? defaultThermal.thermalResilience!, 0, 1),
		);
	}

	unregister(instance: Instance) {
		this.forget(instance);
	}

	/** Resolve a swept part to its damageable target: a block's model, or a registered limb (itself). */
	private getTargetForPart(part: BasePart): Instance | undefined {
		const block = BlockManager.tryGetBlockModelByPart(part);
		if (block) return block;
		return this.damageables.has(part) ? part : undefined;
	}

	getIgnitionChanceOf = (block: Instance): number => {
		const matData = Materials.Properties[this.getDamageableOf(block).material().Name]?.thermalProperties;
		const baseChance = matData?.ignitionChance ?? defaultThermal.ignitionChance!;
		return baseChance * (1 - (matData?.thermalResilience ?? 0));
	};

	private tick() {
		this.tickHeat();
		this.tickBurning();

		if (this.breakQueue.size() > 0) {
			// Server-originated ImpactBreak reuses the existing break + replicate path.
			RemoteEvents.ImpactBreak.send(this.breakQueue);
			this.breakQueue = [];
		}
	}

	/** Accumulate heat, enrolling the block in the cooling rotation the first time it is heated. */
	private addHeat(block: Instance, amount: number) {
		const current = this.blockHeat.get(block);
		if (current === undefined) {
			this.heatTime.set(block, time());
			this.heatOrder.push(block);
		}

		this.blockHeat.set(block, (current ?? 0) + amount);
	}

	/** Drop a block from the cooling rotation. */
	private clearHeat(block: Instance) {
		if (!this.blockHeat.delete(block)) return;

		this.heatTime.delete(block);
		const index = this.heatOrder.indexOf(block);
		if (index >= 0) this.removeHeatAt(index);
	}

	private removeHeatAt(index: number) {
		const last = this.heatOrder.size() - 1;
		this.heatOrder[index] = this.heatOrder[last];
		this.heatOrder.pop();
	}

	/** Cool a batch of heated blocks. Each one integrates over its own elapsed time, so the rate a block
	 * cools at is the same whether ten blocks are hot or a thousand. */
	private tickHeat() {
		const total = this.heatOrder.size();
		if (total === 0) return;

		const now = time();
		const batch = math.min(Heat.batch, total);
		for (let processed = 0; processed < batch; processed++) {
			if (this.heatCursor >= this.heatOrder.size()) this.heatCursor = 0;
			const block = this.heatOrder[this.heatCursor];

			if (this.coolBlock(block, now)) {
				this.blockHeat.delete(block);
				this.heatTime.delete(block);
				this.removeHeatAt(this.heatCursor);
			} else {
				this.heatCursor++;
			}
		}
	}

	/** Cool one block over the time since it was last visited. Returns true when it should leave the
	 * rotation: cooled out, ignited, or no longer tracked. */
	private coolBlock(block: Instance, now: number): boolean {
		const heat = this.blockHeat.get(block);
		const properties = this.materialProperties.get(block);
		// Nothing left to drive a fade from, so restore instantly rather than orphan the client's glow.
		if (heat === undefined || heat <= 0 || !properties) {
			this.fadeGlow(block, 0);
			return true;
		}

		const frames = (now - (this.heatTime.get(block) ?? now)) * GameDefinitions.REFERENCE_FPS;
		this.heatTime.set(block, now);

		const matData = Materials.Properties[this.getDamageableOf(block).material().Name]?.thermalProperties;
		const conductivity = matData?.conductivity ?? defaultThermal.conductivity!;
		const mass = this.getThermalMass(block, properties);
		const coolCoeff = this.getCoolingRate(block, conductivity, mass);
		// Newton's Law: rate ∝ current heat — hotter blocks cool faster toward ambient (20°C). Compounded so
		// batching cannot change the total; clamped because a tiny block's coefficient can exceed 1.
		const newHeat = heat * math.max(1 - coolCoeff, 0) ** frames;

		// Relative to mass, so a block retires once its glow is imperceptible rather than at an absolute
		// heat that means a different brightness for every material and size.
		if (newHeat <= mass * Radiation.floor) {
			this.fadeGlow(block, coolCoeff > 0 ? 1 / (coolCoeff * GameDefinitions.REFERENCE_FPS) : 0);
			return true;
		}

		// Ignite once heat exceeds thermal mass.
		if (newHeat >= mass && !this.isSubmerged(block)) {
			const ignitionChance = this.getIgnitionChanceOf(block);
			// Compound the per-frame chance over elapsed frames so a lag spike can't push it past certainty.
			if (testYourLuck(1 - (1 - ignitionChance) ** frames)) {
				this.fadeGlow(block);
				if (!this.burningState.has(block)) {
					RemoteEvents.Burn.send(this.getDamageableOf(block).ignitableParts());
				}
				return true;
			}
		}

		this.blockHeat.set(block, newHeat);
		this.updateGlow(block);
		return false;
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
				this.removeBurningAt(this.burnCursor);
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
		this.conductHeat(block, elapsed);

		const hp = this.health.get(block);
		if (hp === undefined || hp <= 0) return true;

		const newHp = hp - Fire.dps * elapsed;
		this.health.set(block, newHp);
		if (newHp <= 0) {
			this.getDamageableOf(block).broadcastBroken();
			this.forceBreakBlock(block);
			return true;
		}
		return false;
	}

	/** Heat nearby non-burning blocks toward ignition; `elapsed`-scaled so batching doesn't skew the total. */
	private radiateHeat(source: Instance, elapsed: number) {
		const pp = this.getDamageableOf(source).primaryPart();
		if (!pp) return;
		const origin = pp.Position;
		// Volume, matching the volume-based ignition threshold, is what keeps chain propensity equal at every
		// block size; density is left out so a dense material is harder to chain rather than a better emitter.
		const emission = this.getVolume(source);

		// Reach scales with the source, or a fixed radius puts far more neighbours in a small block's range
		// than a standard one's — which is what let dense sheets chain.
		const extent = math.sqrt(this.getSurfaceArea(source));
		const radius = math.min(Radiation.radius * extent, Radiation.maxRadius);
		const nearField = math.max(extent, Radiation.minDistance);

		const checked = this.checked;
		checked.clear();
		checked.add(source); // never radiate back into the block that is burning

		for (const part of Workspace.GetPartBoundsInRadius(origin, radius, radiationOverlapParams)) {
			const block = BlockManager.tryGetBlockModelByPart(part);
			if (!block || checked.has(block)) continue;
			checked.add(block);
			// Already on fire — it's draining HP, not waiting to ignite.
			if (this.burningState.has(block)) continue;

			const pos = this.getDamageableOf(block).primaryPart()?.Position;
			if (!pos) continue;

			const distance = origin.sub(pos).Magnitude;
			if (distance > radius) continue;

			// Inverse-square, normalised to 1 at the emitting surface so it cannot diverge close in.
			const spread = math.max(distance, nearField);
			const falloff = (nearField * nearField) / (spread * spread);
			this.applyDamage(block, {
				heatDamage: Radiation.heatPerSec * elapsed * falloff * emission,
			});
		}
	}

	/**
	 * Carry heat into welded neighbours, which is what makes a fire climb a structure rather than fill a
	 * sphere. Joints are read live rather than resolved once at ignition: a block that burns through severs
	 * its own through the break queue, and impact damage breaks them independently.
	 */
	private conductHeat(source: Instance, elapsed: number) {
		if (!BlockManager.isBlockModel(source)) return;

		// Volume, as in radiateHeat: the ignition threshold is volume × density, so the two cancel through a
		// uniform structure and chain propensity stays equal at every block size.
		const emission = this.getVolume(source);

		const conducted = this.conducted;
		conducted.clear();
		conducted.add(source);

		for (const part of source.GetChildren()) {
			if (!part.IsA("BasePart")) continue;

			for (const joint of part.GetJoints()) {
				// AutoWeld is the only name PlotWelder gives a block-to-block weld; anything else on a block
				// part joins it to its own colbox or assembly. Disabled ones are player-severed connections.
				if (joint.Name !== "AutoWeld" || !joint.IsA("WeldConstraint") || !joint.Enabled) continue;

				const other = joint.Part0 === part ? joint.Part1 : joint.Part0;
				if (!other) continue;

				const block = BlockManager.tryGetBlockModelByPart(other);
				if (!block || conducted.has(block)) continue;
				conducted.add(block);
				if (this.burningState.has(block)) continue;

				this.applyDamage(block, { heatDamage: Conduction.heatPerSec * elapsed * emission });
			}
		}
	}

	private getSurfaceArea(block: Instance): number {
		const scale = this.getDamageableOf(block).size();
		return (scale.X * scale.Y + scale.Y * scale.Z + scale.Z * scale.X) / 3;
	}

	private getVolume(block: Instance): number {
		const scale = this.getDamageableOf(block).size();
		return scale.X * scale.Y * scale.Z;
	}

	/** Volume × density; bigger/denser blocks need more heat to glow / ignite. */
	private getThermalMass(block: Instance, properties: PhysicalProperties): number {
		return this.getVolume(block) * properties.Density;
	}

	/** Newton cooling coefficient (heat fraction lost per reference frame). Convection scales with air pressure; radiation provides a floor in vacuum. Divided by thermalMass so larger blocks cool slower (temperature drives loss, not raw heat). */
	private getCoolingRate(block: Instance, conductivity: number, thermalMass: number): number {
		const surfaceArea = this.getSurfaceArea(block);
		const height = Physics.LocalHeight.fromGlobal(
			this.getDamageableOf(block).primaryPart()?.Position.Y ?? GameDefinitions.HEIGHT_OFFSET,
		);
		const pressureFactor = Physics.GetAirDensityModifierOnHeight(height);
		return (surfaceArea * (conductivity * pressureFactor + Radiation.emissivity)) / thermalMass;
	}

	/** Send glow intensity on a Radiation.glowThreshold change (the client interpolates), but always saturate to full at the ignition threshold. */
	private updateGlow(block: Instance) {
		if (!this.hasHeatGlow.get(block)) return;
		const pp = this.getDamageableOf(block).primaryPart();
		const properties = this.materialProperties.get(block);
		if (!pp || !properties) return;

		// getThermalMass is the ignition threshold, so intensity hits 1 exactly when the block can ignite.
		const intensity = math.clamp((this.blockHeat.get(block) ?? 0) / this.getThermalMass(block, properties), 0, 1);
		const last = this.lastGlowIntensity.get(block) ?? 0;
		if (intensity === last) return;
		// Throttle intermediate steps, but never let the gate swallow the final jump to full glow.
		if (intensity < 1 && math.abs(intensity - last) < Radiation.glowThreshold) return;

		this.lastGlowIntensity.set(block, intensity);
		// hasHeatGlow gates this above and is only ever set for blocks, so the target here is always a block.
		this.heatGlowEffect.send(pp, { block: block as BlockModel, intensity });
	}

	/** Fade the glow back to the original colour over `fadeTime` seconds; omit it to char the block instead. */
	private fadeGlow(block: Instance, fadeTime?: number) {
		this.lastGlowIntensity.delete(block);
		if (!this.hasHeatGlow.get(block)) return;
		const pp = this.getDamageableOf(block).primaryPart();
		if (pp) this.heatGlowEffect.send(pp, { block: block as BlockModel, intensity: 0, fadeTime });
	}

	private getOwnerIdOf(block: Instance): number | undefined {
		return this.getDamageableOf(block).ownerId();
	}

	private getOwnerSettings(block: Instance): PlayerConfig | undefined {
		const ownerId = this.getOwnerIdOf(block);
		if (ownerId === undefined) return undefined;
		return this.playerDatabase.get(ownerId).settings as PlayerConfig | undefined;
	}

	/** Unreadable rows read as off: get() must run first, since it is what marks a row unresolved. */
	isPvpEnabled(userId: number): boolean {
		const settings = this.playerDatabase.get(userId).settings;
		if (!this.playerDatabase.isDataLoaded(userId)) return false;
		return settings?.replication?.pvp ?? true;
	}

	/** Owner must be riding; another player's block additionally needs PvP on both sides. Unowned = bypass. */
	private canDamage(block: Instance, attacker: Player | undefined): boolean {
		const ownerId = this.getOwnerIdOf(block);
		if (ownerId === undefined) return true;

		// Resolved late: PlayModeController reaches back here through RideMode -> MortalityController, so
		// injecting it would close a cycle. Unresolvable means we cannot tell, and damage is allowed.
		this.playMode ??= this.di.tryResolve<PlayModeController>();
		if (this.playMode && this.playMode.getPlayerModeById(ownerId) !== "ride") return false;

		if (!attacker || ownerId === attacker.UserId) return true;

		return this.isPvpEnabled(attacker.UserId) && this.isPvpEnabled(ownerId);
	}

	private initHealth(block: Instance): number | undefined {
		const pp = this.getDamageableOf(block).primaryPart();
		if (!pp) return undefined;

		const settings = this.getOwnerSettings(block);
		const blockStrength =
			settings?.environment?.physics?.impactDestruction?.blockHealthModifier ?? DEFAULT_BLOCK_STRENGTH;
		const minDamageModifier =
			(settings?.environment?.physics?.impactDestruction?.blockMinimalDamageThreshold ??
				DEFAULT_MIN_DAMAGE_PERCENT) / 100;

		const material = this.getDamageableOf(block).material();
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

		const blockID = this.getDamageableOf(block).id();
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
		this.clearHeat(block);
		this.lastGlowIntensity.delete(block);
		this.damageables.delete(block);
		this.unmarkBurning(block);
	}

	private isSubmerged(block: Instance): boolean {
		const pp = this.getDamageableOf(block).primaryPart();
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
		if (heat < this.getThermalMass(block, properties)) return;
		if (!testYourLuck(1 - (1 - chance) ** exposureFrames)) return;

		this.clearHeat(block);
		this.fadeGlow(block);
		RemoteEvents.Burn.send(this.getDamageableOf(block).ignitableParts());
	}

	private forceBreakBlock(block: Instance) {
		if (!this.suppressBreakHeat) {
			const pp = this.getDamageableOf(block).primaryPart();
			if (pp) {
				this.suppressBreakHeat = true;
				this.applyRadialDamage(
					pp.Position,
					Ignition.breakRadius,
					0,
					Ignition.breakHeat,
					undefined,
					Ignition.breakFrames,
				);
				this.suppressBreakHeat = false;
			}
		}

		this.getDamageableOf(block).break(this.breakQueue);
	}

	applyDamage(block: Instance, damage: BlockDamage, attacker?: Player) {
		if (!block || !block.IsDescendantOf(Workspace)) return;
		// Anything unregistered that is not a real block model is refused rather than improvised into one:
		// damageableOf would hand a character Model a BlockDamageable whose ownerId reads nothing, and an
		// undefined owner takes the canDamage bypass.
		if (!this.damageables.has(block) && !BlockManager.isBlockModel(block)) return;
		if (!this.canDamage(block, attacker)) return;

		const { explosiveDamage = 0 } = damage;
		let { heatDamage = 0, impactDamage = 0 } = damage;

		// Lazy init on first damage using the owner's settings.
		let currentHealth = this.health.get(block);
		if (currentHealth === undefined) currentHealth = this.initHealth(block);
		if (currentHealth === undefined || currentHealth <= 0) return;

		heatDamage *= 1 - (this.thermalResilience.get(block) ?? 0);

		const pp = this.getDamageableOf(block).primaryPart();
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
			this.addHeat(block, totalHeat);
			this.updateGlow(block);
		}

		if (impactHeat > 0 || (damage.impulseHeat === true && heatDamage > 0)) {
			this.igniteIfOverThreshold(block, Ignition.impulseFrames);
		}

		if (newHealth <= 0) {
			this.getDamageableOf(block).broadcastBroken();
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
		/**
		 * Blocks the caller saw in the blast that this query may not, because a client-owned block's replicated
		 * position lags. Damage is still computed here, and distance is clamped to the radius, so one of these
		 * can never take more than a block sitting at the very edge.
		 */
		claimed?: readonly { readonly block: Instance; readonly distance: number }[],
		/** Epicenter failed plausibility: the sender stays authoritative over its own things and loses the rest. */
		selfOnly = false,
	) {
		if (radius <= 0) return;

		const checked = new Set<Instance>();
		const targets: Array<{ block: Instance; distance: number }> = [];

		// A caller supplying `claimed` owns the hit list outright and the query below is skipped: on a moving
		// machine the server's copies sit far enough behind that a sphere at the sender's epicenter finds
		// nothing of it at all. The count is still taken for the log, since that gap is what justifies this.
		if (!claimed) {
			for (const part of Workspace.GetPartBoundsInRadius(epicenter, radius)) {
				const block = this.getTargetForPart(part);
				if (!block || checked.has(block)) continue;
				checked.add(block);

				const pos = this.getDamageableOf(block).primaryPart()?.Position;
				if (!pos) continue;

				const distance = epicenter.sub(pos).Magnitude;
				if (distance > radius) continue;
				targets.push({ block, distance });
			}
		} else {
			// The claim owns the block list — it is measured against live positions the server lacks — but it
			// is blocks-only by construction, so characters would be immune to claimed blasts. Registered limbs
			// are swept here instead: the server's view of a character is as good as anyone's.
			let wouldFind = 0;
			const counted = new Set<Instance>();
			for (const part of Workspace.GetPartBoundsInRadius(epicenter, radius)) {
				const target = this.getTargetForPart(part);
				if (!target || counted.has(target)) continue;
				counted.add(target);

				if (BlockManager.isBlockModel(target)) {
					wouldFind++;
					continue;
				}

				const pos = this.getDamageableOf(target).primaryPart()?.Position;
				if (!pos) continue;
				const distance = epicenter.sub(pos).Magnitude;
				if (distance > radius) continue;

				checked.add(target);
				targets.push({ block: target, distance });
			}
			print(`[blast] server query would have found ${wouldFind}, using the sender's ${claimed.size()}`);
		}

		for (const { block, distance } of claimed ?? []) {
			if (checked.has(block)) continue;
			// same admissibility applyDamage enforces, applied early so an unknown instance never reaches it
			if (!this.damageables.has(block) && !BlockManager.isBlockModel(block)) continue;
			checked.add(block);

			// The caller's own measurement, because it is the only one taken against live positions. Bounded
			// below the radius so a claim can never be worth more than a block standing right at the centre.
			targets.push({ block, distance: math.clamp(distance, 0, radius) });
		}

		// A blast that carries no heat must not create any through its kills either — a non-flammable TNT
		// would otherwise heat the surroundings of every block it breaks via the break scatter. Restored
		// rather than cleared: the scatter itself runs through here with the flag already held.
		const prevSuppress = this.suppressBreakHeat;
		if (flammableHeat <= 0) this.suppressBreakHeat = true;

		for (const { block, distance } of targets) {
			if (selfOnly && this.getDamageableOf(block).ownerId() !== attacker?.UserId) continue;

			const falloff = 1 - distance / radius;
			// TEMPORARY: skipped for the pressureless heat scatter forceBreakBlock runs, which would otherwise
			// fill the log with dmg=0 lines that have nothing to do with the blast.
			if (pressure > 0) {
				print(
					`[blast]   hit ${block.Name} id=${BlockManager.manager.id.get(block as BlockModel)}` +
						` dist=${string.format("%.2f", distance)} hp=${string.format("%.0f", this.health.get(block) ?? -1)}` +
						` dmg=${string.format("%.0f", pressure * falloff * falloff)}`,
				);
			}
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

		this.suppressBreakHeat = prevSuppress;
	}
}
