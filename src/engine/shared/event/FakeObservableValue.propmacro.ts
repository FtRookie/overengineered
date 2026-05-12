import { ObservableValue } from "engine/shared/event/ObservableValue";
import { ArgsSignal } from "engine/shared/event/Signal";
import type { ComponentTypes } from "engine/shared/component/Component";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

// function to force hoisting of the macros, because it does not but still tries to use them
// do NOT remove and should ALWAYS be before any other code
const _ = () => [FakeReadonlyObservableValueMacros, FakeObservableValueMacros, FakeObservableValueSetMacros];

//

/** Fake observable value, gets (and sets) its value from another and passes through the subscriptions to it. Destroy to disconnect (probably automate via Component.event.addObservable()) */
export interface FakeObservableValue<T> extends ObservableValue<T>, ReadonlyFakeObservableValue<T> {
	/** @deprecated @hidden */
	readonly __nominal_FakeObservable: "FakeObservableValue";
}

/** Fake observable value, gets its value from another and passes through the subscriptions to it. Destroy to disconnect (probably automate via Component.event.addObservable()) */
export interface ReadonlyFakeObservableValue<T>
	extends ReadonlyObservableValue<T>, ComponentTypes.DestroyableComponent {
	/** @deprecated @hidden */
	readonly __nominal_ReadonlyFakeObservable: "ReadonlyFakeObservableValue";
}

export interface DestoyableOV<T> extends ObservableValue<T>, FakeObservableValue<T> {}
export class DestoyableOV<T> extends ObservableValue<T> {
	private readonly destroyed = new ArgsSignal();

	onDestroy(func: () => void): void {
		this.destroyed.Connect(func);
	}

	destroy(): void {
		this.destroyed.Fire();
		super.destroy();
	}
}

//

declare module "engine/shared/event/ObservableValue" {
	interface ReadonlyObservableValue<T> {
		fReadonlyCreateBased<U>(funcTo: (value: T) => U): ReadonlyFakeObservableValue<U>;
		fReadonlyWithDefault<U>(value: U): ReadonlyFakeObservableValue<(T & defined) | U>;
	}
}
export const FakeReadonlyObservableValueMacros: PropertyMacros<ReadonlyObservableValue<unknown>> = {
	fReadonlyCreateBased: <T, U>(
		selv: ReadonlyObservableValue<T>,
		funcTo: (value: T) => U,
	): ReadonlyFakeObservableValue<U> => {
		const ov = new DestoyableOV<U>(funcTo(selv.get()));

		const sub = selv.subscribe((v) => ov.set(funcTo(v)));
		ov.onDestroy(() => sub.Disconnect());

		return ov;
	},
	fReadonlyWithDefault: <T, U>(
		selv: ReadonlyObservableValue<T>,
		value: U,
	): ReadonlyFakeObservableValue<(T & defined) | U> => {
		return selv.fReadonlyCreateBased((v) => v ?? value);
	},
};

declare module "engine/shared/event/ObservableValue" {
	interface ObservableValue<T> {
		fCreateBased<U>(
			funcTo: (value: T) => U,
			funcFrom: (value: U, existing: T) => T,
			equalityFunc?: (oldv: T, newv: T) => boolean,
		): FakeObservableValue<U>;
		fWithDefault<U>(value: U): FakeObservableValue<(T & defined) | U>;
	}
}
export const FakeObservableValueMacros: PropertyMacros<ObservableValue<unknown>> = {
	fCreateBased: <T, U>(
		selv: ObservableValue<T>,
		funcTo: (value: T) => U,
		funcFrom: (value: U, existing: T) => T,
		equalityFunc?: (oldv: T, newv: T) => boolean,
	): FakeObservableValue<U> => {
		const ov = new DestoyableOV<U>(funcTo(selv.get()));

		const sub = selv.subscribe((v) => ov.set(funcTo(v)));
		ov.subscribe((v) => {
			const newv = funcFrom(v, selv.get());
			if (equalityFunc?.(selv.get(), newv)) return;

			selv.set(newv);
		});
		ov.onDestroy(() => sub.Disconnect());

		return ov;
	},
	fWithDefault: <T, U>(selv: ObservableValue<T | U>, value: U): FakeObservableValue<(T & defined) | U> => {
		return selv.fCreateBased(
			(v) => v ?? value,
			(v) => v,
		);
	},
};

// declare module "engine/shared/event/ObservableCollection" {
// 	interface ObservableCollectionSet<T extends defined> {
// 		asArray(): FakeObservableValue<readonly T[]>;
// 	}
// }
// export const FakeObservableSetSetMacros: PropertyMacros<ObservableCollectionSet<defined>> = {
// 	asArray: <T extends defined>(selv: ObservableCollectionSet<T>): FakeObservableValue<readonly T[]> => {
// 		return selv.fCreateBased(
// 			(v) => [...v],
// 			(v) => new Set(v),
// 		);
// 	},
// };

declare module "engine/shared/event/ObservableValue" {
	interface ObservableValue<T> {
		asArray<Item>(this: ObservableValue<ReadonlySet<Item>>): FakeObservableValue<readonly Item[]>;
	}
}
export const FakeObservableValueSetMacros: PropertyMacros<ObservableValue<ReadonlySet<defined>>> = {
	asArray: <Item extends defined>(selv: ObservableValue<ReadonlySet<Item>>): FakeObservableValue<readonly Item[]> => {
		return selv.fCreateBased(
			(v) => [...v],
			(v) => new Set(v),
			(oldv, newv) => newv.sequenceEquals(oldv),
		);
	},
};
