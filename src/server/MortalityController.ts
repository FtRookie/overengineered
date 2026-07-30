import { RunService } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { Damageable, ServerBlockDamageController } from "server/ServerBlockDamageController";

// Placeholder flesh profile
const FLESH_MATERIAL = Enum.Material.Plastic;
const LIMB_HEALTH = 100;

/** A character limb as a Damageable: damage pipeline treats it exactly like a block. */
class LimbDamageable implements Damageable {
	constructor(
		private readonly limb: BasePart,
		readonly isVital: boolean,
		private readonly ownerUserId: number,
	) {}

	// Matches Block for BlockManager API calls
	primaryPart(): BasePart | undefined {
		return this.limb;
	}
	size(): Vector3 {
		return this.limb.Size;
	}
	material(): Enum.Material {
		return FLESH_MATERIAL;
	}
	ownerId(): number | undefined {
		return this.ownerUserId;
	}
	id(): string | undefined {
		return undefined;
	}
	ignitableParts(): BasePart[] {
		return [this.limb];
	}
	break(): void {
		// Dismember: disable the joint attaching this limb to its parent so it dangles from the
		// BallSocketConstraint RagdollController pre-built for that joint. The "Dismembered" flag keeps
		// RagdollModule.toggleJoints from re-attaching it when the character later ragdolls/recovers.
		const character = this.limb.Parent;
		if (!character) return;

		for (const joint of character.GetDescendants()) {
			if (!joint.IsA("Motor6D") || joint.Part1 !== this.limb) continue;

			joint.SetAttribute("Dismembered", true);
			joint.Enabled = false;
			return;
		}
	}
	broadcastBroken(): void {
		// Death is driven by the health bridge (it zeroes Humanoid.Health when a vital limb dies).
	}
}

/** Restore **dismembered** limbs to their normal state, does not fix destroyed limbs */
function reattachLimbs(character: Model) {
	for (const joint of character.GetDescendants()) {
		if (!joint.IsA("Motor6D") || joint.GetAttribute("Dismembered") !== true) continue;
		joint.SetAttribute("Dismembered", undefined);
		joint.Enabled = true;
	}
}

type MortalEntry = {
	readonly humanoid: Humanoid;
	readonly limbs: readonly { readonly part: BasePart; readonly vital: boolean }[];
	readonly defaultMaxHealth: number;
};

@injectable
export class MortalityController extends HostedService {
	private readonly mortals = new Map<Model, MortalEntry>();

	constructor(
		@inject private readonly damage: ServerBlockDamageController,
		@inject private readonly playerDatabase: PlayerDatabase,
	) {
		super();

		this.event.subscribe(RunService.PostSimulation, () => this.bridge());
	}

	private isMortal(userId: number): boolean {
		const settings = this.playerDatabase.get(userId).settings;
		const mortality = settings?.character?.mortality ?? false;
		const pvp = settings?.replication?.pvp ?? true;
		return mortality || pvp;
	}

	/** Register a player's character to take damage */
	arm(player: Player) {
		const character = player.Character;
		if (!character || this.mortals.has(character)) return;
		if (!this.isMortal(player.UserId)) return;

		const humanoid = character.FindFirstChildOfClass("Humanoid");
		if (!humanoid) return;

		const limbs: { part: BasePart; vital: boolean }[] = [];
		for (const child of character.GetChildren()) {
			if (!child.IsA("BasePart")) continue;
			const vital = child.Name === "Head" || child === character.PrimaryPart;
			this.damage.registerDamageable(child, new LimbDamageable(child, vital, player.UserId), LIMB_HEALTH);
			limbs.push({ part: child, vital });
		}
		if (limbs.size() === 0) return;

		const defaultMaxHealth = humanoid.MaxHealth;
		humanoid.MaxHealth = limbs.size() * LIMB_HEALTH;
		humanoid.Health = humanoid.MaxHealth;
		this.mortals.set(character, { humanoid, limbs, defaultMaxHealth });

		player.CharacterRemoving.Once((removing) => {
			if (removing === character) this.forget(character);
		});
	}

	/** Removes a player's mortality from their character */
	disarm(player: Player) {
		const character = player.Character;
		if (!character) return;

		const entry = this.mortals.get(character);
		if (!entry) return;

		reattachLimbs(character);
		for (const { part } of entry.limbs) this.damage.unregister(part);
		this.mortals.delete(character);

		entry.humanoid.MaxHealth = entry.defaultMaxHealth;
		entry.humanoid.Health = entry.defaultMaxHealth;
	}

	private forget(character: Model) {
		const entry = this.mortals.get(character);
		if (!entry) return;

		// fixme: deliberate — a burning player stays alight through death/despawn (a burning corpse). To put
		// the fire out on despawn instead, extinguish each limb here first:
		// for (const { part } of entry.limbs) SpreadingFireController.instance?.extinguish(part);
		for (const { part } of entry.limbs) this.damage.unregister(part);
		this.mortals.delete(character);
	}

	/** Reattach dismembered limbs and restore full limb health */
	restore(player: Player) {
		const character = player.Character;
		if (!character) return;

		const entry = this.mortals.get(character);
		if (!entry) {
			// Non-mortal characters take no damage; this is only a parity full-heal.
			const humanoid = character.FindFirstChildOfClass("Humanoid");
			if (humanoid) humanoid.Health = humanoid.MaxHealth;
			return;
		}

		for (const { part } of entry.limbs) this.damage.heal(part);
		reattachLimbs(character);
	}

	private bridge() {
		for (const [, entry] of this.mortals) {
			let sum = 0;
			let vitalDead = false;
			for (const { part, vital } of entry.limbs) {
				const hp = this.damage.getHealth(part) ?? 0;
				sum += hp;
				if (vital && hp <= 0) vitalDead = true;
			}

			// fixme: writes every frame to override Roblox's default Health regen; replace with a per-limb heal
			// and gate the write on change once the default regen script is disabled.
			entry.humanoid.Health = vitalDead ? 0 : sum;
		}
	}
}
