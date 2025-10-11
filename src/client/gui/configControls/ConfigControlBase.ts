import { PartialControl } from "engine/client/gui/PartialControl";
import { Observables } from "engine/shared/event/Observables";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { SubmittableValue } from "engine/shared/event/SubmittableValue";
import { Objects } from "engine/shared/fixes/Objects";

// Returns full paths of the object T, but only for values assignable to V
type FilteredPath<T, V> = T extends Vector3
	? []
	: T extends object
		? {
				[K in keyof T]: T[K] extends V ? [K] : T[K] extends object ? [K, ...FilteredPath<T[K], V>] : never;
			}[keyof T]
		: [];

export type ConfigControlBaseDefinition = GuiObject & ConfigControlBaseDefinitionParts;
export type ConfigControlBaseDefinitionParts = {
	readonly TitleLabel: TextLabel;
	readonly DescriptionLabel?: TextLabel;
};

type Values<T> = { readonly [k in string]: T };
export class ConfigControlBase<
	T extends ConfigControlBaseDefinitionParts,
	V extends defined,
	TParts extends ConfigControlBaseDefinitionParts = T,
> extends PartialControl<TParts> {
	private readonly _v;

	constructor(gui: GuiObject & T, name: string) {
		super(gui);
		gui.Name = name;
		this._v = new SubmittableValue(new ObservableValue<Values<V>>({}));

		this.parts.TitleLabel.Text = name;
		this.setDescription(undefined);
	}

	setDescription(text: string | undefined): this {
		if (this.parts.DescriptionLabel) {
			this.parts.DescriptionLabel.Text = text ?? "";
			this.parts.DescriptionLabel.Visible = text !== undefined;
		}

		return this;
	}

	protected initFromMultiWithDefault(observable: ObservableValue<V>, defaultValue: () => V): void {
		let here = false;

		// not using this.event to skip the initial animations
		this._v.value.subscribe(() => {
			if (here) return;

			here = true;
			try {
				observable.set(this.multi() ?? defaultValue());
			} finally {
				here = false;
			}
		}, true);

		this.event.subscribeObservable(observable, (v) => {
			if (v === undefined) return;
			if (here) return;

			here = true;
			try {
				this._v.set(this.multiMap(() => v));
			} finally {
				here = false;
			}
		});
	}

	protected initFromMulti<T>(observable: T extends ObservableValue<V> ? never : T): void;
	protected initFromMulti(observable: ObservableValue<V | undefined>): void {
		// not using this.event to skip the initial animations
		this._v.value.subscribe(() => observable.set(this.multi()), true);

		this.event.subscribeObservable(observable, (v) => {
			if (v === undefined) return;
			this._v.set(this.multiMap(() => v));
		});
	}

	protected valueChanged(func: (value: Values<V>) => void): this {
		this.event.subscribeObservable(this._v.value, func, true);
		return this;
	}
	submitted(func: (value: Values<V>) => void): this {
		this.event.subscribe(this._v.submitted, func);
		return this;
	}
	submittedMulti(func: (value: V | undefined) => void): this {
		this.submitted(() => func(this.multi()));
		return this;
	}
	protected submit(value: Values<V>): void {
		this._v.submit(value);
	}

	protected multiOf<V>(values: Values<V>): V | undefined {
		let prev: V | undefined = undefined;
		for (const [, v] of pairs(values)) {
			if (prev === undefined) {
				prev = v;
				continue;
			}

			if (prev !== v) {
				return undefined;
			}
		}

		return prev;
	}
	protected multi(): V | undefined {
		return this.multiOf(this._v.get());
	}
	protected multiMap<U extends defined>(func: (key: keyof Values<V>, value: V) => U): Values<U> {
		return Objects.mapValues(this._v.get(), (k, v) => func(k, v));
	}

	initToObjectsPart(
		observables: Values<ObservableValue<PlayerConfig>>,
		path: FilteredPath<PlayerConfig, V>,
		updateType?: "value" | "submit",
	): this;
	initToObjectsPart(
		observables: Values<ObservableValue<object>>,
		path: readonly string[],
		updateType?: "value" | "submit",
	): this;
	initToObjectsPart(
		observables: Values<ObservableValue<object>>,
		path: readonly string[],
		updateType: "value" | "submit" = "submit",
	): this {
		const os = Objects.mapValues(observables, (k, v) =>
			this.event.addObservable(Observables.createObservableFromObjectProperty<V>(v, path)),
		);

		return this.initToObservables(os, updateType);
	}

	initToObjectPart(
		observable: ObservableValue<object>,
		path: readonly string[],
		updateType: "value" | "submit" = "submit",
	): this {
		return this.initToObjectsPart({ _: observable }, path, updateType);
	}

	setValues(values: Values<V>): this {
		this._v.set(values);
		return this;
	}

	initToObservableValues(observable: ObservableValue<Values<V>>, updateType: "value" | "submit" = "submit"): this {
		if (updateType === "value") {
			this.event.subscribeRegistration(() => observable.connect(this._v.value));
		} else if (updateType === "submit") {
			this.event.subscribe(this._v.submitted, (v) => observable.set(v));
			this.event.subscribeObservable(observable, (v) => this._v.set(v));
		} else {
			updateType satisfies never;
		}

		// to skip the initial animation
		this._v.value.set(observable.get());

		return this;
	}
	initToObservables(observable: Values<ObservableValue<V>>, updateType: "value" | "submit" = "submit"): this {
		const oss = this.event.addObservable(Observables.createObservableFromMultiple(observable));
		return this.initToObservableValues(oss, updateType);
	}
	initToObservable(observable: ObservableValue<V>, updateType: "value" | "submit" = "submit"): this {
		return this.initToObservables({ _: observable }, updateType);
	}
}
