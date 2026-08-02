import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { ArgsSignal } from "engine/shared/event/Signal";
import { SlimSignal } from "engine/shared/event/SlimSignal";
import { Objects } from "engine/shared/fixes/Objects";
import type {
	ObservableValue,
	ObservableValueBase,
	ReadonlyObservableValue,
} from "engine/shared/event/ObservableValue";
import type { ReadonlySlimSignal } from "engine/shared/event/SlimSignal";

export interface ReadonlyComponentChild<T extends Component = Component> extends Component {
	get(): T | undefined;
}

export interface ComponentChild<T extends Component = Component> extends ObservableValue<T | undefined> {}
/** Stores a single component (or zero). Handles its enabling, disabling and destroying. */
export class ComponentChild<T extends Component = Component>
	extends Component
	implements ReadonlyComponentChild<T>, ObservableValueBase<T | undefined>
{
	static fromObservable<TComponent extends Component, TKey>(
		observable: ReadonlyObservableValue<TKey>,
		ctor: (value: TKey) => TComponent,
		clearOnDisable: boolean = false,
	): ComponentChild<TComponent> {
		const cc = new ComponentChild<TComponent>(clearOnDisable);
		cc.event.subscribeObservable(observable, (value) => cc.set(ctor(value)), true);
		cc.childSet.Connect((child) => {
			if (!child && cc.isEnabled()) {
				cc.set(ctor(observable.get()));
			}
		});

		return cc;
	}

	private readonly _childSet = new SlimSignal<(child: T | undefined) => void>();
	readonly childSet: ReadonlySlimSignal<(child: T | undefined) => void> = this._childSet;

	private readonly _changed = new ArgsSignal<[value: T | undefined, prev: T | undefined]>();
	readonly changed: ReadonlyArgsSignal<[value: T | undefined, prev: T | undefined]> = this._changed;

	private child?: T;

	constructor(clearOnDisable = false) {
		super();

		this.changed.Connect((value) => this._childSet.Fire(value));

		this.onEnable(() => this.child?.enable());
		this.onDestroy(() => this.clear());

		if (!clearOnDisable) {
			this.onDisable(() => {
				const child = this.child;
				if (!child) return;

				this.markChildDestroying(child);
				child.disable();
			});
		} else {
			this.onDisable(() => this.clear());
		}
	}

	private parentInstance?: Instance;
	withParentInstance(parentInstance: Instance): this {
		if (this.parentInstance) {
			throw "Instance already set";
		}

		this.parentInstance = parentInstance;
		return this;
	}

	get(): T | undefined {
		return this.child;
	}
	protected override getChildrenForInjecting(): readonly Component[] {
		const child = this.get();
		if (!child) return super.getChildrenForInjecting();

		return [...super.getChildrenForInjecting(), child];
	}

	set<TChild extends T | undefined>(child: TChild): TChild {
		const prev = this.child;
		this.child = child;
		prev?.destroy();
		this._childSet.Fire(child);

		if (child && this.child === child) {
			child.onDestroy(() => {
				if (this.child !== child) return;
				this.set(undefined);
			});

			if (this.isEnabled()) {
				child.enable();
			}
		}

		if (child && this.parentInstance && ComponentInstance.isInstanceComponent(child)) {
			ComponentInstance.setParentIfNeeded(child.instance, this.parentInstance);
		}

		if (child) {
			this.tryProvideDIToChild(child);
		}
		return child;
	}
	clear() {
		this.set(undefined);
	}

	override getDebugChildren(): readonly T[] {
		const child = this.child;
		return child ? [child] : Objects.empty;
	}
}
