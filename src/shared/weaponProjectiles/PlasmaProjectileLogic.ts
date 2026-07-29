import { RunService, Workspace } from "@rbxts/services";
import { Easing } from "engine/shared/component/Easing";
import { EventHandler } from "engine/shared/event/EventHandler";
import { EffectBase } from "shared/effects/EffectBase";
import { WeaponProjectile } from "shared/weaponProjectiles/BaseProjectileLogic";
import type { EffectCreator } from "shared/effects/EffectBase";
import type { ModifierValue, ProjectileModifier } from "shared/weaponProjectiles/BaseProjectileLogic";

type PlasmaModel = BasePart & { VectorForce: VectorForce };

export class PlasmaProjectile extends WeaponProjectile {
	private startSize = this.projectilePart.Size;
	private readonly vectorForce: VectorForce;
	// Shared, pre-allocated decay value — every damage key points at it, so onTick mutates one
	// number instead of allocating a fresh modifier table each frame.
	private readonly decayValue: ModifierValue = { value: 1, isRelative: true };
	constructor(
		startPosition: Vector3,
		baseVelocity: Vector3,
		baseDamage: number,
		modifiers: ProjectileModifier[],
		owner: Player,
		firingBlock: BlockModel,
		color?: Color3,
		platformVelocity: Vector3 = Vector3.zero,
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
			platformVelocity,
		);

		this.ignoredRoot = firingBlock;
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

		// Driven off a connection rather than a task.spawn loop: the loop wrote to the part across
		// task.wait() with nothing checking whether the projectile had been destroyed in between. The
		// handler is cleared on destroy, so the animation cannot outlive what it is animating.
		const fade = new EventHandler();
		this.onDestroy(() => fade.unsubscribeAll());

		const duration = 0.7;
		const startTime = os.clock();
		fade.subscribe(RunService.PostSimulation, () => {
			const alpha = (os.clock() - startTime) / duration;
			if (alpha >= 1) {
				fade.unsubscribeAll();
				this.destroy();
				return;
			}

			const sz = Easing.ease(alpha, "Quint", "Out");
			this.projectilePart.Transparency = math.sqrt(sz);
			this.projectilePart.Size = new Vector3(
				sz * startedWithSize.Y,
				math.max((1 - sz) * startedWithSize.Y, 0.1),
				sz * startedWithSize.Y,
			);
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

type SpawnArgs = {
	readonly originPart: BasePart;
	readonly startPosition: Vector3;
	readonly baseVelocity: Vector3;
	readonly baseDamage: number;
	readonly modifiers: ProjectileModifier[];
	readonly color?: Color3;
	readonly platformVelocity?: Vector3;
	readonly firingBlock: BlockModel;
};

/** See BulletProjectileSpawner — same reasoning, same server-side filtering. */
@injectable
export class PlasmaProjectileSpawner extends EffectBase<SpawnArgs> {
	static instance?: PlasmaProjectileSpawner;

	constructor(@inject creator: EffectCreator) {
		super(creator, "plasma_spawn", "RemoteEvent");
		PlasmaProjectileSpawner.instance = this;
	}

	override justRun({
		originPart,
		startPosition,
		baseVelocity,
		baseDamage,
		modifiers,
		color,
		platformVelocity,
		firingBlock,
	}: SpawnArgs): void {
		const owner = WeaponProjectile.resolveOwner(originPart);
		if (!owner || !WeaponProjectile.shouldSpawnFor(owner.UserId)) return;

		new PlasmaProjectile(
			startPosition,
			baseVelocity,
			baseDamage,
			modifiers,
			owner,
			firingBlock,
			color,
			platformVelocity,
		);
	}
}
