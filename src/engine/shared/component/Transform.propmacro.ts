import { Easing } from "engine/shared/component/Easing";
import { ParallelTransformSequence } from "engine/shared/component/Transform";
import { TransformBuilder } from "engine/shared/component/Transform";
import { isReadonlyObservableValue } from "engine/shared/event/ObservableValue";
import type { EasingDirection, EasingStyle } from "engine/shared/component/Easing";
import type { RunningTransform, Transform, TransformProps } from "engine/shared/component/Transform";
import type { ObservableValue, ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

// function to force hoisting of the macros, because it does not but still tries to use them
// do NOT remove and should ALWAYS be before any other code
const _ = () => [TransformBuilderMacros];

type B = TransformBuilder;

class FuncTransform implements Transform {
	private readonly func: () => unknown | TransformBuilder;
	private finished = false;

	constructor(func: () => unknown | TransformBuilder) {
		this.func = func;
	}

	runFrame(): boolean | TransformBuilder {
		if (this.finished) return true;

		this.finished = true;
		const result = this.func();
		if (!result) return true;

		if (result === true) {
			return result;
		}
		if (typeIs(result, "table") && "then" in result) {
			return result as TransformBuilder;
		}

		return true;
	}
	finish() {
		if (this.finished) return;

		this.finished = true;
		this.func();
	}
}
class DelayTransform implements Transform {
	private readonly delay: number;

	constructor(delay: number) {
		this.delay = delay;
	}

	runFrame(time: number): boolean {
		return time >= this.delay;
	}
	finish() {}
}
class FuncTweenTransform<T> implements Transform {
	constructor(
		private readonly startValue: TransformValue<T, []>,
		private readonly endValue: TransformValue<T, []>,
		private readonly setFunc: (value: T) => void,
		private readonly duration: number,
		private readonly style: EasingStyle,
		private readonly direction: EasingDirection,
	) {}

	private actualStartValue?: () => T;
	private actualEndValue?: () => T;

	runFrame(time: number): boolean {
		if (time >= this.duration) {
			this.finish();
			return true;
		}

		this.actualStartValue ??= transformValueToActual(this.startValue);
		this.actualEndValue ??= transformValueToActual(this.endValue);

		this.setFunc(
			Easing.easeValue(
				time / this.duration,
				this.actualStartValue(),
				this.actualEndValue(),
				this.style,
				this.direction,
			),
		);

		return false;
	}

	finish() {
		this.setFunc((this.actualEndValue ?? transformValueToActual(this.endValue))());
	}
}
class TweenTransform<T extends object, TKey extends keyof T> implements Transform {
	constructor(
		private readonly instance: T,
		private readonly key: TKey,
		private readonly endValue: TransformValue<T[TKey]>,
		private readonly duration: number,
		private readonly style: EasingStyle,
		private readonly direction: EasingDirection,
	) {}

	private actualStartValue?: T[TKey];
	private actualEndValue?: (current: T[TKey]) => T[TKey];

	runFrame(time: number): boolean {
		if (time >= this.duration) {
			this.finish();
			return true;
		}

		this.actualStartValue ??= this.instance[this.key];
		this.actualEndValue ??= transformValueToActual(this.endValue, this.actualStartValue);

		this.instance[this.key] = Easing.easeValue(
			time / this.duration,
			this.actualStartValue,
			this.actualEndValue(this.instance[this.key]),
			this.style,
			this.direction,
		) as T[TKey];

		return false;
	}

	finish() {
		this.instance[this.key] = (
			this.actualEndValue ??
			transformValueToActual(this.endValue, this.actualStartValue ?? this.instance[this.key])
		)(this.instance[this.key]);
	}
}
class WaitForOtherTransform implements Transform {
	constructor(private readonly transform: RunningTransform) {}

	runFrame(): boolean {
		if (!this.transform.isCompleted()) {
			return false;
		}

		return true;
	}
	finish(): void {}
}

//

const transformValueToActual = <T, TArgs extends unknown[]>(
	value: TransformValue<T, TArgs>,
	...args: TArgs
): ((...args: TArgs) => T) => {
	if (typeIs(value, "table")) {
		if ("run" in value && "func" in value) {
			if (value.run === "once") {
				const v = value.func(...args);
				return () => v;
			}
			if (value.run === "everyTick") {
				return value.func;
			}

			value.run satisfies never;
		}

		if (isReadonlyObservableValue(value)) {
			return () => {
				const v = value.get();
				if (isReadonlyObservableValue(v)) {
					return v.get();
				}

				return v;
			};
		}
	}

	return () => value as T;
};
type TransformValue<T, TArgs extends unknown[] = [current: T]> =
	| T
	| ReadonlyObservableValue<T>
	| ReadonlyObservableValue<ReadonlyObservableValue<T>>
	| { readonly run: "once" | "everyTick"; readonly func: (...args: TArgs) => T };

declare module "engine/shared/component/Transform" {
	interface TransformBuilder {
		func(func: () => void): this;
		wait(delay: number): this;
		parallel(...transforms: readonly TransformBuilder[]): this;
		repeat(amount: number, func: (transform: TransformBuilder) => void): this;

		/** Wait for a transform to finish */
		waitForTransform(transform: RunningTransform): this;

		transformMulti<T extends object, TKey extends keyof T>(
			object: T,
			value: { readonly [k in TKey]?: T[TKey] },
			params?: TransformProps,
		): this;
		transform<T extends object, TKey extends keyof T>(
			object: T,
			key: TKey,
			value: TransformValue<T[TKey]>,
			params?: TransformProps,
		): this;
		funcTransform<T>(
			startValue: TransformValue<T, []>,
			endValue: TransformValue<T, []>,
			setFunc: (value: T) => void,
			params?: TransformProps,
		): this;
		transformObservable<T>(
			observable: ObservableValue<T>,
			endValue: TransformValue<T>,
			params?: TransformProps,
		): this;

		setup(setup: ((transform: TransformBuilder) => void) | undefined): this;
	}
}
export const TransformBuilderMacros: PropertyMacros<TransformBuilder> = {
	func: (selv: B, func: () => void) => selv.push(new FuncTransform(func)),
	wait: (selv: B, delay: number) => selv.push(new DelayTransform(delay)),
	parallel: (selv: B, ...transforms: readonly TransformBuilder[]) =>
		selv.push(new ParallelTransformSequence(transforms.map((t) => t.buildSequence()))),

	repeat: (selv: B, amount: number, func: (transform: TransformBuilder) => void) => {
		const transform = new TransformBuilder();
		for (let i = 0; i < amount; i++) {
			func(transform);
			transform.then();
		}

		return selv.push(transform.buildSequence());
	},

	waitForTransform: (selv: B, transform: RunningTransform) => selv.push(new WaitForOtherTransform(transform)),

	transformMulti: <T extends object, TKey extends keyof T>(
		selv: B,
		object: T,
		value: { readonly [k in TKey]?: T[TKey] & defined },
		params?: TransformProps,
	) => {
		for (const [key, val] of pairs(value)) {
			selv.transform(object, key, val, params);
		}

		return selv;
	},

	transform: <T extends object, TKey extends keyof T>(
		selv: B,
		object: T,
		key: TKey,
		endValue: TransformValue<T[TKey]>,
		params?: TransformProps,
	) => {
		return selv.push(
			new TweenTransform(
				object,
				key,
				endValue,
				params?.duration ?? 0,
				params?.style ?? "Quad",
				params?.direction ?? "Out",
			),
		);
	},

	funcTransform: <T>(
		selv: B,
		startValue: TransformValue<T, []>,
		endValue: TransformValue<T, []>,
		setFunc: (value: T) => void,
		params?: TransformProps,
	) => {
		return selv.push(
			new FuncTweenTransform(
				startValue,
				endValue,
				setFunc,
				params?.duration ?? 0,
				params?.style ?? "Quad",
				params?.direction ?? "Out",
			),
		);
	},

	transformObservable: <T>(
		selv: B,
		observable: ObservableValue<T>,
		endValue: TransformValue<T>,
		params?: TransformProps,
	) => {
		const addArg = (value: TransformValue<T>): TransformValue<T, []> => {
			if (!typeIs(value, "table") || !("run" in value) || !("func" in value)) {
				return value as T | ObservableValue<T> | ObservableValue<ObservableValue<T>>;
			}

			if (value.run === "once") {
				return { run: "once", func: () => observable.get() };
			}
			if (value.run === "everyTick") {
				return { run: "everyTick", func: () => value.func(observable.get()) };
			}

			value.run satisfies never;
			return value as T | ObservableValue<T> | ObservableValue<ObservableValue<T>>;
		};

		return selv.funcTransform(
			{ run: "once", func: () => observable.get() },
			addArg(endValue),
			(v) => observable.set(v),
			params,
		);
	},

	setup: (selv: B, setup: ((transform: TransformBuilder) => void) | undefined) => {
		setup?.(selv);
		return selv;
	},
};
