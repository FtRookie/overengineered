import { Players } from "@rbxts/services";
import { EffectBase } from "shared/effects/EffectBase";
import { RemoteEvents } from "shared/RemoteEvents";
import { WeaponProjectile } from "shared/weaponProjectiles/BaseProjectileLogic";
import type { EffectCreator } from "shared/effects/EffectBase";
import type { ProjectileModifier } from "shared/weaponProjectiles/BaseProjectileLogic";

/** Used only when the emitting block declares no blast of its own — a bare breech. */
const FALLBACK_BLAST = { radius: 8, pressure: 1200 } as const;

export class ShellProjectile extends WeaponProjectile {
	// startPosition / baseVelocity / firingBlock / platformVelocity are all derived from the marker
	// in the spawn handler — see below.
	constructor(
		startPosition: Vector3,
		baseVelocity: Vector3,
		baseDamage: number,
		modifiers: ProjectileModifier[],
		owner: Player,
		platformVelocity: Vector3,
		firingBlock: Instance | undefined,
		private readonly blast: { readonly radius: number; readonly pressure: number } = FALLBACK_BLAST,
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
			undefined,
			platformVelocity,
		);
		// Cannon shells move fast — sweep the path so they can't tunnel through walls.
		this.continuousCollision = true;
		this.ignoredRoot = firingBlock;
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
				radius: this.blast.radius,
				pressure: this.blast.pressure,
				isFlammable: false,
			});
		}

		this.destroy();
	}

	onTick(dt: number, percentage: number, reversePercentage: number): void {
		super.onTick(dt, percentage, reversePercentage);
	}
}
type SpawnArgs = {
	readonly originPart: BasePart;
	readonly baseDamage: number;
	readonly modifiers: ProjectileModifier[];
	/** Comes from the emitting block, so calibre decides the blast rather than one shared constant. */
	readonly blast?: { readonly radius: number; readonly pressure: number };
};

/** See BulletProjectileSpawner — same reasoning, same server-side filtering. */
@injectable
export class ShellProjectileSpawner extends EffectBase<SpawnArgs> {
	static instance?: ShellProjectileSpawner;

	constructor(@inject creator: EffectCreator) {
		super(creator, "shell_spawn", "RemoteEvent");
		ShellProjectileSpawner.instance = this;
	}

	override justRun({ originPart, baseDamage, modifiers, blast }: SpawnArgs): void {
		const owner = WeaponProjectile.resolveOwner(originPart);
		if (!owner || !WeaponProjectile.shouldSpawnFor(owner.UserId)) return;

		// derive geometry from the marker (owner-exact; other clients use the replicated marker)
		const direction = originPart.GetPivot().RightVector.mul(-1);
		const firingBlock = originPart.FindFirstAncestorWhichIsA("Model");
		const platformVelocity = firingBlock?.PrimaryPart?.AssemblyLinearVelocity ?? Vector3.zero;
		new ShellProjectile(
			originPart.Position.add(direction),
			direction,
			baseDamage,
			modifiers,
			owner,
			platformVelocity,
			firingBlock,
			blast,
		);
	}
}
