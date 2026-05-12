import { ArgsSignal } from "engine/shared/event/Signal";
import type {
	ObservableValue,
	ObservableValueBase,
	ReadonlyObservableValue,
} from "engine/shared/event/ObservableValue";

export type CollectionChangedArgs<T> =
	| { readonly kind: "add"; readonly added: readonly T[] }
	| { readonly kind: "remove"; readonly removed: readonly T[] }
	| { readonly kind: "clear" };

export interface ReadonlyObservableCollection<T extends defined> {
	readonly collectionChanged: ReadonlyArgsSignal<[collectionChangedType: CollectionChangedArgs<T>]>;

	size(): number;
	getArr(): readonly T[];
}
export interface ReadonlyObservableCollectionArr<T extends defined>
	extends ReadonlyObservableCollection<T>, ReadonlyObservableValue<readonly T[]> {
	get(): readonly T[];
}
export interface ReadonlyObservableCollectionSet<T extends defined>
	extends ReadonlyObservableCollection<T>, ReadonlyObservableValue<ReadonlySet<T>> {
	get(): ReadonlySet<T>;
}

abstract class ObservableCollectionBase<T extends defined> implements ReadonlyObservableCollection<T> {
	protected readonly _changed = new ArgsSignal<[collectionChangedType: CollectionChangedArgs<T>]>();
	readonly collectionChanged = this._changed.asReadonly();

	abstract size(): number;
	abstract getArr(): readonly T[];

	/** Clear the collection and add the provided items */
	setRange(items: readonly T[]) {
		this.clear();
		this.add(...items);
	}

	protected abstract _add(...items: readonly T[]): readonly T[];
	protected abstract _remove(...items: readonly T[]): readonly T[];
	protected abstract _clear(): void;

	/** Add the provided items */
	add(...items: readonly T[]) {
		items = this._add(...items);
		if (items.size() === 0) return;

		this._changed.Fire({ kind: "add", added: items });
	}
	/** Add the provided items */
	push(...items: readonly T[]) {
		this.add(...items);
	}

	/** Remove the provided items */
	remove(...items: readonly T[]) {
		items = this._remove(...items);
		if (items.size() === 0) return;

		this._changed.Fire({ kind: "remove", removed: items });
	}
	/** Clear the collection */
	clear() {
		if (this.size() === 0) return;

		this._clear();
		this._changed.Fire({ kind: "clear" });
	}

	destroy(): void {
		this._changed.destroy();
	}

	asReadonly(): ReadonlyObservableCollection<T> {
		return this;
	}
}

export interface ObservableCollectionArr<T extends defined> extends ObservableValue<readonly T[]> {}
export class ObservableCollectionArr<T extends defined>
	extends ObservableCollectionBase<T>
	implements ReadonlyObservableCollectionArr<T>, ObservableValueBase<readonly T[]>
{
	readonly changed;
	private readonly items: T[] = [];

	constructor(items: readonly T[] = []) {
		super();
		this.items = [...items];

		const changed = new ArgsSignal<[value: readonly T[]]>();
		this.changed = changed.asReadonly();
		this.collectionChanged.Connect(() => changed.Fire(this.get()));
	}

	get(): readonly T[] {
		return this.items;
	}
	getArr(): readonly T[] {
		return this.get();
	}

	/** Clear the collection and add the provided items. For compatibility with ObservableValue. */
	set(items: readonly T[]): void {
		this.clear();
		this.add(...items);
	}

	size(): number {
		return this.items.size();
	}
	has(item: T) {
		return this.items.includes(item);
	}

	/** Pop the last added item */
	pop(): T | undefined {
		const item = this.items.pop();

		if (item !== undefined) {
			this._changed.Fire({ kind: "remove", removed: [item] });
		}

		return item;
	}

	protected _add(...items: readonly T[]): readonly T[] {
		for (const item of items) {
			this.items.push(item);
		}

		return items;
	}
	protected _remove(...items: readonly T[]): readonly T[] {
		for (const item of items) {
			this.items.remove(this.items.indexOf(item));
		}

		return items;
	}
	protected _clear(): void {
		this.items.clear();
	}

	asReadonly(): ReadonlyObservableCollectionArr<T> {
		return this;
	}
}

export interface ObservableCollectionSet<T extends defined> extends ObservableValue<ReadonlySet<T>> {}
export class ObservableCollectionSet<T extends defined>
	extends ObservableCollectionBase<T>
	implements ReadonlyObservableCollectionSet<T>, ObservableValueBase<ReadonlySet<T>>
{
	readonly changed;
	private readonly items: Set<T>;

	constructor(items: readonly T[] = []) {
		super();
		this.items = new Set<T>(items);

		const changed = new ArgsSignal<[value: ReadonlySet<T>]>();
		this.changed = changed.asReadonly();
		this.collectionChanged.Connect(() => changed.Fire(this.get()));
	}

	get(): ReadonlySet<T> {
		return this.items;
	}
	getArr(): readonly T[] {
		return [...this.get()];
	}

	/** Clear the collection and add the provided items. For compatibility with ObservableValue. */
	set(items: ReadonlySet<T>): void {
		this.clear();
		this.add(...items);
	}

	size(): number {
		return this.items.size();
	}
	has(item: T) {
		return this.items.has(item);
	}

	protected _add(...items: readonly T[]): readonly T[] {
		const added: T[] = [];
		for (const item of items) {
			if (this.items.has(item)) {
				continue;
			}

			added.push(item);
			this.items.add(item);
		}

		return added;
	}
	protected _remove(...items: readonly T[]): readonly T[] {
		const deleted: T[] = [];
		for (const item of items) {
			if (!this.items.has(item)) {
				continue;
			}

			deleted.push(item);
			this.items.delete(item);
		}

		return deleted;
	}
	protected _clear(): void {
		this.items.clear();
	}

	asReadonly(): ReadonlyObservableCollectionSet<T> {
		return this;
	}
}
