import { C2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { WeaponProjectile } from "shared/weaponProjectiles/BaseProjectileLogic";
import type { projectileModifier } from "shared/weaponProjectiles/BaseProjectileLogic";

export class BulletProjectile extends WeaponProjectile {
	static readonly spawnProjectile = new C2CRemoteEvent<{
		readonly startPosition: Vector3;
		readonly baseVelocity: Vector3;
		readonly baseDamage: number;
		readonly modifiers: projectileModifier[];
	}>("bullet_spawn", "RemoteEvent");

	constructor(startPosition: Vector3, baseVelocity: Vector3, baseDamage: number, modifiers: projectileModifier[]) {
		super(startPosition, "KINETIC", WeaponProjectile.BULLET_PROJECTILE, baseVelocity, baseDamage, modifiers);
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
BulletProjectile.spawnProjectile.invoked.Connect(({ startPosition, baseVelocity, baseDamage, modifiers }) => {
	print("Bullet spawned");
	new BulletProjectile(startPosition, baseVelocity, baseDamage, modifiers);
});
