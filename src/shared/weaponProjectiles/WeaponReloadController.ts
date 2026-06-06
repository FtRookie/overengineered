import { RunService } from "@rbxts/services";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { ComponentEvents } from "engine/shared/component/ComponentEvents";

/** Minimal surface the reload gate needs from a weapon block logic. */
type WeaponReloadLogic = {
	readonly event: ComponentEvents;
};

/**
 * Per-weapon fire-rate gate, owned by a weapon block's logic. `loaded` is exposed (observable) so the
 * logic, a block output, or reload UI can react to it; `tryFire()` consumes a shot and starts the
 * cooldown. With no `fireDelay` the gate is inert — always loaded, every shot allowed.
 */
export class WeaponReloadController {
	readonly loaded = new ObservableValue<boolean>(true);
	private nextReady = 0;

	constructor(
		logic: WeaponReloadLogic,
		private readonly fireDelay: number | undefined,
	) {
		if (fireDelay === undefined) return;
		// Flip back to loaded once the cooldown elapses (the get() check is a cheap no-op when loaded).
		logic.event.subscribe(RunService.PostSimulation, () => {
			if (!this.loaded.get() && time() >= this.nextReady) this.loaded.set(true);
		});
	}

	/** True (and begins the cooldown) when ready to fire; false while still reloading. The timestamp
	 * is the source of truth so auto-fire doesn't depend on tick ordering; `loaded` is the observable view. */
	tryFire(): boolean {
		if (this.fireDelay === undefined) return true;
		if (time() < this.nextReady) return false;
		this.nextReady = time() + this.fireDelay;
		this.loaded.set(false);
		return true;
	}
}
