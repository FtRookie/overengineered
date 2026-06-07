import { Players, Workspace } from "@rbxts/services";
import { C2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { WeaponProjectile } from "shared/weaponProjectiles/BaseProjectileLogic";
import type { baseWeaponProjectile, projectileModifier } from "shared/weaponProjectiles/BaseProjectileLogic";

type laserVisualsAmountConstant = 1 | 2 | 3 | 4 | 5;
type laser = baseWeaponProjectile & Record<`LaserProjectileVisual${laserVisualsAmountConstant}`, BasePart>;

const projectileFolder = Workspace.FindFirstChild("Projectiles") ?? new Instance("Folder", Workspace);
projectileFolder.Name = "Projectiles";

export class LaserProjectile extends WeaponProjectile {
	static projectileMap = new Map<Instance, LaserProjectile>();
	static readonly spawnProjectile = new C2CRemoteEvent<{
		readonly color: Color3;
		readonly originPart: BasePart;
		readonly baseDamage: number;
		readonly modifiers: projectileModifier[];
		readonly owner: Player;
	}>("laser_spawn", "RemoteEvent");

	static readonly destroyProjectile = new C2CRemoteEvent<{
		readonly originPart: BasePart;
	}>("laser_destroy", "RemoteEvent");

	private detectionlessSize = new Vector3(1024, this.projectilePart.Size.Y, this.projectilePart.Size.Z);
	private laserModel: BasePart[] = [];
	private damage;
	// Per-beam params (like BaseProjectile, exclude the Projectiles folder; plus this beam's own emitter).
	// Per-instance and set once — freed with the projectile, so the exclude list never grows for the session.
	private readonly raycastParams = new RaycastParams();

	constructor(
		private originPart: BasePart,
		baseDamage: number,
		modifiers: projectileModifier[],
		color: Color3,
		owner: Player,
	) {
		super(
			originPart.CFrame.Position,
			"ENERGY",
			WeaponProjectile.LASER_PROJECTILE,
			originPart.Rotation,
			baseDamage,
			modifiers,
			owner,
		);
		this.projectilePart.Transparency = 1;
		this.projectilePart.Size = Vector3.one;
		this.damage = this.baseDamage;
		const p = this.originalProjectileModel as laser;
		for (let i = 1; i <= 5; i++) {
			const pr = p[`LaserProjectileVisual${i as laserVisualsAmountConstant}`];
			this.laserModel.push(pr);
			pr.Color = color;
		}
		this.raycastParams.FilterType = Enum.RaycastFilterType.Exclude;
		this.raycastParams.FilterDescendantsInstances = [projectileFolder, originPart];

		// Never let the static registry retain a dead laser.
		this.onDestroy(() => LaserProjectile.projectileMap.delete(this.originPart));
	}

	onTick(dt: number, percentage: number, reversePercentage: number): void {
		// destroyProjectile is client-sent, so a leaving owner never sends it — self-destruct when the
		// owner is gone (Parent nil once removed from Players) or the marker vanished (block broke, mode change).
		if (this.owner.Parent === undefined || !this.originPart.IsDescendantOf(Workspace)) return this.destroy();

		const pivo = this.originPart.GetPivot();
		const forwardVector = pivo.XVector.mul(-1);
		this.startPosition = pivo.Position;

		let res;
		let iter = 0;
		const length = this.laserModel.size();
		for (iter = 0; iter < length; iter++) {
			const posOffset = 1024 * iter;
			// Cast from this segment's start, not the origin — else detection dies past 1023 studs.
			this.projectilePart.PivotTo(pivo.add(forwardVector.mul(posOffset)));
			res = Workspace.Shapecast(this.projectilePart, forwardVector.mul(1023), this.raycastParams);
			this.laserModel[iter].Transparency = 0;
			this.laserModel[iter].PivotTo(this.projectilePart.CFrame);
			if (res === undefined) {
				this.laserModel[iter].Size = this.detectionlessSize;
				this.laserModel[iter].Position = forwardVector.mul(512 + posOffset).add(this.startPosition);
				continue;
			}

			this.laserModel[iter].Size = new Vector3(
				res.Distance,
				this.projectilePart.Size.Y,
				this.projectilePart.Size.Z,
			);
			this.laserModel[iter].Position = forwardVector.mul(res.Distance / 2 + posOffset).add(this.startPosition);
			break;
		}

		// Hide the segments past the active range. `iter` is the segment the beam stopped on
		// (a hit), or `length` if it reached open space — in which case iter+1 is out of range and
		// nothing is hidden. The `i < length` bound already guards the array, so no clamp is needed
		// (the old math.min clamp wrongly hid the last segment when firing into the void).
		for (let i = iter + 1; i < length; i++) this.laserModel[i].Transparency = 1;

		//deal damage
		if (res && Players.LocalPlayer === this.owner) {
			this.baseDamage = this.damage * dt;
			super.onHit(res.Instance, res.Position);
		}
		super.onTick(dt, percentage, reversePercentage);
	}
}

// fixme: SECURITY — spawn/destroy arrive over a raw C2CRemoteEvent that the server relays unvalidated:
// nothing checks that the sender owns `originPart`'s block or that `owner === sender`. A crafted client can
// forge a payload to spawn a damaging laser at any part (e.g. a victim's emitter). Harden via a
// server-validated channel (ServerBlockLogic / C2S→S2C) before trusting originPart/owner. This is NOT the
// cause of the cross-owner firing bug (that's WeaponModuleSystem.update) but a real authority gap — the same
// gap exists in the Bullet/Shell/Plasma spawn events.
LaserProjectile.spawnProjectile.invoked.Connect(({ color, originPart, baseDamage, modifiers, owner }) => {
	const v = LaserProjectile.projectileMap.get(originPart);
	if (v !== undefined) {
		v.destroy();
		LaserProjectile.projectileMap.delete(originPart);
	}
	LaserProjectile.projectileMap.set(originPart, new LaserProjectile(originPart, baseDamage, modifiers, color, owner));
});

LaserProjectile.destroyProjectile.invoked.Connect(({ originPart }) => {
	const v = LaserProjectile.projectileMap.get(originPart);
	if (v !== undefined) {
		v.destroy();
		LaserProjectile.projectileMap.delete(originPart);
	}
});
