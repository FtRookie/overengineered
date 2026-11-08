import { RunService } from "@rbxts/services";

/**
 * A value computed by its loader on the first `get()` of a frame and returned from cache for the rest of that frame.
 * For a query whose answer is the same for every caller in a frame, so many callers pay for one evaluation.
 */
export class PerFrame<T> {
	private value?: T;
	private stale = true;
	private connection?: RBXScriptConnection;

	constructor(private readonly load: () => T) {}

	get(): T {
		// PreSimulation opens the frame, ahead of PostSimulation and the resumed threads the logic ticks in
		this.connection ??= RunService.PreSimulation.Connect(() => (this.stale = true));

		if (this.stale) {
			this.value = this.load();
			this.stale = false;
		}

		return this.value as T;
	}
}
