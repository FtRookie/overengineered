import { RunService } from "@rbxts/services";
import type { ComponentEvents } from "engine/shared/component/ComponentEvents";
import type { ModuleCollection, WeaponModule } from "shared/weaponProjectiles/WeaponModuleSystem";

/** Minimal surface a weapon emitter block logic exposes to the marker controller. */
type WeaponEmitterLogic = {
	readonly instance: BlockModel;
	readonly event: ComponentEvents;
};

/**
 * Shared marker lifecycle for weapon emitter blocks (laser / cannon / machine gun / plasma).
 *
 * Output markers are anchored and hidden while in ride mode, so physics never moves them —
 * instead this re-pins each one every frame to the pivot of the block it physically belongs
 * to. Centralises the boilerplate that used to be copy-pasted into all four emitter blocks.
 *
 * Markers aren't restored on disable on purpose: the block model is fully regenerated from
 * the prefab on ride→build, bringing fresh visible markers, and restoring mid-ride (e.g. on
 * a GARBAGE disable) would flash anchored markers back into view.
 */
export class WeaponMarkerController {
	readonly collection: ModuleCollection;
	/** Outputs grouped by emitter module, each with its ordered modifier list. */
	readonly outputs: ModuleCollection["calculatedOutputs"];

	constructor(logic: WeaponEmitterLogic, module: WeaponModule) {
		this.collection = module.parentCollection;
		this.outputs = this.collection.calculatedOutputs;

		// Anchor + hide markers for the duration of ride mode.
		this.collection.setMarkersVisibility(false);

		// Capture each marker's offset relative to the block that OWNS it (e.module.instance),
		// not the firing emitter — markers on an articulated barrel must track their own block
		// or projectiles fire off-axis when the turret turns.
		const relativeOuts = new Map<BasePart, CFrame>();
		for (const e of this.collection.calculatedOutputs) {
			const pivot = e.module.instance.GetPivot();
			for (const o of e.outputs) {
				relativeOuts.set(o.markerInstance, pivot.ToObjectSpace(o.markerInstance.CFrame));
			}
		}

		logic.event.subscribe(RunService.PostSimulation, () => {
			for (const e of this.collection.calculatedOutputs) {
				const pivot = e.module.instance.GetPivot();
				for (const o of e.outputs) {
					const rel = relativeOuts.get(o.markerInstance);
					// Guard: a recalc() during ride mode can add markers we never captured —
					// skip them this frame instead of crashing on a missing offset.
					if (rel === undefined) continue;
					o.markerInstance.PivotTo(pivot.ToWorldSpace(rel));
				}
			}
		});
	}
}
