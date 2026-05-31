import { BlockPulse } from "client/BlockPulse";
import { HostedService } from "engine/shared/di/HostedService";
import { BlockManager } from "shared/building/BlockManager";
import { WeaponModule } from "shared/weaponProjectiles/WeaponModuleSystem";
import type { PlayerDataStorageRemotesBuilding } from "shared/remotes/PlayerDataRemotes";

/**
 * Build-mode flourish: when the local player places weapon blocks, a pulse ripples across the whole
 * connected weapon group they belong to, visualising the assembly (see {@link BlockPulse}).
 *
 * Reuses the connection groups the WeaponModuleSystem already computes (`parentCollection.modules`)
 * rather than re-deriving connectivity. Driven by the placement remote's client-side `completed`
 * signal, so it fires once per placement, only for the local player, never on world load.
 */
@injectable
export class BlockConnectionPulseController extends HostedService {
	constructor(@inject building: PlayerDataStorageRemotesBuilding) {
		super();

		this.event.subscribe(building.placeBlocks.completed, (result) => {
			if (!result.success) return;

			const models = result.models;
			if (models.isEmpty()) return;

			// Origin = centroid of the placed blocks (GetPivot works before colboxes stream in).
			let sum = Vector3.zero;
			for (const m of models) sum = sum.add(m.GetPivot().Position);
			const origin = sum.div(models.size());

			// Let the weapon system register the new modules and recompute their groups first.
			task.delay(0.06, () => this.pulseWeaponGroups(models, origin));
		});
	}

	private pulseWeaponGroups(models: readonly BlockModel[], origin: Vector3) {
		// Union of the connected weapon groups the placed blocks belong to.
		const modules = new Set<WeaponModule>();
		for (const model of models) {
			const module = WeaponModule.allModules[BlockManager.manager.uuid.get(model)];
			if (!module) continue;
			for (const m of module.parentCollection.modules) modules.add(m);
		}
		if (modules.isEmpty()) return; // no weapons in this placement

		const parts: BasePart[] = [];
		for (const m of modules) {
			const part = m.instance.PrimaryPart;
			if (part) parts.push(part);
		}

		// Ripple across the entire connected group — no radius limit.
		BlockPulse.wave(parts, origin, { maxRadius: math.huge });
	}
}
