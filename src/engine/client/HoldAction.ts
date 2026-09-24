import { Component } from "engine/shared/component/Component";
import { OverlayValueStorage } from "engine/shared/component/OverlayValueStorage";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

/** Represents a hold that can be enabled by a player using a switch GuiButton or holdin a key. */
export class HoldAction extends Component {
	readonly canExecute = new OverlayValueStorage<boolean>(false, true);
	private readonly holding = new ObservableValue<boolean>(false);

	constructor(func?: (enabled: boolean) => void) {
		super();

		this.subCanExecuteFrom({ mainEnabled_$: this.enabledState });
		this.canExecute.subscribe((canExecute) => {
			if (!canExecute) {
				this.set(false);
			}
		});

		if (func) {
			this.subscribe(func);
		}
	}

	get(): boolean {
		return this.holding.get();
	}

	/** Enables the hold if it can be executed. */
	set(enabled: boolean): void {
		if (enabled && !this.canExecute.get()) return;
		this.holding.set(enabled);
	}

	/** Subscribes a function to the action. */
	subscribe(func: (enabled: boolean) => void): SignalConnection {
		return this.holding.subscribe(func);
	}

	/** Adds checks to the action's can execute state. */
	subCanExecuteFrom(values: { readonly [k in string]: ReadonlyObservableValue<boolean> }): void {
		this.canExecute.subscribeAndFrom(values);
	}
}
