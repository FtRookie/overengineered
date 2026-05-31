import { Players, RunService, Workspace } from "@rbxts/services";
import { BlockDamageController } from "engine/shared/BlockDamageController";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { ReplicatedAssets } from "shared/ReplicatedAssets";
import type { damageType } from "engine/shared/BlockDamageController";

export type modifierValue = {
	isRelative?: boolean;
	value: number;
};

export type projectileModifier = Partial<
	Record<keyof damageType, modifierValue> & {
		speedModifier: modifierValue; //<-- velocity modifier
		lifetimeModifier: modifierValue; //<--- time modifier
	}
>;

/**
 * Apply an ordered list of modifiers to `base` for one stat (Balatro-style):
 *   isRelative === true  -> value *= mv.value
 *   isRelative === false -> value += mv.value
 * Order matters — `+5` then `×2` is `(base + 5) * 2`, not `(base + 5*2)`.
 */
export function applyModifiers(
	base: number,
	modifiers: readonly projectileModifier[],
	key: keyof projectileModifier,
): number {
	let value = base;
	for (const m of modifiers) {
		const mv = m[key];
		if (!mv) continue;
		value = mv.isRelative ? value * mv.value : value + mv.value;
	}
	return value;
}

export type baseWeaponProjectile = {
	Projectile: BasePart;
} & Model;

const CANNON_SHELL = ReplicatedAssets.waitForAsset<baseWeaponProjectile>("WeaponProjectiles", "ShellProjectile");
const PLASMA_BALL = ReplicatedAssets.waitForAsset<baseWeaponProjectile>("WeaponProjectiles", "PlasmaProjectile");
const BULLET = ReplicatedAssets.waitForAsset<baseWeaponProjectile>("WeaponProjectiles", "BulletProjectile");
const LASER = ReplicatedAssets.waitForAsset<baseWeaponProjectile>("WeaponProjectiles", "LaserProjectile");

const projectileFolder = new Instance("Folder", Workspace);
projectileFolder.Name = "Projectiles";

// Shared params for the continuous-collision sweep: ignore all projectiles (incl. the caster).
const projectileRaycastParams = new RaycastParams();
projectileRaycastParams.FilterType = Enum.RaycastFilterType.Exclude;
projectileRaycastParams.FilterDescendantsInstances = [projectileFolder];

export type DamageType = "KINETIC" | "EXPLOSIVE" | "ENERGY";

export class WeaponProjectile extends InstanceComponent<BasePart> {
	rawModifiers: projectileModifier[] = [];
	originalLifetime: number | undefined;
	modifiedLifetime: number | undefined;
	currentLifetime: number = 0;
	modifiedVelocity: Vector3;

	/** When true, sweep a ray along the path travelled each frame so fast projectiles can't
	 * tunnel through thin geometry between physics steps. Opt in from the subclass. */
	protected continuousCollision = false;
	private hasHit = false;
	private lastPosition: Vector3;

	readonly projectilePart: BasePart;
	readonly originalProjectileModel;
	static readonly SHELL_PROJECTILE: baseWeaponProjectile = CANNON_SHELL;
	static readonly PLASMA_PROJECTILE: baseWeaponProjectile = PLASMA_BALL;
	static readonly LASER_PROJECTILE: baseWeaponProjectile = LASER;
	static readonly BULLET_PROJECTILE: baseWeaponProjectile = BULLET;

	constructor(
		public startPosition: Vector3,
		readonly projectileType: DamageType,
		originalProjectileModel: baseWeaponProjectile,
		public baseVelocity: Vector3,
		public baseDamage: number,
		readonly baseModifiers: readonly projectileModifier[],
		/** The firing player. The projectile spawns on every client (C2C), but only the owner's
		 * copy applies damage — otherwise the server-side HP takes the hit once per player. */
		readonly owner: Player,
		lifetime?: number, //<--- seconds
		public color?: Color3,
	) {
		const pmodel: baseWeaponProjectile = originalProjectileModel.Clone();
		const newModel = pmodel.Projectile;
		newModel.Position = startPosition;
		newModel.CanCollide = false;
		newModel.CanTouch = true;
		newModel.Massless = true;
		//newModel.CollisionGroup = "Projectile";
		//newModel.EnableFluidForces = false;
		newModel.AssemblyLinearVelocity = baseVelocity;
		//transform projectile and shit
		//ELONgate the projectile to avoid clipping
		super(newModel);
		this.projectilePart = newModel;
		this.lastPosition = startPosition;
		this.originalLifetime = this.modifiedLifetime = lifetime;
		this.projectilePart.PivotTo(
			CFrame.lookAlong(this.projectilePart.Position, (this.modifiedVelocity = baseVelocity)),
		);
		this.originalProjectileModel = pmodel;
		if (color) pmodel.PrimaryPart!.Color = color;
		pmodel.Parent = projectileFolder;

		this.event.subscribe(this.projectilePart.Touched, (part) => {
			this.tryHit(part, this.projectilePart?.Position ?? part.Position);
		});
		this.event.subscribe(RunService.PostSimulation, (dt) => {
			if (this.continuousCollision) {
				this.sweepCollision();
				if (this.isDestroyed()) return;
			}

			const percentage = this.modifiedLifetime === undefined ? 0 : this.currentLifetime / this.modifiedLifetime;
			const reversePercentage = 1 - percentage;
			if (percentage >= 1) return this.destroy();
			this.onTick(dt, percentage, reversePercentage);
		});

		this.onDestroy(() => pmodel.Destroy());

		this.enable();
		recalculateEffects(this);

		const speedMag = applyModifiers(baseVelocity.Magnitude, this.allModifiers(), "speedModifier");
		if (baseVelocity.Magnitude > 0) {
			newModel.AssemblyLinearVelocity = baseVelocity.Unit.mul(speedMag);
		}
	}

	/** Funnel every collision source (Touched + the path sweep) through one guarded entry so a
	 * projectile only registers a single hit. */
	private tryHit(part: BasePart, point: Vector3) {
		if (this.hasHit) return;
		if (part.CollisionGroup === this.projectilePart.CollisionGroup) return;
		this.hasHit = true;
		this.onHit(part, point);
	}

	/** Raycast the segment travelled since last frame so a fast projectile can't skip past thin
	 * geometry between physics steps. */
	private sweepCollision() {
		if (this.hasHit) return;

		const from = this.lastPosition;
		const to = this.projectilePart.Position;
		this.lastPosition = to;

		const delta = to.sub(from);
		if (delta.Magnitude < 0.01) return;

		const result = Workspace.Raycast(from, delta, projectileRaycastParams);
		if (result) this.tryHit(result.Instance, result.Position);
	}

	allModifiers(): projectileModifier[] {
		return [...this.baseModifiers, ...this.rawModifiers];
	}

	addModifier(...modifiers: projectileModifier[]) {
		for (const mod of modifiers) this.rawModifiers.push(mod);
	}

	onHit(part: BasePart, point: Vector3, destroyOnHit = false): void {
		// Only the firing client deals damage (see `owner`) — the projectile exists on every client.
		if (!part.Anchored && !RunService.IsServer() && Players.LocalPlayer === this.owner) {
			applyDamageToPart(part, this.baseDamage, this.allModifiers());
		}
		if (destroyOnHit) this.destroy();
	}

	onTick(dt: number, percentage: number, reversePercentage: number): void {
		if (this.isDestroyed()) return;
		this.currentLifetime += dt;
		/* :thinking:
		this.projectilePart.CFrame = this.projectilePart.CFrame.add(
			this.modifiedVelocity.mul(new Vector3(dt, dt, dt)),
		);*/
	}
}

function recalculateEffects(projectile: WeaponProjectile) {
	if (projectile.originalLifetime !== undefined) {
		projectile.modifiedLifetime = applyModifiers(
			projectile.originalLifetime,
			projectile.allModifiers(),
			"lifetimeModifier",
		);
	}
}

function applyDamageToPart(part: BasePart, baseDamage: number, modifiers: readonly projectileModifier[]) {
	const controller = BlockDamageController.instance;
	if (!controller) return;

	const block = part.Parent;
	if (!block || !block.IsA("Model")) return;

	controller.applyDamage(block as BlockModel, {
		impactDamage: applyModifiers(baseDamage, modifiers, "impactDamage"),
		heatDamage: applyModifiers(0, modifiers, "heatDamage"),
		explosiveDamage: applyModifiers(0, modifiers, "explosiveDamage"),
	});
}

/*
	To fire something, you need:
	1. something to load ammo in
	- magazine
	- accumulator (laser, plasma)
	- gas tank (plasma)
	- rocket battery

	2. something to fire loaded
	3. something to modify fired
	
	kinetic: 
		magazine -> some loader (?) -> barrel -> nozzle -> world -> some sparks in the hit spots
		- different calibers?
	rocket:
		???
	
	bomb:
		built by player -> installed into holder -> released on command

	laser:
		acumulator -> emitter -> some lenses -> focal lens nozzle -> world -> light source until stopped firing

	plasma:
		??? -> emitter (?) -> accelerator magnet (?) -> nozzle -> world -> flash of colored light on hit
		- Strength depends on distance traveled from the emitter 
*/
