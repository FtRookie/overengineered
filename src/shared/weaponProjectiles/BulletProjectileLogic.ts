import { C2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { WeaponProjectile } from "shared/weaponProjectiles/BaseProjectileLogic";
import type { projectileModifier } from "shared/weaponProjectiles/BaseProjectileLogic";

export class BulletProjectile extends WeaponProjectile {
	static readonly spawnProjectile = new C2CRemoteEvent<{
		readonly startPosition: Vector3;
		readonly baseVelocity: Vector3;
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
	) {
		super(
			startPosition,
			"KINETIC",
			WeaponProjectile.BULLET_PROJECTILE,
			baseVelocity,
			baseDamage,
			modifiers,
			owner,
			undefined,
			color,
		);
		// Bullets are fast and thin — sweep the path so they can't tunnel through walls.
		this.continuousCollision = true;

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
BulletProjectile.spawnProjectile.invoked.Connect(
	({ startPosition, baseVelocity, baseDamage, modifiers, owner, color }) => {
		new BulletProjectile(startPosition, baseVelocity, baseDamage, modifiers, owner, color);
	},
);
