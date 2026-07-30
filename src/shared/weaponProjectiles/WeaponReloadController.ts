import { RunService } from "@rbxts/services";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { ComponentEvents } from "engine/shared/component/ComponentEvents";

/** Minimal surface the reload gate needs from a weapon block logic. */
type WeaponReloadLogic = {
	readonly event: ComponentEvents;
};

/** Fire-rate gate for a weapon block; no `fireRate` = always loaded. */
export class WeaponReloadController {
	readonly loaded = new ObservableValue<boolean>(true);
	/** Seconds between shots, derived from the shots-per-second fire rate. Undefined ⇒ no limit. */
	private readonly interval: number | undefined;
	private nextReady = 0;

	constructor(logic: WeaponReloadLogic, fireRate: number | undefined) {
		this.interval = fireRate === undefined ? undefined : 1 / fireRate;
		if (this.interval === undefined) return;
		// Flip back to loaded once the cooldown elapses (the get() check is a cheap no-op when loaded).
		logic.event.subscribe(RunService.PostSimulation, () => {
			if (!this.loaded.get() && time() >= this.nextReady) this.loaded.set(true);
		});
	}

	/** True (and starts the cooldown) when ready; false while reloading. */
	tryFire(): boolean {
		if (this.interval === undefined) return true;
		if (time() < this.nextReady) return false;
		this.nextReady = time() + this.interval;
		this.loaded.set(false);
		return true;
	}
}
