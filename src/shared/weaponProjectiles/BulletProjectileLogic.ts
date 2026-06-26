import { C2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { WeaponProjectile } from "shared/weaponProjectiles/BaseProjectileLogic";
import type { projectileModifier } from "shared/weaponProjectiles/BaseProjectileLogic";

export class BulletProjectile extends WeaponProjectile {
	// startPosition / baseVelocity / firingBlock / platformVelocity are derived from the marker
	// in the spawn handler — see below.
	static readonly spawnProjectile = new C2CRemoteEvent<{
		readonly originPart: BasePart;
		readonly baseDamage: number;
		readonly modifiers: projectileModifier[];
		readonly owner: Player;
		readonly color: Color3;
	}>("bullet_spawn", "RemoteEvent");

	constructor(
		startPosition: Vector3,
		baseVelocity: Vector3,
		baseDamage: number,
		modifiers: projectileModifier[],
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
		this.projectilePart.Position = this.projectilePart.CFrame.PointToWorldSpace(
			new Vector3(0, startedWithSize.Y / 2, 0),
		);

		super.onHit(part, point, true);
	}

	onTick(dt: number, percentage: number, reversePercentage: number): void {
		super.onTick(dt, percentage, reversePercentage);
	}
}
BulletProjectile.spawnProjectile.invoked.Connect(({ originPart, baseDamage, modifiers, owner, color }) => {
	if (!WeaponProjectile.shouldSpawn(owner)) return;

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
});
