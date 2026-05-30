import { Workspace } from "@rbxts/services";
import { Easing } from "engine/shared/component/Easing";
import { C2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { WeaponProjectile } from "shared/weaponProjectiles/BaseProjectileLogic";
import type { modifierValue, projectileModifier } from "shared/weaponProjectiles/BaseProjectileLogic";

type palsmaProjectile = BasePart & { VectorForce: VectorForce };

export class PlasmaProjectile extends WeaponProjectile {
	private startSize = this.projectilePart.Size;
	private readonly vectorForce: VectorForce;
	static readonly spawnProjectile = new C2CRemoteEvent<{
		readonly startPosition: Vector3;
		readonly baseVelocity: Vector3;
		readonly baseDamage: number;
		readonly modifiers: projectileModifier[];
		readonly color?: Color3;
	}>("plasma_spawn", "RemoteEvent");

	constructor(
		startPosition: Vector3,
		baseVelocity: Vector3,
		baseDamage: number,
		modifiers: projectileModifier[],
		color?: Color3,
	) {
		super(
			startPosition,
			"ENERGY",
			WeaponProjectile.PLASMA_PROJECTILE,
			baseVelocity,
			baseDamage,
			modifiers,
			5,
			color,
		);

		// Base sets Massless=true on every projectile; for plasma we need a real Mass so
		// the VectorForce in onTick can cancel gravity (F = Mass * Gravity).
		this.projectilePart.Massless = false;

		this.vectorForce = (this.projectilePart as unknown as palsmaProjectile).VectorForce;
		// Defensive — ensure the force fires in world space, not in the projectile's local
		// frame (otherwise the "up" axis rotates with the part's lookAlong orientation).
		this.vectorForce.RelativeTo = Enum.ActuatorRelativeTo.World;
		this.vectorForce.ApplyAtCenterOfMass = true;
		this.vectorForce.Enabled = true;
		// Apply the cancellation force NOW so the very first physics step is already
		// balanced — otherwise gravity acts unopposed for the few frames until onTick runs
		// and eats a chunk of the initial velocity.
		this.vectorForce.Force = new Vector3(0, this.projectilePart.AssemblyMass * Workspace.Gravity, 0);

		this.updateLifetimeModifier(1);
	}

	/**
	 * The projectile gets weaker with time!
	 */
	private updateLifetimeModifier(percentage: number) {
		const nv: modifierValue = { value: percentage, isRelative: true };
		this.rawModifiers[0] = {
			speedModifier: nv,
			heatDamage: nv,
			impactDamage: nv,
			explosiveDamage: nv,
		};
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
		//point === hit position (at least should be)

		task.spawn(() => {
			const time = 0.7;
			const startTime = os.clock() / time;
			while (startTime > os.clock() / time - 1) {
				const sz = Easing.ease(os.clock() / time - startTime, "Quint", "Out");
				const revSz = 1 - sz;
				this.projectilePart.Transparency = math.sqrt(sz);
				this.projectilePart.Size = new Vector3(
					sz * startedWithSize.Y,
					math.max(revSz * startedWithSize.Y, 0.1),
					sz * startedWithSize.Y,
				);
				task.wait();
			}

			this.destroy();
		});

		super.onHit(part, point);
	}

	onTick(dt: number, percentage: number, reversePercentage: number): void {
		super.onTick(dt, percentage, reversePercentage);
		//this.projectilePart.AssemblyLinearVelocity = this.baseVelocity;
		this.projectilePart.Transparency = percentage;
		this.updateLifetimeModifier(reversePercentage);
		this.projectilePart.Size = this.startSize.mul(new Vector3(1, 1 + this.baseVelocity.Magnitude / 100, 1));
		// AssemblyMass covers the case where the projectile is a multi-part model — the
		// VectorForce attached to one part needs to cancel gravity for the entire assembly.
		this.vectorForce.Force = new Vector3(0, this.projectilePart.AssemblyMass * Workspace.Gravity, 0);
	}
}

PlasmaProjectile.spawnProjectile.invoked.Connect(({ startPosition, baseVelocity, baseDamage, modifiers, color }) => {
	print("Plasma ball spawned");
	new PlasmaProjectile(startPosition, baseVelocity, baseDamage, modifiers, color);
});
