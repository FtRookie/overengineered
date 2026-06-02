import { Workspace } from "@rbxts/services";
import { Easing } from "engine/shared/component/Easing";
import { C2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { WeaponProjectile } from "shared/weaponProjectiles/BaseProjectileLogic";
import type { modifierValue, projectileModifier } from "shared/weaponProjectiles/BaseProjectileLogic";

type PlasmaModel = BasePart & { VectorForce: VectorForce };

export class PlasmaProjectile extends WeaponProjectile {
	private startSize = this.projectilePart.Size;
	private readonly vectorForce: VectorForce;
	// Shared, pre-allocated decay value — every damage key points at it, so onTick mutates one
	// number instead of allocating a fresh modifier table each frame.
	private readonly decayValue: modifierValue = { value: 1, isRelative: true };
	static readonly spawnProjectile = new C2CRemoteEvent<{
		readonly startPosition: Vector3;
		readonly baseVelocity: Vector3;
		readonly baseDamage: number;
		readonly modifiers: projectileModifier[];
		readonly owner: Player;
		readonly color?: Color3;
	}>("plasma_spawn", "RemoteEvent");

	constructor(
		startPosition: Vector3,
		baseVelocity: Vector3,
		baseDamage: number,
		modifiers: projectileModifier[],
		owner: Player,
		color?: Color3,
	) {
		super(
			startPosition,
			"ENERGY",
			WeaponProjectile.PLASMA_PROJECTILE,
			baseVelocity,
			baseDamage,
			modifiers,
			owner,
			5,
			color,
		);

		this.projectilePart.Massless = false;

		this.vectorForce = (this.projectilePart as PlasmaModel).VectorForce;
		// Defensive — ensure the force fires in world space, not in the projectile's local
		// frame (otherwise the "up" axis rotates with the part's lookAlong orientation).
		this.vectorForce.RelativeTo = Enum.ActuatorRelativeTo.World;
		this.vectorForce.ApplyAtCenterOfMass = true;
		this.vectorForce.Enabled = true;

		// Cancel gravity so the plasma flies straight
		const applyGravityCancel = () =>
			(this.vectorForce.Force = new Vector3(0, this.projectilePart.AssemblyMass * Workspace.Gravity, 0));

		applyGravityCancel();
		this.event.subscribe(Workspace.GetPropertyChangedSignal("Gravity"), applyGravityCancel);

		// Elongate the ball along its travel axis by speed — constant per projectile
		this.projectilePart.Size = this.startSize.mul(new Vector3(1, 1 + baseVelocity.Magnitude / 100, 1));

		// The projectile weakens over its lifetime
		this.rawModifiers[0] = {
			heatDamage: this.decayValue,
			impactDamage: this.decayValue,
			explosiveDamage: this.decayValue,
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
		// Fade out over the lifetime and keep the shared decay value
		this.projectilePart.Transparency = percentage;
		this.decayValue.value = reversePercentage;
	}
}

PlasmaProjectile.spawnProjectile.invoked.Connect(
	({ startPosition, baseVelocity, baseDamage, modifiers, owner, color }) => {
		new PlasmaProjectile(startPosition, baseVelocity, baseDamage, modifiers, owner, color);
	},
);
