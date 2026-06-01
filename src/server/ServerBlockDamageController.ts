import { RunService, Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { BlockManager } from "shared/building/BlockManager";
import { MaterialData } from "shared/data/MaterialData";
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

/** Minimum impactDamage (relative speed, studs/s) required to generate heat. */
const MIN_IMPACT_HEAT_SPEED = 500;
/** Heat generated per unit of impactDamage above threshold, divided by material strength (density/3.5).
 * Lower-density materials (plastic, wood) receive more heat per impact. */
const IMPACT_HEAT_FACTOR = 0.0005;

/**
 * Server-authoritative block health. Clients send damage requests (batched, via
 * `CustomRemotes.damageSystem.damage`); the server owns every block's HP, decides when a block
 * breaks, drives ignition/sparks, and broadcasts breaks back so clients can react (TNT chains).
 *
 * Health is initialised lazily on first damage, scaled by the block owner's own physics settings
 * (blockHealthModifier / blockMinimalDamageThreshold) read from the player database.
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
	private readonly blockHeat = new Map<BlockModel, number>();
	private breakQueue: BasePart[] = [];
	private heatGlowTick = 0;

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

		this.event.subscribe(RunService.PostSimulation, () => this.tick());
	}

	private tick() {
		const defaults = MaterialData.Properties.Default;
		for (const [block, heat] of this.blockHeat) {
			if (heat <= 0) continue;

			const properties = this.materialProperties.get(block);
			if (!properties) continue;

			const material = BlockManager.manager.material.get(block);
			const matData = MaterialData.Properties[material.Name];
			const conductivity = matData?.thermalConductivity ?? defaults.thermalConductivity;
			const newHeat = math.max(heat - conductivity!, 0);
			this.blockHeat.set(block, newHeat);

			if (newHeat <= 0) {
				if (matData?.heatGlow) {
					const pp = block.PrimaryPart;
					if (pp)
						this.heatGlowEffect.send(pp, {
							block,
							intensity: 0,
							fadeTime: heat / (conductivity! * 60),
						});
				}
				continue;
			}

			// Ignition threshold = thermal mass (volume × density); larger denser blocks need more heat.
			const scale = BlockManager.manager.scale.get(block) ?? Vector3.one;
			const volume = scale.X * scale.Y * scale.Z;
			if (newHeat < volume * properties.Density) continue;

			const ignitionChance = matData?.ignitionChance ?? defaults.ignitionChance!;
			if (!testYourLuck(ignitionChance)) continue;

			this.blockHeat.set(block, 0);
			if (matData?.heatGlow) {
				const pp = block.PrimaryPart;
				if (pp) this.heatGlowEffect.send(pp, { block, intensity: 0, fadeTime: 0 });
			}
			RemoteEvents.Burn.send(
				block.GetDescendants().filter((v): v is BasePart => v.IsA("BasePart") && v !== block.PrimaryPart),
			);
		}

		// Throttled heat glow broadcast — every 6 ticks (~100ms at 60Hz).
		this.heatGlowTick = (this.heatGlowTick + 1) % 6;
		if (this.heatGlowTick === 0) {
			for (const [block, heat] of this.blockHeat) {
				if (heat <= 0) continue;

				const material = BlockManager.manager.material.get(block);
				const matData = MaterialData.Properties[material.Name];
				if (!(matData?.heatGlow ?? defaults.heatGlow)) continue;

				const pp = block.PrimaryPart;
				if (!pp) continue;

				const properties = this.materialProperties.get(block);
				if (!properties) continue;

				const scale = BlockManager.manager.scale.get(block) ?? Vector3.one;
				const volume = scale.X * scale.Y * scale.Z;
				const intensity = math.clamp(heat / (volume * properties.Density), 0, 1);
				this.heatGlowEffect.send(pp, { block, intensity });
			}
		}

		if (this.breakQueue.size() > 0) {
			// Server-originated ImpactBreak reuses the existing server break + replicate path.
			RemoteEvents.ImpactBreak.send(this.breakQueue);
			this.breakQueue = [];
		}
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

	/**
	 * PvP gate. Damaging your own blocks is always allowed; damaging another player's blocks only
	 * happens when both that player and the attacker have PvP enabled (mutual consent). A missing
	 * attacker (server-internal damage) bypasses the gate.
	 */
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

		// Smallest axis so a giant sheet isn't absurdly tough, floored at 0.7 so tiny parts
		// aren't trivially destroyed.
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
		this.hasHeatGlow.set(block, MaterialData.Properties[material.Name]?.heatGlow ?? false);
		return blockHealth;
	}

	private forget(block: BlockModel) {
		this.health.delete(block);
		this.maxHealth.delete(block);
		this.materialProperties.delete(block);
		this.minDamageModifier.delete(block);
		this.impactHeatStrength.delete(block);
		this.hasHeatGlow.delete(block);
		this.blockHeat.delete(block);
	}

	private forceBreakBlock(block: BlockModel) {
		for (const p of block.GetDescendants()) {
			if (p.IsA("BasePart") || p.IsA("UnionOperation") || p.IsA("MeshPart")) this.breakQueue.push(p);
		}
	}

	applyDamage(block: BlockModel, damage: damageType, attacker?: Player) {
		if (!block || !block.IsDescendantOf(Workspace)) return;
		if (!this.canDamage(block, attacker)) return;

		const { explosiveDamage = 0, heatDamage = 0 } = damage;
		let { impactDamage = 0 } = damage;

		// Lazy init on first damage using the owner's settings.
		let currentHealth = this.health.get(block);
		if (currentHealth === undefined) currentHealth = this.initHealth(block);
		if (currentHealth === undefined || currentHealth <= 0) return;

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
			const newBlockHeat = (this.blockHeat.get(block) ?? 0) + totalHeat;
			this.blockHeat.set(block, newBlockHeat);

			if (this.hasHeatGlow.get(block)) {
				const scale = BlockManager.manager.scale.get(block) ?? Vector3.one;
				const volume = scale.X * scale.Y * scale.Z;
				const intensity = properties ? math.clamp(newBlockHeat / (volume * properties.Density), 0, 1) : 0;
				this.heatGlowEffect.send(pp, { block, intensity });
			}
		}

		if (newHealth <= 0) {
			CustomRemotes.damageSystem.broken.send("everyone", block);
			this.forceBreakBlock(block);
			return;
		}

		// Surviving blocks hit by an explosion can still have their welds shaken loose. Chance
		// scales with how much of the current HP this hit ate; the 0.5 cap keeps even a full-HP
		// hit at ~50% rather than always.
		if (explosiveDamage > 0) {
			const shakeChance = math.min(explosiveDamage / currentHealth, 1) * 0.5;
			if (testYourLuck(shakeChance)) this.forceBreakBlock(block);
		}
	}

	/**
	 * Apply explosive damage to every unique block within `radius` of `epicenter`, with quadratic
	 * falloff. Targets are snapshotted before any damage is dealt so a chain reaction (a hit block
	 * detonating) can't mutate the set mid-iteration.
	 *
	 * `flammableHeat` (0 = none) feeds the same heat → ignition pipeline as plasma: each block gets
	 * `flammableHeat * falloff` heat, so ignition is per-block, distance-scaled and material-aware
	 * (denser blocks resist) instead of a flat per-part coin flip. The heat is small enough that its
	 * HP contribution is negligible next to the explosive damage.
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
