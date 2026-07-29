import { A2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { ExplosionEffect } from "shared/effects/ExplosionEffect";
import { FireEffect } from "shared/effects/FireEffect";
import { HeatGlowEffect } from "shared/effects/HeatGlowEffect";
import { ImpactSoundEffect } from "shared/effects/ImpactSoundEffect";
import { ParticleEffect } from "shared/effects/ParticleEffect";
import { SoundEffect } from "shared/effects/SoundEffect";
import { SparksEffect } from "shared/effects/SparksEffect";
import { VaporConeEffect } from "shared/effects/VaporConeEffect";
import { BulletProjectileSpawner } from "shared/weaponProjectiles/BulletProjectileLogic";
import { LaserProjectileSpawner } from "shared/weaponProjectiles/LaserProjectileLogic";
import { PlasmaProjectileSpawner } from "shared/weaponProjectiles/PlasmaProjectileLogic";
import { ShellProjectileSpawner } from "shared/weaponProjectiles/ShellProjectileLogic";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";

export type ExplodeArgs = {
	readonly part: BasePart;
	readonly radius: number;
	readonly pressure: number;
	readonly isFlammable: boolean;
};

export type ExplodeAtArgs = {
	readonly position: Vector3;
	readonly radius: number;
	readonly pressure: number;
	readonly isFlammable: boolean;
};

export type ExtinguishArgs = {
	readonly part: BasePart;
	readonly radius: number;
	readonly sound?: Sound;
	readonly particle?: ParticleEmitter;
};

export namespace RemoteEvents {
	export function initializeVisualEffects(host: GameHostBuilder) {
		host.services.registerSingletonClass(SparksEffect).autoInit();
		host.services.registerSingletonClass(ImpactSoundEffect).autoInit();
		host.services.registerSingletonClass(ExplosionEffect).autoInit();
		host.services.registerSingletonClass(FireEffect).autoInit();
		host.services.registerSingletonClass(HeatGlowEffect).autoInit();
		host.services.registerSingletonClass(SoundEffect).autoInit();
		host.services.registerSingletonClass(ParticleEffect).autoInit();
		host.services.registerSingletonClass(VaporConeEffect).autoInit();

		// Weapon fire goes through the effect system like everything else, so the server relays it and drops
		// it per recipient on othersEffects and the plot blacklist.
		host.services.registerSingletonClass(BulletProjectileSpawner).autoInit();
		host.services.registerSingletonClass(ShellProjectileSpawner).autoInit();
		host.services.registerSingletonClass(PlasmaProjectileSpawner).autoInit();
		host.services.registerSingletonClass(LaserProjectileSpawner).autoInit();
	}

	export const Burn = new A2SRemoteEvent<BasePart[]>("burn");
	export const ImpactBreak = new A2SRemoteEvent<BasePart[]>("impact_break");
	export const Explode = new A2SRemoteEvent<ExplodeArgs>("explode");
	export const ExplodeAt = new A2SRemoteEvent<ExplodeAtArgs>("explode_at");
	export const Extinguish = new A2SRemoteEvent<ExtinguishArgs>("extinguish");

	// empty method just to trigger the constructors
	export function initialize() {}
}
