import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { ObservableMap } from "engine/shared/event/ObservableMap";
import type { DebuggableComponent } from "engine/shared/component/Component";

/** Stores keyed components. Handles its enabling, disabling and destroying. */
export class ComponentKeyedChildren<TKey extends defined, T extends Component = Component>
	extends Component
	implements DebuggableComponent
{
	private readonly _children = new ObservableMap<TKey, T>();
	readonly children = this._children.asReadonly();
	private clearing = false;

	constructor(clearOnDisable = false) {
		super();

		this.onEnable(() => {
			for (const [_, child] of this.children.getAll()) {
				child.enable();
			}
		});
		this.onDestroy(() => this.clear());

		if (!clearOnDisable) {
			this.onDisable(() => {
				for (const [_, child] of this.children.getAll()) {
					this.markChildDestroying(child);
					child.disable();
				}
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

	getDebugChildren(): readonly T[] {
		return [...this.children.getAll()].map((e) => e[1]);
	}

	getAll(): ReadonlyMap<TKey, T> {
		return this.children.getAll();
	}
	protected override getChildrenForInjecting(): readonly Component[] {
		return [...super.getChildrenForInjecting(), ...this.getAll().values()];
	}

	get(key: TKey): T | undefined {
		return this.children.get(key);
	}

	add<TChild extends T>(key: TKey, child: TChild, throwIfExists = false): TChild {
		if (throwIfExists && this.children.has(key)) {
			throw `Child with the key ${key} already exists`;
		}

		this._children.set(key, child);

		if (this.isEnabled()) {
			child.enable();
		}

		child.onDestroy(() => {
			if (this.clearing) return;
			this.remove(key);
		});

		if (this.parentInstance && ComponentInstance.isInstanceComponent(child)) {
			ComponentInstance.setParentIfNeeded(child.instance, this.parentInstance);
		}

		this.tryProvideDIToChild(child);
		return child;
	}

	remove(key: TKey) {
		const child = this.children.get(key);
		if (!child) return;

		this._children.remove(key);
		child.destroy();
	}

	clear() {
		this.clearing = true;
		for (const [key, child] of this.children.getAll()) {
			child.destroy();
		}

		this._children.clear();
		this.clearing = false;
	}
}
