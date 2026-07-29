import { BulletProjectileSpawner } from "shared/weaponProjectiles/BulletProjectileLogic";
import { LaserProjectileSpawner } from "shared/weaponProjectiles/LaserProjectileLogic";
import { PlasmaProjectileSpawner } from "shared/weaponProjectiles/PlasmaProjectileLogic";
import { ShellProjectileSpawner } from "shared/weaponProjectiles/ShellProjectileLogic";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";

/**
 * Weapon fire goes through the effect system like every other effect, so the server relays it and drops it
 * per recipient on `othersEffects` and the plot blacklist.
 *
 * Registered here rather than alongside the others in RemoteEvents.initializeVisualEffects: ShellProjectile
 * imports RemoteEvents for its blast, so registering it from there closes a cycle.
 */
export namespace WeaponEffects {
	export function initialize(host: GameHostBuilder) {
		host.services.registerSingletonClass(BulletProjectileSpawner).autoInit();
		host.services.registerSingletonClass(ShellProjectileSpawner).autoInit();
		host.services.registerSingletonClass(PlasmaProjectileSpawner).autoInit();
		host.services.registerSingletonClass(LaserProjectileSpawner).autoInit();
	}
}
