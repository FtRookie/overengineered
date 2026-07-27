import { RunService } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { PlayerWatcher } from "engine/shared/PlayerWatcher";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { Damageable, ServerBlockDamageController } from "server/ServerBlockDamageController";

// Placeholder flesh profile — a plain flammable material until a dedicated limb thermal profile is tuned (Phase 3).
const FLESH_MATERIAL = Enum.Material.Plastic;
const LIMB_HEALTH = 100;

/** A character limb as a Damageable: the fire/damage pipeline treats it exactly like a block. */
class LimbDamageable implements Damageable {
	constructor(
		private readonly limb: BasePart,
		readonly isVital: boolean,
		private readonly ownerUserId: number,
	) {}

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
		// Phase 5: unweld + ragdoll (dismember). A limb must not shatter into ImpactBreak debris.
	}
	broadcastBroken(): void {
		// Death is driven by the health bridge (it zeroes Humanoid.Health when a vital limb dies).
	}
}

type MortalEntry = {
	readonly humanoid: Humanoid;
	readonly limbs: readonly { readonly part: BasePart; readonly vital: boolean }[];
};

/**
 * Makes mortal players' characters take damage through the block system: each rig limb registers as a
 * Damageable, and Humanoid.Health is driven by the sum of limb HP (part-HP authoritative). A player is
 * mortal iff `mortality || pvp`.
 */
@injectable
export class MortalityController extends HostedService {
	private readonly mortals = new Map<Model, MortalEntry>();

	constructor(
		@inject private readonly damage: ServerBlockDamageController,
		@inject private readonly playerDatabase: PlayerDatabase,
	) {
		super();

		PlayerWatcher.onCharacterAdded((character, player) => this.onCharacter(character, player));
		this.event.subscribe(RunService.PostSimulation, () => this.bridge());
	}

	private isMortal(userId: number): boolean {
		const settings = this.playerDatabase.get(userId).settings;
		const mortality = settings?.character?.mortality ?? false;
		const pvp = settings?.replication?.pvp ?? true;
		return mortality || pvp;
	}

	private onCharacter(character: Model, player: Player) {
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

		humanoid.MaxHealth = limbs.size() * LIMB_HEALTH;
		humanoid.Health = humanoid.MaxHealth;
		this.mortals.set(character, { humanoid, limbs });

		player.CharacterRemoving.Once((removing) => {
			if (removing === character) this.forget(character);
		});
	}

	private forget(character: Model) {
		const entry = this.mortals.get(character);
		if (!entry) return;

		for (const { part } of entry.limbs) this.damage.unregister(part);
		this.mortals.delete(character);
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
