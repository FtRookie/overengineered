import { ComponentEvents } from "engine/shared/component/ComponentEvents";
import { getDIClassSymbol, pathOf } from "engine/shared/di/DIPathFunctions";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { SlimSignal } from "engine/shared/event/SlimSignal";
import { Objects } from "engine/shared/fixes/Objects";

export namespace ComponentTypes {
	export interface DestroyableComponent {
		destroy(): void;
	}
}

export interface DebuggableComponent {
	getDebugChildren(): readonly DebuggableComponent[];
}

export interface ComponentParentConfig {
	readonly enable?: boolean;
	readonly disable?: boolean;
	readonly destroy?: boolean;
}

class ComponentState {
	private readonly onDestroyed = new SlimSignal();

	readonly enabledState = new ObservableValue<boolean>(false);
	/** @deprecated Internal use only */
	protected selfDestroying = false;
	private selfDestroyed = false;

	isEnabled(): boolean {
		return this.enabledState.get();
	}
	isDestroying(): boolean {
		return this.selfDestroying;
	}
	isDestroyed(): boolean {
		return this.selfDestroyed;
	}

	onEnable(func: () => void): void {
		this.enabledState.subscribe((enabled) => {
			if (!enabled) return;
			func();
		});

		if (this.isEnabled()) {
			func();
		}
	}
	onDisable(func: () => void): void {
		this.enabledState.subscribe((enabled) => {
			if (enabled) return;
			func();
		});
	}
	onDestroy(func: () => void): void {
		this.onDestroyed.Connect(func);
	}

	enable(): void {
		if (this.selfDestroyed || this.isEnabled()) return;
		this.enabledState.set(true);
	}
	disable(): void {
		if (this.selfDestroyed || !this.isEnabled()) return;
		this.enabledState.set(false);
	}
	destroy(): void {
		if (this.selfDestroyed) return;

		this.selfDestroying = true;
		this.disable();

		this.selfDestroyed = true;
		this.onDestroyed.Fire();

		this.enabledState.destroy();
		this.onDestroyed.destroy();
	}
}

export interface Component extends ComponentState {}
export class Component extends ComponentState implements DebuggableComponent {
	readonly event: ComponentEvents;
	private _di?: DIContainer;

	constructor() {
		super();
		this.event = new ComponentEvents(this);
	}

	private cached?: { readonly value: defined; readonly name: string }[];
	private injectFuncs?: Set<(di: DIContainer) => void>;

	/** Register the provided value to be available to any child DI. */
	cacheDI<T extends defined>(value: T, @pathOf("T") name?: string): void {
		if (!name) {
			throw `Name is null when registering ${value}`;
		}

		if (this.cached?.size() === 0) {
			this._di = this._di?.beginScope((builder) => {
				builder.registerSingletonValue(value, name);
			});
		} else {
			this.cached ??= [];
			this.cached.push({ name, value });
		}
	}

	/** Subscribes a function to run when a DI container is available (so when parented to another component or resolved by DI); auto-resolving version. */
	$onInjectAuto<TArgs extends unknown[]>(func: (...args: TArgs) => void): void {
		throw "$onInjectAuto cannot be indirectly called";
	}

	/** Subscribes a function to run when a DI container is available (so when parented to another component or resolved by DI). */
	onInject(func: (di: DIContainer) => void): void {
		if (this.injectFuncs?.size() === 0) {
			throw "Can't request injection after parenting";
		}

		this.injectFuncs ??= new Set();
		this.injectFuncs.add(func);
	}
	/** @deprecated Internal use only */
	protected startInject(di: DIContainer) {
		this._di = di = di.beginScope((builder) => {
			builder.registerSingletonValue(this, getDIClassSymbol(getmetatable(this) as object));

			for (const { name, value } of this.cached ?? []) {
				builder.registerSingletonValue(value, name);
			}
			this.cached = [];
		});

		if (this.injectFuncs) {
			for (const func of this.injectFuncs) {
				func(di);
			}
			this.injectFuncs.clear();
		}

		const isInject = (instance: this): instance is typeof instance & { _inject(di: DIContainer): void } => {
			return "_inject" in instance;
		};
		if (isInject(this)) {
			this._inject(di);
		}

		for (const child of this.getChildrenForInjecting()) {
			this.tryProvideDIToChild(child);
		}
	}

	private components?: Map<ConstructorOf<ComponentTypes.DestroyableComponent>, ComponentTypes.DestroyableComponent>;
	getComponent<T extends new (parent: this, ...rest: unknown[]) => Component | ComponentTypes.DestroyableComponent>(
		clazz: T,
		...args: T extends new (...args: [unknown, ...infer rest extends unknown[]]) => unknown ? rest : []
	): InstanceOf<T> {
		if (!this.components?.get(clazz)) {
			const instance = new clazz(this, ...args) as InstanceOf<T>;

			this.components ??= new Map();
			this.components.set(clazz as unknown as ConstructorOf<Component>, instance);

			if ("enable" in instance) {
				return this.parent(instance) as InstanceOf<T>;
			}

			this.onDestroy(() => instance.destroy());
			return instance;
		}

		return this.components.get(clazz) as InstanceOf<T>;
	}

	private parented?: Component[];
	getParented(): readonly Component[] {
		return this.parented ?? Objects.empty;
	}
	protected getChildrenForInjecting(): readonly Component[] {
		return this.getParented();
	}

	protected getDI(): DIContainer {
		if (!this._di) throw "Component haven't been injected into yet";
		return this._di;
	}
	protected tryProvideDIToChild(child: Component): void {
		if (child._di || !this._di) return;
		child.startInject(this._di);
	}

	/** @deprecated Internal use only */
	protected markChildDestroying(child: Component): void {
		child.selfDestroying = this.isDestroying();
	}

	/** Parents the component to the given component. */
	parent<T extends Component>(child: T, config?: ComponentParentConfig): T {
		this.parented ??= [];
		this.parented.push(child);
		this.tryProvideDIToChild(child);

		if (config?.enable ?? true) {
			this.onEnable(() => child.enable());

			if (this.isEnabled()) {
				child.enable();
			}
		}
		if (config?.disable ?? true) {
			this.onDisable(() => {
				child.selfDestroying = this.isDestroying();
				child.disable();
			});
		}
		if (config?.destroy ?? true) {
			this.onDestroy(() => child.destroy());
		}

		return child;
	}

	getDebugChildren(): readonly DebuggableComponent[] {
		return [
			...(this.parented ?? Objects.empty),
			...(Objects.values(this.components ?? Objects.empty).filter(
				(c) => "getDebugChildren" in c,
			) as DebuggableComponent[]),
		];
	}
}
