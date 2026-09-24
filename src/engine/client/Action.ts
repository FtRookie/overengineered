import { Component } from "engine/shared/component/Component";
import { OverlayValueStorage } from "engine/shared/component/OverlayValueStorage";
import { ArgsSignal, Signal } from "engine/shared/event/Signal";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

/** Represents an action that can be executed by a player using a GuiButton or a key. */
export class Action<TArgs extends unknown[] = []> extends Component {
	readonly canExecute = new OverlayValueStorage<boolean>(false, true);
	private readonly action = new ArgsSignal<TArgs>();

	constructor(func?: (...args: TArgs) => void) {
		super();

		this.subCanExecuteFrom({ mainEnabled_$: this.enabledState });

		if (func) {
			this.subscribe(func);
		}
	}

	/** Executes the action if it can be executed. */
	execute(...args: TArgs): void {
		if (!this.canExecute.get()) return;
		this.action.Fire(...args);
	}

	/** Subscribes a function to the action. */
	subscribe(func: (...args: TArgs) => void): SignalConnection {
		return this.action.Connect(func);
	}

	/** Subscribes this action to execute another, copying its requirements. */
	subscribeAction(action: Action<TArgs>): SignalConnection {
		const key = tostring(action);

		const sub1 = this.action.Connect((...args) => action.execute(...args));
		this.canExecute.and(key, action.canExecute);

		return Signal.connection(() => {
			sub1.Disconnect();
			this.canExecute.and(key, undefined);
		});
	}

	/** Subscribes this action to execute another, copying its requirements. */
	subscribeActionObservable(action: ReadonlyObservableValue<Action<TArgs> | undefined>): this {
		let sub: SignalConnection | undefined = undefined;
		this.onDestroy(() => sub?.Disconnect());
		this.event.subscribeObservable(
			action,
			(action) => {
				sub?.Disconnect();
				if (!action) return;

				sub = this.subscribeAction(action);
			},
			true,
		);

		return this;
	}

	/** Adds checks to the action's can execute state. Returns this; */
	subCanExecuteFrom(values: { readonly [k in string]: ReadonlyObservableValue<boolean> }): this {
		this.canExecute.subscribeAndFrom(values);
		return this;
	}
}
