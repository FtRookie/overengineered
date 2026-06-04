import { Players } from "@rbxts/services";
import { C2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { RemoteEvents } from "shared/RemoteEvents";
import { WeaponProjectile } from "shared/weaponProjectiles/BaseProjectileLogic";
import type { projectileModifier } from "shared/weaponProjectiles/BaseProjectileLogic";

// Balance TODO — placeholder blast values until weapons get tuned.
const SHELL_EXPLOSION_RADIUS = 8;
const SHELL_EXPLOSION_PRESSURE = 1200;

export class ShellProjectile extends WeaponProjectile {
	static readonly spawnProjectile = new C2CRemoteEvent<{
		readonly startPosition: Vector3;
		readonly baseVelocity: Vector3;
		readonly baseDamage: number;
		readonly modifiers: projectileModifier[];
		readonly owner: Player;
	}>("shell_spawn", "RemoteEvent");

	constructor(
		startPosition: Vector3,
		baseVelocity: Vector3,
		baseDamage: number,
		modifiers: projectileModifier[],
		owner: Player,
	) {
		// lifetime (s): self-destruct on a miss so stray shells don't leak forever
		super(
			startPosition,
			"KINETIC",
			WeaponProjectile.SHELL_PROJECTILE,
			baseVelocity,
			baseDamage,
			modifiers,
			owner,
			15,
		);
		// Cannon shells move fast — sweep the path so they can't tunnel through walls.
		this.continuousCollision = true;
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

		// The projectile is spawned on every client (C2C broadcast); only the firing client
		// asks the server to detonate, so the explosion happens exactly once. The server applies
		// the radial damage (covering the directly-hit block too) plus the physics/visual blast.
		if (Players.LocalPlayer === this.owner) {
			RemoteEvents.ExplodeAt.send({
				position: point,
				radius: SHELL_EXPLOSION_RADIUS,
				pressure: SHELL_EXPLOSION_PRESSURE,
				isFlammable: false,
			});
		}

		this.destroy();
	}

	onTick(dt: number, percentage: number, reversePercentage: number): void {
		super.onTick(dt, percentage, reversePercentage);
	}
}
ShellProjectile.spawnProjectile.invoked.Connect(({ startPosition, baseVelocity, baseDamage, modifiers, owner }) => {
	new ShellProjectile(startPosition, baseVelocity, baseDamage, modifiers, owner);
});
