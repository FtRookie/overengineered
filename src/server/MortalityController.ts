import { RunService } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { Instances } from "engine/shared/fixes/Instances";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { Damageable, ServerBlockDamageController } from "server/ServerBlockDamageController";

// Placeholder flesh profile
const FLESH_MATERIAL = Enum.Material.Plastic;
const LIMB_HEALTH = 100;
/** Overkill past this tears the limb off outright rather than leaving it dangling on its socket. */
const DETACH_OVERKILL = LIMB_HEALTH * 5;

/** A character limb as a Damageable: damage pipeline treats it exactly like a block. */
class LimbDamageable implements Damageable {
	constructor(
		private readonly limb: BasePart,
		readonly isVital: boolean,
		private readonly ownerUserId: number,
		private readonly damage: ServerBlockDamageController,
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

		// Health already carries the overkill as a negative when break runs. A burn-down or an explosive
		// shake-break lands just under zero (or above it), so only a genuinely oversized hit detaches.
		const detach = -(this.damage.getHealth(this.limb) ?? 0) >= DETACH_OVERKILL;

		for (const joint of character.GetDescendants()) {
			if (!joint.IsA("Motor6D") || joint.Part1 !== this.limb) continue;

			joint.SetAttribute("Dismembered", true);
			joint.Enabled = false;

			if (detach) {
				const socket = Instances.findChild<BallSocketConstraint>(
					character,
					"ConstraintsFolder",
					`${joint.Name} Socket`,
				);
				if (socket) socket.Enabled = false;
			}
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

		const socket = Instances.findChild<BallSocketConstraint>(
			character,
			"ConstraintsFolder",
			`${joint.Name} Socket`,
		);
		if (socket) socket.Enabled = true;
	}
}

type MortalEntry = {
	readonly humanoid: Humanoid;
	readonly limbs: readonly { readonly part: BasePart; readonly vital: boolean }[];
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
		const mortality = this.playerDatabase.get(userId).settings?.character?.mortality ?? false;
		return mortality || this.damage.isPvpEnabled(userId);
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
			this.damage.registerDamageable(
				child,
				new LimbDamageable(child, vital, player.UserId, this.damage),
				LIMB_HEALTH,
			);
			limbs.push({ part: child, vital });
		}
		if (limbs.size() === 0) return;

		humanoid.MaxHealth = limbs.size() * LIMB_HEALTH;
		humanoid.Health = humanoid.MaxHealth;
		this.mortals.set(character, { humanoid, limbs });

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

		entry.humanoid.Health = entry.humanoid.MaxHealth;
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
