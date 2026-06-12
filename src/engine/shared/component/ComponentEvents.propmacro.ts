import { ObservableValue } from "engine/shared/event/ObservableValue";
import { JSON } from "engine/shared/fixes/Json";
import type { ComponentTypes } from "engine/shared/component/Component";
import type { ComponentEvents } from "engine/shared/component/ComponentEvents";
import type { EventHandler } from "engine/shared/event/EventHandler";
import type {
	FakeObservableValue,
	ReadonlyFakeObservableValue,
} from "engine/shared/event/FakeObservableValue.propmacro";
import type { CollectionChangedArgs, ReadonlyObservableCollection } from "engine/shared/event/ObservableCollection";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

// function to force hoisting of the macros, because it does not but still tries to use them
// do NOT remove and should ALWAYS be before any other code
const _ = () => [ComponentEvents2Macros];

//

declare module "engine/shared/component/ComponentEvents" {
	interface ComponentEvents {
		onEnable(func: (eh: EventHandler) => void, executeImmediately?: boolean): void;

		/** Register an event */
		subscribe<TArgs extends unknown[]>(signal: ReadonlyArgsSignal<TArgs>, callback: (...args: TArgs) => void): void;

		/** Register an event */
		subscribeRegistration(func: () => SignalConnection | readonly SignalConnection[] | undefined): void;

		/** Destroy the provided object on state destroy */
		subscribeDestroyable<T extends ComponentTypes.DestroyableComponent>(component: T): T;

		/** Register an event and call the callback function on enable or immediately */
		subscribeImmediately<TArgs extends unknown[]>(
			signal: ReadonlyArgsSignal<TArgs>,
			callback: () => void,
			executeOnEnable?: boolean,
			executeImmediately?: boolean,
		): void;

		/** Subscribe to an observable value changed event */
		subscribeObservable<T>(
			observable: ReadonlyObservableValue<T>,
			callback: (value: T) => void,
			executeOnEnable?: boolean,
			executeImmediately?: boolean,
		): void;

		/** Subscribe to an observable value changed event, with the previous value argument */
		subscribeObservablePrev<T>(
			observable: ReadonlyObservableValue<T>,
			callback: (value: T, prev: T) => void,
			executeOnEnable?: boolean,
			executeImmediately?: boolean,
		): void;

		/** Subscribe to an observable collection changed event */
		subscribeCollection<T extends defined>(
			observable: ReadonlyObservableCollection<T>,
			callback: (update: CollectionChangedArgs<T>) => void,
			executeOnEnable?: boolean,
			executeImmediately?: boolean,
		): void;

		/** Subscribe to an observable collection item added event */
		subscribeCollectionAdded<T extends defined>(
			observable: ReadonlyObservableCollection<T>,
			callback: (item: T) => void,
			executeOnEnable?: boolean,
			executeImmediately?: boolean,
		): void;

		/** Subscribe to an observable map changed event */
		subscribeMap<K extends defined, V extends defined>(
			observable: ReadonlyObservableMap<K, V>,
			callback: (key: K, value: V | undefined) => void,
			executeOnEnable?: boolean,
			executeImmediately?: boolean,
		): void;

		// May deprecate soon and change to Observables namespace
		/** Create an `ReadonlyObservableValue` from an `Instance` property */
		readonlyObservableFromInstanceParam<
			TInstance extends Instance,
			TParam extends InstancePropertyNames<TInstance>,
		>(
			instance: TInstance,
			param: TParam,
		): ReadonlyObservableValue<TInstance[TParam]>;

		/** Create an `ObservableValue` from an `Instance` property */
		observableFromInstanceParam<TInstance extends Instance, TParam extends InstancePropertyNames<TInstance>>(
			instance: TInstance,
			param: TParam,
		): ObservableValue<TInstance[TParam]>;

		/** Create an `ObservableValue` from an `Instance` attribute */
		observableFromAttribute<TType extends AttributeValue>(
			instance: Instance,
			name: string,
		): ObservableValue<TType | undefined>;

		/** Create an `ObservableValue` from an `Instance` attribute, using JSON.ts */
		observableFromAttributeJson<TType>(instance: Instance, name: string): ObservableValue<TType | undefined>;

		/** Susbcribe to destroy the fake observable on component destroy. */
		addObservable<T>(creation: FakeObservableValue<T>): ObservableValue<T>;
		/** Susbcribe to destroy the fake observable on component destroy. */
		addObservable<T>(creation: ReadonlyFakeObservableValue<T>): ReadonlyObservableValue<T>;

		/** Create an infinite loop that would only loop when this event holder is enabled */
		loop(interval: number, func: (dt: number) => void): SignalConnection;
	}
}
export const ComponentEvents2Macros: PropertyMacros<ComponentEvents> = {
	onEnable: (selv, func, executeImmediately = false): void => {
		selv.state.onEnable(() => func(selv.eventHandler));
		if (executeImmediately) func(selv.eventHandler);
	},

	subscribe: <TArgs extends unknown[]>(
		selv: ComponentEvents,
		signal: ReadonlyArgsSignal<TArgs>,
		callback: (...args: TArgs) => void,
	): void => {
		if (selv.state.isDestroyed()) return;

		const sub = () => selv.eventHandler.subscribe(signal, callback);
		selv.onEnable(sub);
	},

	subscribeRegistration: (
		selv: ComponentEvents,
		func: () => SignalConnection | readonly SignalConnection[] | undefined,
	): void => {
		if (selv.state.isDestroyed()) return;

		selv.onEnable(() => {
			const sub = func();
			if (!sub) return;

			if ("Disconnect" in sub) {
				selv.eventHandler.register(sub);
			} else {
				for (const connection of sub) {
					selv.eventHandler.register(connection);
				}
			}
		});
	},

	subscribeDestroyable: <T extends ComponentTypes.DestroyableComponent>(selv: ComponentEvents, component: T): T => {
		selv.state.onDestroy(() => component.destroy());
		return component;
	},

	subscribeImmediately: <TArgs extends unknown[]>(
		selv: ComponentEvents,
		signal: ReadonlyArgsSignal<TArgs>,
		callback: () => void,
		executeOnEnable = true,
		executeImmediately = false,
	): void => {
		if (selv.state.isDestroyed()) return;
		selv.subscribe(signal, callback);

		if (executeOnEnable) {
			selv.onEnable(callback);
		}
		if (executeImmediately) {
			callback();
		}
	},

	subscribeObservable: <T>(
		selv: ComponentEvents,
		observable: ReadonlyObservableValue<T>,
		callback: (value: T) => void,
		executeOnEnable = false,
		executeImmediately = false,
	): void => {
		selv.subscribe(observable.changed, callback);
		if (executeOnEnable) {
			selv.onEnable(() => callback(observable.get()));
		}
		if (executeImmediately) {
			callback(observable.get());
		}
	},

	subscribeObservablePrev: <T>(
		selv: ComponentEvents,
		observable: ReadonlyObservableValue<T>,
		callback: (value: T, prev: T) => void,
		executeOnEnable = false,
		executeImmediately = false,
	): void => {
		selv.subscribeRegistration(() => observable.subscribePrev(callback));

		if (executeOnEnable) {
			selv.onEnable(() => callback(observable.get(), observable.get()));
		}
		if (executeImmediately) {
			callback(observable.get(), observable.get());
		}
	},

	subscribeCollection: <T extends defined>(
		selv: ComponentEvents,
		observable: ReadonlyObservableCollection<T>,
		callback: (update: CollectionChangedArgs<T>) => void,
		executeOnEnable = false,
		executeImmediately = false,
	): void => {
		selv.subscribe(observable.collectionChanged, callback);
		if (executeOnEnable) {
			selv.onEnable(() => callback({ kind: "add", added: observable.getArr() }), executeImmediately);
		}
	},

	subscribeCollectionAdded: <T extends defined>(
		selv: ComponentEvents,
		observable: ReadonlyObservableCollection<T>,
		callback: (item: T) => void,
		executeOnEnable = false,
		executeImmediately = false,
	): void => {
		selv.subscribeCollection(
			observable,
			(update) => {
				if (update.kind !== "add") return;
				for (const item of update.added) {
					callback(item);
				}
			},
			executeOnEnable,
			executeImmediately,
		);
	},

	subscribeMap: <K extends defined, V extends defined>(
		selv: ComponentEvents,
		observable: ReadonlyObservableMap<K, V>,
		callback: (key: K, value: V | undefined) => void,
		executeOnEnable = false,
		executeImmediately = false,
	): void => {
		selv.subscribe(observable.changed, callback);

		if (executeOnEnable) {
			selv.onEnable(() => {
				for (const [k, v] of observable.getAll()) {
					callback(k, v);
				}
			}, executeImmediately);
		}
	},

	readonlyObservableFromInstanceParam: <TInstance extends Instance, TParam extends InstancePropertyNames<TInstance>>(
		selv: ComponentEvents,
		instance: TInstance,
		param: TParam,
	): ReadonlyObservableValue<TInstance[TParam]> => {
		const observable = new ObservableValue<TInstance[TParam]>(instance[param]);
		selv.subscribe(instance.GetPropertyChangedSignal(param), () => observable.set(instance[param]));

		return observable;
	},

	observableFromInstanceParam: <TInstance extends Instance, TParam extends InstancePropertyNames<TInstance>>(
		selv: ComponentEvents,
		instance: TInstance,
		param: TParam,
	): ObservableValue<TInstance[TParam]> => {
		const observable = new ObservableValue<TInstance[TParam]>(instance[param]);
		selv.subscribe(instance.GetPropertyChangedSignal(param), () => observable.set(instance[param]));
		selv.subscribeObservable(observable, (value) => (instance[param] = value), true);

		return observable;
	},

	observableFromAttribute: <TType extends AttributeValue>(
		selv: ComponentEvents,
		instance: Instance,
		name: string,
	): ObservableValue<TType | undefined> => {
		const observable = new ObservableValue<TType | undefined>(instance.GetAttribute(name) as TType | undefined);
		selv.subscribe(instance.GetAttributeChangedSignal(name), () =>
			observable.set(instance.GetAttribute(name) as TType | undefined),
		);
		selv.subscribeObservable(observable, (value) => instance.SetAttribute(name, value));

		return observable;
	},

	observableFromAttributeJson: <TType>(
		selv: ComponentEvents,
		instance: Instance,
		name: string,
	): ObservableValue<TType | undefined> => {
		const json = instance.GetAttribute(name) as string | undefined;
		const observable = new ObservableValue<TType | undefined>(
			json !== undefined ? JSON.deserialize<TType>(json) : undefined,
		);

		selv.subscribe(instance.GetAttributeChangedSignal(name), () => {
			const json = instance.GetAttribute(name) as string | undefined;
			const val = json !== undefined ? JSON.deserialize<TType>(json) : undefined;

			observable.set(val);
		});
		selv.subscribeObservable(
			observable,
			(value) => instance.SetAttribute(name, value === undefined ? undefined : JSON.serialize(value)),
			true,
		);

		return observable;
	},

	addObservable: <T>(selv: ComponentEvents, data: ReadonlyFakeObservableValue<T>): ReadonlyObservableValue<T> => {
		return selv.subscribeDestroyable(data);
	},

	loop: (selv: ComponentEvents, interval: number, func: (dt: number) => void): SignalConnection => {
		let stop = false;

		task.spawn(() => {
			let dt = 0;
			while (true as boolean) {
				if (selv.state.isDestroyed()) return;
				if (stop) return;

				if (selv.state.isEnabled()) {
					func(dt);
				}

				dt = task.wait(interval);
			}
		});

		return {
			Disconnect() {
				stop = true;
			},
		};
	},
};
