import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { ObservableCollectionArr } from "engine/shared/event/ObservableCollection";

export interface ReadonlyComponentChildren<T extends Component = Component> extends Component {
	getAll(): readonly T[];
}

/** Stores components. Handles its enabling, disabling and destroying. */
export class ComponentChildren<T extends Component = Component>
	extends Component
	implements ReadonlyComponentChildren<T>
{
	private readonly _children = new ObservableCollectionArr<T>();
	readonly children = this._children.asReadonly();
	private clearing = false;

	constructor(clearOnDisable = false) {
		super();

		this.onEnable(() => {
			for (const child of this._children.get()) {
				child.enable();
			}
		});
		this.onDestroy(() => this.clear());

		if (!clearOnDisable) {
			this.onDisable(() => {
				for (const child of this._children.get()) {
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

	getAll(): readonly T[] {
		return this._children.get();
	}
	protected override getChildrenForInjecting(): readonly Component[] {
		return [...super.getChildrenForInjecting(), ...this.getAll()];
	}

	add<TChild extends T>(child: TChild): TChild {
		this._children.push(child);

		if (this.isEnabled()) {
			child.enable();
		}

		child.onDestroy(() => {
			if (this.clearing) return;
			this.remove(child);
		});

		if (this.parentInstance && ComponentInstance.isInstanceComponent(child)) {
			ComponentInstance.setParentIfNeeded(child.instance, this.parentInstance);
			ComponentInstance.setLayoutOrderIfNeeded(child.instance, this.parentInstance);
		}

		this.tryProvideDIToChild(child);
		return child;
	}

	remove(child: T) {
		this._children.remove(child);
		child.destroy();
	}

	clear() {
		this.clearing = true;
		for (const child of this._children.get()) {
			child.destroy();
		}

		this._children.clear();
		this.clearing = false;
	}

	override getDebugChildren(): readonly T[] {
		return this.getAll();
	}
}
