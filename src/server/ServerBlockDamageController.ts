import { RunService, Workspace } from "@rbxts/services";
import { Materials } from "engine/shared/data/Materials";
import { HostedService } from "engine/shared/di/HostedService";
import { BlockManager } from "shared/building/BlockManager";
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

/**
 * Server-authoritative block health. Clients send (batched) damage requests; the server owns HP,
 * decides breaks, drives ignition/sparks, and broadcasts breaks back (so clients can react, e.g. TNT
 * chains). HP is initialised lazily on first damage from the owner's physics settings.
 */
@injectable
export class ServerBlockDamageController extends HostedService {
	private readonly health = new Map<BlockModel, health>();
	private readonly maxHealth = new Map<BlockModel, health>();
	private readonly materialProperties = new Map<BlockModel, PhysicalProperties>();
	/** The owner's spark/forced-break threshold (fraction of HP), captured at init. */
	private readonly minDamageModifier = new Map<BlockModel, number>();
	private readonly impactHeatStrength = new Map<BlockModel, number>();
	private readonly hasHeatGlow = new Map<BlockModel, boolean>();
	/** Material's resistance to thermal damage (0–1); scales incoming heatDamage down, captured at init. */
	private readonly thermalResilience = new Map<BlockModel, number>();
	private readonly blockHeat = new Map<BlockModel, number>();
	/** Last glow intensity broadcast per block — drives the GLOW_STEP change gate. */
	private readonly lastGlowIntensity = new Map<BlockModel, number>();
	private breakQueue: BasePart[] = [];

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

	private tick(dt: number) {
		// Scale per-tick rates by elapsed frames so they don't drift with the server frame rate.
		const frames = dt * REFERENCE_FPS;
		const defaults = Materials.Properties.Default;
		const cooled: BlockModel[] = [];

		for (const [block, heat] of this.blockHeat) {
			const properties = this.materialProperties.get(block);
			if (heat <= 0 || !properties) {
				cooled.push(block);
				continue;
			}

			const matData = Materials.Properties[BlockManager.manager.material.get(block).Name];
			const thermalConductivity = matData?.thermalConductivity ?? defaults.thermalConductivity!;
			const coolRate = this.coolingRate(block, thermalConductivity);
			const newHeat = math.max(heat - coolRate * frames, 0);

			if (newHeat <= 0) {
				// Fully cooled — fade glow out, stop tracking.
				this.fadeGlow(block, heat / (coolRate * REFERENCE_FPS));
				cooled.push(block);
				continue;
			}

			// Ignite once heat exceeds thermal mass.
			if (newHeat >= this.thermalMass(block, properties)) {
				const ignitionChance = matData?.ignitionChance ?? defaults.ignitionChance!;
				// Compound the per-frame chance over elapsed frames so a lag spike can't push it past certainty.
				if (testYourLuck(1 - (1 - ignitionChance) ** frames)) {
					this.fadeGlow(block, 0);
					cooled.push(block);
					RemoteEvents.Burn.send(
						block
							.GetDescendants()
							.filter((v): v is BasePart => v.IsA("BasePart") && v !== block.PrimaryPart),
					);
					continue;
				}
			}

			this.blockHeat.set(block, newHeat);
			this.updateGlow(block);
		}

		for (const block of cooled) this.blockHeat.delete(block);

		if (this.breakQueue.size() > 0) {
			// Server-originated ImpactBreak reuses the existing break + replicate path.
			RemoteEvents.ImpactBreak.send(this.breakQueue);
			this.breakQueue = [];
		}
	}

	/** Volume × density; bigger/denser blocks need more heat to glow / ignite. */
	private thermalMass(block: BlockModel, properties: PhysicalProperties): number {
		const scale = BlockManager.manager.scale.get(block) ?? Vector3.one;
		return scale.X * scale.Y * scale.Z * properties.Density;
	}

	/** Surface area × conductivity, normalised so a unit cube yields 1; smaller blocks shed heat faster relative to capacity (area ∝ L², mass ∝ L³). */
	private coolingRate(block: BlockModel, thermalConductivity: number): number {
		const scale = BlockManager.manager.scale.get(block) ?? Vector3.one;
		const surfaceArea = (scale.X * scale.Y + scale.Y * scale.Z + scale.Z * scale.X) / 3;
		return surfaceArea * thermalConductivity;
	}

	/** Send glow intensity on a GLOW_STEP change (the client interpolates), but always saturate to full at the ignition threshold. */
	private updateGlow(block: BlockModel) {
		if (!this.hasHeatGlow.get(block)) return;
		const pp = block.PrimaryPart;
		const properties = this.materialProperties.get(block);
		if (!pp || !properties) return;

		// thermalMass is the ignition threshold, so intensity hits 1 exactly when the block can ignite.
		const intensity = math.clamp((this.blockHeat.get(block) ?? 0) / this.thermalMass(block, properties), 0, 1);
		const last = this.lastGlowIntensity.get(block) ?? 0;
		if (intensity === last) return;
		// Throttle intermediate steps, but never let the gate swallow the final jump to full glow.
		if (intensity < 1 && math.abs(intensity - last) < GLOW_STEP) return;

		this.lastGlowIntensity.set(block, intensity);
		this.heatGlowEffect.send(pp, { block, intensity });
	}

	/** Fade the glow back to the original colour over `fadeTime` seconds. */
	private fadeGlow(block: BlockModel, fadeTime: number) {
		this.lastGlowIntensity.delete(block);
		if (!this.hasHeatGlow.get(block)) return;
		const pp = block.PrimaryPart;
		if (pp) this.heatGlowEffect.send(pp, { block, intensity: 0, fadeTime });
	}

	private ownerIdOf(block: BlockModel): number | undefined {
		// block -> Blocks folder -> plot model, which carries the owner id attribute.
		return block.Parent?.Parent?.GetAttribute("ownerid") as number | undefined;
	}

	private ownerSettings(block: BlockModel): PlayerConfig | undefined {
		const ownerId = this.ownerIdOf(block);
		if (ownerId === undefined) return undefined;
		return this.playerDatabase.get(ownerId).settings as PlayerConfig | undefined;
	}

	/** PvP gate: own blocks always; another player's only if both have PvP on. No attacker = bypass. */
	private canDamage(block: BlockModel, attacker: Player | undefined): boolean {
		if (!attacker) return true;

		const ownerId = this.ownerIdOf(block);
		if (ownerId === undefined || ownerId === attacker.UserId) return true;

		const attackerPvp = this.playerDatabase.get(attacker.UserId).settings?.pvp ?? true;
		const ownerPvp = this.playerDatabase.get(ownerId).settings?.pvp ?? true;
		return attackerPvp && ownerPvp;
	}

	private initHealth(block: BlockModel): number | undefined {
		const pp = block.PrimaryPart;
		if (!pp) return undefined;

		const settings = this.ownerSettings(block);
		const blockStrength = settings?.blockHealthModifier ?? DEFAULT_BLOCK_STRENGTH;
		const minDamageModifier = (settings?.blockMinimalDamageThreshold ?? DEFAULT_MIN_DAMAGE_PERCENT) / 100;

		const material = BlockManager.manager.material.get(block);
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

		const blockID = BlockManager.manager.id.get(block);
		const physicsConfig = this.blockList.blocks[blockID]?.physics;
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
		this.hasHeatGlow.set(
			block,
			Materials.Properties[material.Name]?.heatGlow ?? Materials.Properties.Default.heatGlow!,
		);
		this.thermalResilience.set(
			block,
			math.clamp(
				Materials.Properties[material.Name]?.thermalResilience ??
					Materials.Properties.Default.thermalResilience!,
				0,
				1,
			),
		);
		return blockHealth;
	}

	private forget(block: BlockModel) {
		this.health.delete(block);
		this.maxHealth.delete(block);
		this.materialProperties.delete(block);
		this.minDamageModifier.delete(block);
		this.impactHeatStrength.delete(block);
		this.hasHeatGlow.delete(block);
		this.thermalResilience.delete(block);
		this.blockHeat.delete(block);
		this.lastGlowIntensity.delete(block);
	}

	private forceBreakBlock(block: BlockModel) {
		for (const p of block.GetDescendants()) {
			if (p.IsA("BasePart") || p.IsA("UnionOperation") || p.IsA("MeshPart")) this.breakQueue.push(p);
		}
	}

	applyDamage(block: BlockModel, damage: damageType, attacker?: Player) {
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

		const pp = block.PrimaryPart;
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
			CustomRemotes.damageSystem.broken.send("everyone", block);
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

		const seen = new Set<BlockModel>();
		const targets: Array<{ block: BlockModel; distance: number }> = [];
		for (const part of Workspace.GetPartBoundsInRadius(epicenter, radius)) {
			const block = BlockManager.tryGetBlockModelByPart(part);
			if (!block || seen.has(block)) continue;
			seen.add(block);

			const pos = block.PrimaryPart?.Position;
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
