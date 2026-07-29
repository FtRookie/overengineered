import { EffectBase } from "shared/effects/EffectBase";
import { WeaponProjectile } from "shared/weaponProjectiles/BaseProjectileLogic";
import type { EffectCreator } from "shared/effects/EffectBase";
import type { ProjectileModifier } from "shared/weaponProjectiles/BaseProjectileLogic";

export class BulletProjectile extends WeaponProjectile {
	// startPosition / baseVelocity / firingBlock / platformVelocity are derived from the marker
	// in the spawn handler — see below.
	constructor(
		startPosition: Vector3,
		baseVelocity: Vector3,
		baseDamage: number,
		modifiers: ProjectileModifier[],
		owner: Player,
		color: Color3,
		platformVelocity: Vector3,
		firingBlock: Instance | undefined,
	) {
		super(
			startPosition,
			"KINETIC",
			WeaponProjectile.BULLET_PROJECTILE,
			baseVelocity,
			baseDamage,
			modifiers,
			owner,
			15, // lifetime (s): self-destruct on a miss so stray rounds don't leak forever
			color,
			platformVelocity,
		);
		// Bullets are fast and thin — sweep the path so they can't tunnel through walls.
		this.continuousCollision = true;
		this.ignoredRoot = firingBlock;

		// Tint the trail off the bullet colour: colour → black, opaque → transparent.
		const trail = (this.projectilePart as BasePart & { Trail: Trail }).Trail;
		trail.Color = new ColorSequence(color, new Color3(0, 0, 0));
		trail.Transparency = new NumberSequence(0, 1);
	}

	onHit(part: BasePart, point: Vector3): void {
		const startedWithSize = this.projectilePart.Size;
		this.projectilePart.AssemblyLinearVelocity = Vector3.zero;
		this.projectilePart.Anchored = true;
		this.projectilePart.CanCollide = false;
		this.projectilePart.CanTouch = false;
		this.disable();
		// Park the nose ON the impact point. The part's own CFrame is the post-physics position, which for a
		// fast round is already past whatever it hit — and offsetting forward from there pushed it further
		// still, so the bullet visibly vanished beyond the wall. `point` is the swept hit, so use that.
		this.projectilePart.Position = point.sub(this.projectilePart.CFrame.UpVector.mul(startedWithSize.Y / 2));

		super.onHit(part, point, true);
	}

	onTick(dt: number, percentage: number, reversePercentage: number): void {
		super.onTick(dt, percentage, reversePercentage);
	}
}
type SpawnArgs = {
	readonly originPart: BasePart;
	readonly baseDamage: number;
	readonly modifiers: ProjectileModifier[];
	readonly color: Color3;
};

/**
 * Replicates a shot through the effect system, so the server relays it and drops it per recipient on
 * `othersEffects` and the plot blacklist — none of which the previous bespoke C2C channel did.
 */
@injectable
export class BulletProjectileSpawner extends EffectBase<SpawnArgs> {
	static instance?: BulletProjectileSpawner;

	constructor(@inject creator: EffectCreator) {
		super(creator, "bullet_spawn", "RemoteEvent");
		BulletProjectileSpawner.instance = this;
	}

	override justRun({ originPart, baseDamage, modifiers, color }: SpawnArgs): void {
		const owner = WeaponProjectile.resolveOwner(originPart);
		if (!owner || !WeaponProjectile.shouldSpawnFor(owner.UserId)) return;

		// derive geometry from the marker (owner-exact; other clients use the replicated marker)
		const direction = originPart.GetPivot().RightVector.mul(-1);
		const firingBlock = originPart.FindFirstAncestorWhichIsA("Model");
		const platformVelocity = firingBlock?.PrimaryPart?.AssemblyLinearVelocity ?? Vector3.zero;
		new BulletProjectile(
			originPart.Position.add(direction),
			direction,
			baseDamage,
			modifiers,
			owner,
			color,
			platformVelocity,
			firingBlock,
		);
	}
}
