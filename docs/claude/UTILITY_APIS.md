# Utility APIs

**The first place to look whenever you are about to write a helper.** The utility layer is deep and most "small
helpers" already exist, often under a name you would not guess — a method on the type where a free function
seemed needed. The file index at the bottom lists every one.

> Extracted from `CLAUDE.md`, which keeps the tripwires and routes here for detail.

## Reading the index

The index is generated from `src/` by `npm run docs:utils`; `npm run docs:utils:check` fails when it no longer
matches. Each file gets a hand-written one-sentence description, which regeneration keeps, followed by every
export with its signature:

- `Name.member` — static, or a member of a namespace or object
- `Name#member` — an instance member; in a `.propmacro.ts` file, the method that file adds to the type, so
  `Vector3#apply` is called as `v.apply(f)`
- `new Name(…)` — a constructor
- *(deprecated)* — tagged `@deprecated`; `@deprecated Internal use only` in `t.propmacro` and
  `FakeObservableValue.propmacro` marks plumbing, not API

It covers `engine/shared/fixes`, `engine/shared/utils`, `engine/shared/event`, `shared/utils`, every
`.propmacro.ts`, and the loose helpers listed at the top of `scripts/utility-index.js`. When you add a file there,
run `npm run docs:utils` and write its description. `.d.ts` files are not indexed; the ambient type helpers are
listed below.

**A propmacro method needs no import.** The compiler registers every `.propmacro.ts` in the program and inserts
the `require` at each call site — `RadioTransmitterBlock.ts` calls `t.any.as<…>()` without importing
`t.propmacro`, and its compiled output requires it anyway. The hoist at the top of each propmacro file must stay
(see the `CLAUDE.md` tripwire).

## Choosing between overlapping helpers

- **Two `Colors` namespaces.** Both are named `Colors`, so only the import path tells them apart. They carry the
  same nine base colours with identical values, and `toInt` / `lightenPressed` are identical. Use
  `shared/Colors`: it is the only one with the palette. `engine/shared/Colors` is for code under `engine/`, which
  does not import from `shared/`; the one thing unique to it is `grayscale(b)`. The 23 game-side files that still
  import the engine copy are migration candidates, not examples to follow.
- **`v.apply(f)` over `VectorUtils.apply(v, f)`.** The macro's callback also receives the axis name.
  `VectorUtils` exists for static contexts with no receiver.
- **`Objects.empty`** is one shared empty array to use as a default instead of allocating `[]` per call. It is
  `readonly` at the type level only, not `table.freeze`d, so never pass it somewhere that might mutate it.
- **`t` is repo-local, not the `@rbxts/t` package.** `t.Type#as` and `t.Type#nominal` change only the
  compile-time type; `.as<T>()` validates nothing at runtime. `t.Infer<typeof checker>` derives the TypeScript
  type, so the checker stays the single source of truth.
- **`this.event.loop(interval, func)` over a hand-written `task.spawn` loop.** It calls `func` only while the
  component is enabled and stops once the component is destroyed.
- **`this.event.subscribe`** connects through `onEnable`, so the connection is dropped on disable and made again
  on every enable.
- **`BB`** for bounding-box maths rather than hand-rolled `GetBoundingBox` arithmetic, and **`JSON`** (from
  `fixes/Json`) rather than `HttpService:JSONEncode` for anything holding Roblox datatypes.

## Global type helpers

`engine/shared/fixes/Types.d.ts` is ambient — **no import needed**, and these are easy to reimplement by
accident:

`Replace<T, K, V>`, `ReplaceWith<T, Props>`, `MakePartial<T, K>`, `MakeRequired<T, K>`, `OmitOverUnion<T, K>`,
`ConstructorOf<T, Args>`, `AbstractConstructorOf<T, Args>`, `InstanceOf<T>`, `ArgsOf<T>`,
`ConstructorToFunction<T>`, `PartialThrough<T>`.

## File index

<!-- utility-index:begin -->

### `client/Action.propmacro.ts`

Adds `initKeybind` to `Action` and `HoldAction`, binding a `KeybindRegistration` to the action with a keybind tooltip that follows `canExecute`.

- `interface ActionKeybindConfig`
- `Action#initKeybind(keybind: KeybindRegistration, config?: ActionKeybindConfig): void`
- `HoldAction#initKeybind(keybind: KeybindRegistration, config?: ActionKeybindConfig): void`

### `client/CursorService.ts`

What is under the cursor (the camera ray, the world point, and the plot or world hit), resolved at most once per frame per filter, plus press, hold and release signals built on it.

- `type CursorHit`
- `type CursorFilter`
- `const plotRaycastParams: RaycastParams`
- `isCursorUsable(): boolean`
- `castCursor(filter?: CursorFilter): CursorHit | undefined`
- `hitFaceNormal(hit: CursorHit): Vector3`
- `snapNormalToFace(part: BasePart, normal: Vector3): Vector3`
- `getCursorRay(): Ray`
- `getCursorPoint(): Vector3`
- `class CursorService extends HostedService`
- `readonly CursorService#pressed: ArgsSignal<[hit: CursorHit]>`
- `readonly CursorService#held: ArgsSignal<[hit: CursorHit]>`
- `readonly CursorService#released: ArgsSignal<[]>`
- `readonly CursorService#rightPressed: ArgsSignal<[hit: CursorHit]>`
- `new CursorService()`
- `CursorService#getRay(): Ray`
- `CursorService#getPoint(): Vector3`
- `CursorService#getHit(filter?: CursorFilter): CursorHit | undefined`

### `client/Theme.propmacro.ts`

Adds `themeButton` to `InstanceComponent<GuiButton>`, keeping the button's `BackgroundColor3` on a theme colour key and following the key when it is an observable.

- `InstanceComponent#themeButton(theme: Theme, key: ThemeColorKey | ReadonlyObservableValue<ThemeColorKey>): this`

### `engine/client/component/Component.propmacro.ts`

GUI helpers on `Component` and `InstanceComponent`: parenting GUI children, getting or adding the button, button-text, visibility and transform components, and shorthands for button actions, text, interactability and visibility.

- `type GuiButtonActionIndicator.Func`
- `GuiButtonActionIndicator.hide(selv: InstanceComponent<GuiButton>, action: Action): void`
- `GuiButtonActionIndicator.interactability(selv: InstanceComponent<GuiButton>, action: Action): void`
- `Component#parentGui<T extends icpm<GuiObject>>(child: T, config?: ComponentParentConfig): T`
- `InstanceComponent#buttonComponent(): ButtonComponent`
- `InstanceComponent#addButtonAction(func: () => void): this`
- `InstanceComponent#addButtonActionSelf(func: (selv: this) => void): this`
- `InstanceComponent#buttonInteractabilityComponent(): ButtonInteractabilityComponent`
- `InstanceComponent#setButtonInteractable(interactable: boolean): this`
- `InstanceComponent#buttonTextComponent(): ButtonTextComponent`
- `InstanceComponent#setButtonText(text: string): this`
- `InstanceComponent#visibilityComponent(): VisibilityComponent`
- `InstanceComponent#show(key?: ValueOverlayKey): void`
- `InstanceComponent#hide(key?: ValueOverlayKey): void`
- `InstanceComponent#hideThenDestroy(): void`
- `InstanceComponent#setVisibleAndEnabled(visible: boolean, key?: ValueOverlayKey): void`
- `InstanceComponent#setInstanceVisibility(visible: boolean, key?: ValueOverlayKey): void`
- `InstanceComponent#isInstanceVisible(): boolean`
- `InstanceComponent#transformComponent(): TransformComponent`
- `InstanceComponent#subscribeVisibilityFrom(values: { readonly [k in string]: ReadonlyObservableValue<boolean> }): this`
- `InstanceComponent#subscribeToAction<TArgs extends unknown[]>(action: Action<TArgs>, ...args: TArgs): this`

### `engine/client/gui/ComponentEvents.propmacro.ts`

Input subscriptions on `ComponentEvents` that are set up on enable and again whenever the input type changes (desktop, touch, gamepad), plus input-begin/end and key-down/up shorthands.

- `ComponentEvents#onPrepare(callback: (inputType: InputType, eventHandler: EventHandler, inputHandler: InputHandler) => void): void`
- `ComponentEvents#onPrepareDesktop(callback: (eventHandler: EventHandler, inputHandler: InputHandler) => void): void`
- `ComponentEvents#onPrepareTouch(callback: (eventHandler: EventHandler, inputHandler: InputHandler) => void): void`
- `ComponentEvents#onPrepareGamepad(callback: (eventHandler: EventHandler, inputHandler: InputHandler) => void): void`
- `ComponentEvents#onInputBegin(callback: (input: InputObject) => void): void`
- `ComponentEvents#onInputEnd(callback: (input: InputObject) => void): void`
- `ComponentEvents#onKeyDown(key: KeyCode, callback: (input: InputObject) => void): void`
- `ComponentEvents#onKeyUp(key: KeyCode, callback: (input: InputObject) => void): void`
- `ComponentEvents#subInput(setup: (inputHandler: InputHandler, eventHandler: EventHandler) => void): void`

### `engine/client/gui/TooltipComponent.propmacro.ts`

Adds `tooltipComponent` (get or add) and `setTooltipText` to `InstanceComponent`.

- `InstanceComponent#tooltipComponent(): TooltipComponent`
- `InstanceComponent#setTooltipText(text: string | undefined): this`

### `engine/shared/Assert.ts`

Throwing assertions that narrow with TypeScript `asserts` (type, nil, boolean, equality, sequence, set and property equality), plus a small `Testing.test`/`expect` harness.

- `Assert.is<T, K extends keyof CheckableTypes>(value: T, valueType: K, message?: string): asserts value is T & CheckableTypes[K]`
- `Assert.isNot<T, K extends keyof CheckableTypes>(value: T, valueType: K, message?: string): asserts value is Exclude<T, CheckableTypes[K]>`
- `Assert.notNull<T>(value: T, message?: string): asserts value is T & defined`
- `Assert.isNull<T>(value: T, message?: string): asserts value is T & undefined`
- `Assert.isTrue(condition: boolean, message?: string): asserts condition is true`
- `Assert.isFalse(condition: boolean, message?: string): asserts condition is false`
- `Assert.almostEquals(left: number | { get(): number; }, right: number | { get(): number; }, message?: string): void`
- `Assert.equals<T>(left: T | { get(): T; }, right: T | { get(): T; }, message?: string): void`
- `Assert.sequenceEquals<T>(left: readonly T[], right: readonly T[], message?: string): void`
- `Assert.setEquals<T>(left: ReadonlySet<T>, right: ReadonlySet<T>, message?: string): void`
- `Assert.propertiesEqual<T extends object, P extends object>(object: T, properties: P, message?: string): asserts object is T & P`
- `Assert.Testing.test(description: string, test: () => void): void`
- `Assert.Testing.expect<T>(value: T): Expect<T>`
- `class Assert.Testing.Expect<T>`
- `new Assert.Testing.Expect<T>(value: T)`
- `Assert.Testing.Expect#toBe<T extends boolean | number | string>(value: T): Expect<T>`
- `Assert.Testing.Expect#toEqual<T extends readonly unknown[]>(value: T): Expect<T>`

### `engine/shared/Colors.ts`

The engine layer's copy of the nine base colours with `toInt`, `grayscale` and `lightenPressed`; code outside `engine/` uses `shared/Colors.ts` instead.

- `const Colors.white: Color3`
- `const Colors.black: Color3`
- `const Colors.red: Color3`
- `const Colors.green: Color3`
- `const Colors.blue: Color3`
- `const Colors.yellow: Color3`
- `const Colors.pink: Color3`
- `const Colors.purple: Color3`
- `const Colors.orange: Color3`
- `Colors.toInt(color: Color3): number`
- `Colors.grayscale(b: number): Color3`
- `Colors.lightenPressed(color: Color3): Color3`

### `engine/shared/Element.ts`

`Element.create` builds an instance from a class name, a property table and named children in one call, typed so the children are reachable as fields; `newFont` builds a `Font` from an `Enum.Font` and a weight.

- `type ElementProperties<T extends Instance>`
- `Element.create<T extends keyof CreatableInstances, const TChildren extends Readonly<Record<string, Instance>>>(instanceType: T, properties?: ElementProperties<CreatableInstances[T]>): CreatableInstances[T]`
- `Element.create<T extends keyof CreatableInstances, const TChildren extends Readonly<Record<string, Instance>>>(instanceType: T, properties?: ElementProperties<CreatableInstances[T]>, children?: TChildren): CreatableInstances[T] & { [k in keyof TChildren]: TChildren[k]; }`
- `Element.newFont(font: Enum.Font, weight: Enum.FontWeight): Font`

### `engine/shared/Lazy.ts`

A value computed by its loader on the first `get()` and returned from cache after that.

- `class Lazy<T>`
- `new Lazy<T>(load: () => T)`
- `Lazy#get(): T`

### `engine/shared/Operation.ts`

A function wrapped with `executing`/`executed` signals and middlewares that run before each `execute`, where any middleware can reject the call or replace its argument.

- `type MiddlewareResponse<TArg>`
- `class Operation<TArg, TResult extends {} = {}>`
- `readonly Operation#executing: ReadonlyArgsSignal<[arg: TArg]>`
- `readonly Operation#executed: ReadonlyArgsSignal<[arg: TArg, result: TResult]>`
- `new Operation<TArg, TResult extends {} = {}>(func: (arg: TArg) => Response<TResult>)`
- `Operation#addMiddleware(middleware: (arg: TArg) => MiddlewareResponse<TArg>): SignalConnection`
- `Operation#createMiddlewareCombiner(): { readonly addFunc: (func: (arg: TArg) => MiddlewareResponse<TArg>) => SignalConnection; readonly connection: SignalConnection; }`
- `Operation#execute(arg: TArg): Response<TResult>`

### `engine/shared/Throttler.ts`

`forEach` spreads work across frames by yielding after every N items, and `retryOnFail` retries a throwing function up to N times with a delay between attempts.

- `Throttler.forEach<T>(itemsPerFrame: number, items: readonly T[], func: (item: T) => void): void`
- `Throttler.retryOnFail<T>(times: number, delay: number, func: () => T): { success: true; message: T; } | { success: false; error_message: unknown; }`

### `engine/shared/component/Component.propmacro.ts`

`Component` conveniences: set or switch the enabled state, one subscription for both enable directions, `with`/`withParented` chaining, `asTemplate` clone factories and `parentDestroyOnly`, plus `getAttribute` on `InstanceComponent`.

- `Component#setEnabled(enabled: boolean): void`
- `Component#switchEnabled(): void`
- `Component#onEnabledStateChange(func: (enabled: boolean) => void, executeImmediately?: boolean): void`
- `Component#with(func: (selv: this) => void): this`
- `Component#withParented(child: Component): this`
- `Component#asTemplate<T extends Instance>(object: T, destroyOriginal?: boolean): () => T`
- `Component#parentDestroyOnly<T extends Component>(child: T): T`
- `InstanceComponent#getAttribute<T extends AttributeValue>(name: string): T | undefined`

### `engine/shared/component/ComponentEvents.propmacro.ts`

The `this.event` subscription API: signal, observable, collection and map subscriptions tied to the component's enabled state, instance-property and attribute observables, and `loop`, which calls its function only while the component is enabled.

- `ComponentEvents#onEnable(func: (eh: EventHandler) => void, executeImmediately?: boolean): void`
- `ComponentEvents#subscribe<TArgs extends unknown[]>(signal: ReadonlyArgsSignal<TArgs>, callback: (...args: TArgs) => void): void`
- `ComponentEvents#subscribeRegistration(func: () => SignalConnection | readonly SignalConnection[] | undefined): void`
- `ComponentEvents#subscribeDestroyable<T extends ComponentTypes.DestroyableComponent>(component: T): T`
- `ComponentEvents#subscribeImmediately<TArgs extends unknown[]>(signal: ReadonlyArgsSignal<TArgs>, callback: () => void, executeOnEnable?: boolean, executeImmediately?: boolean): void`
- `ComponentEvents#subscribeObservable<T>(observable: ReadonlyObservableValue<T>, callback: (value: T) => void, executeOnEnable?: boolean, executeImmediately?: boolean): void`
- `ComponentEvents#subscribeObservablePrev<T>(observable: ReadonlyObservableValue<T>, callback: (value: T, prev: T) => void, executeOnEnable?: boolean, executeImmediately?: boolean): void`
- `ComponentEvents#subscribeCollection<T extends defined>(observable: ReadonlyObservableCollection<T>, callback: (update: CollectionChangedArgs<T>) => void, executeOnEnable?: boolean, executeImmediately?: boolean): void`
- `ComponentEvents#subscribeCollectionAdded<T extends defined>(observable: ReadonlyObservableCollection<T>, callback: (item: T) => void, executeOnEnable?: boolean, executeImmediately?: boolean): void`
- `ComponentEvents#subscribeMap<K extends defined, V extends defined>(observable: ReadonlyObservableMap<K, V>, callback: (key: K, value: V | undefined) => void, executeOnEnable?: boolean, executeImmediately?: boolean): void`
- `ComponentEvents#readonlyObservableFromInstanceParam<TInstance extends Instance, TParam extends InstancePropertyNames<TInstance>>(instance: TInstance, param: TParam): ReadonlyObservableValue<TInstance[TParam]>`
- `ComponentEvents#observableFromInstanceParam<TInstance extends Instance, TParam extends InstancePropertyNames<TInstance>>(instance: TInstance, param: TParam): ObservableValue<TInstance[TParam]>`
- `ComponentEvents#observableFromAttribute<TType extends AttributeValue>(instance: Instance, name: string): ObservableValue<TType | undefined>`
- `ComponentEvents#observableFromAttributeJson<TType>(instance: Instance, name: string): ObservableValue<TType | undefined>`
- `ComponentEvents#addObservable<T>(creation: FakeObservableValue<T>): ObservableValue<T>`
- `ComponentEvents#addObservable<T>(creation: ReadonlyFakeObservableValue<T>): ReadonlyObservableValue<T>`
- `ComponentEvents#loop(interval: number, func: (dt: number) => void): SignalConnection`

### `engine/shared/component/ComponentEvents.ts`

The object behind `this.event`: an `EventHandler` that unsubscribes everything when its component is disabled.

- `class ComponentEvents`
- `readonly ComponentEvents#eventHandler: EventHandler`
- `new ComponentEvents(state: Component)`
- `readonly ComponentEvents#state: Component`

### `engine/shared/component/InstanceValuesComponent.propmacro.ts`

Shorthands on `InstanceComponent` for layered property values: get or add the values component, overlay a value on a property, and set up a simple transform for a property.

- `InstanceComponent#valuesComponent(): InstanceValuesComponent<T>`
- `InstanceComponent#addValueOverlayChild<K extends keyof T>(key: K, value: OverlaySubValue<T[K]>): this`
- `InstanceComponent#overlayValue<K extends keyof T>(key: K, value: OverlaySubValue<T[K]>, overlayKey?: ValueOverlayKey | undefined): this`
- `InstanceComponent#initializeSimpleTransform(key: keyof T, props?: TransformProps): this`

### `engine/shared/component/SecondaryTransform.propmacro.ts`

Higher-level `TransformBuilder` steps: running and waiting on transforms, conditionals and loops, animated text replacement, flashes, and GUI move, resize, fade and visibility.

- `TransformBuilder#run(key: object, cancelExisting?: boolean): RunningTransform`
- `TransformBuilder#waitForTransformOf(key: object): TransformBuilder`
- `TransformBuilder#waitForTransformOfChildren(component: Component): TransformBuilder`
- `TransformBuilder#if(condition: boolean, func: (builder: this) => unknown): this`
- `TransformBuilder#for<K, V>(items: ReadonlyMap<K, V>, func: (key: K, item: V, builder: this) => unknown): this`
- `TransformBuilder#setText<T extends object, TKey extends ExtractKeys<T, string>>(object: T, text: T[TKey], property: TKey, params?: TransformProps): this`
- `TransformBuilder#flash<T extends object, TKey extends keyof T>(object: T, value: T[TKey] & defined, property: TKey, propsIn?: TransformProps, propsOut?: TransformProps): this`
- `TransformBuilder#destroy(instance: Instance): this`
- `TransformBuilder#move(instance: GuiObject, position: UDim2, params?: TransformProps): this`
- `TransformBuilder#moveX(instance: GuiObject, position: UDim, params?: TransformProps): this`
- `TransformBuilder#moveY(instance: GuiObject, position: UDim, params?: TransformProps): this`
- `TransformBuilder#resize(instance: GuiObject, size: UDim2, params?: TransformProps): this`
- `TransformBuilder#moveRelative(instance: GuiObject, offset: UDim2, params?: TransformProps): this`
- `TransformBuilder#resizeRelative(instance: GuiObject, offset: UDim2, params?: TransformProps): this`
- `TransformBuilder#setVisible(instance: GuiObject, visible: boolean): this`
- `TransformBuilder#show(instance: GuiObject): this`
- `TransformBuilder#hide(instance: GuiObject): this`
- `TransformBuilder#fadeIn(instance: GuiObject, props?: TransformProps): this`
- `TransformBuilder#fadeOut(instance: GuiObject, props?: TransformProps): this`
- `TransformBuilder#fadeInFrom0(instance: GuiObject, props: TransformProps): this`
- `TransformBuilder#fadeOutFrom1(instance: GuiObject, props: TransformProps): this`
- `TransformBuilder#fullFadeOut(instance: GuiObject, props?: TransformProps): this`
- `TransformBuilder#flashColor<T extends GuiObject>(instance: T, color: Color3, property?: ExtractKeys<T & GuiObject, Color3> | "BackgroundColor3", props?: TransformProps): this`

### `engine/shared/component/Transform.propmacro.ts`

The basic `TransformBuilder` steps: call a function, wait, run in parallel, repeat, wait for another transform, and tween a property, several properties, an observable or a custom setter.

- `TransformBuilder#func(func: () => void): this`
- `TransformBuilder#wait(delay: number): this`
- `TransformBuilder#parallel(...transforms: readonly TransformBuilder[]): this`
- `TransformBuilder#repeat(amount: number, func: (transform: TransformBuilder) => void): this`
- `TransformBuilder#waitForTransform(transform: RunningTransform): this`
- `TransformBuilder#transformMulti<T extends object, TKey extends keyof T>(object: T, value: { readonly [k in TKey]?: T[TKey] }, params?: TransformProps): this`
- `TransformBuilder#transform<T extends object, TKey extends keyof T>(object: T, key: TKey, value: TransformValue<T[TKey]>, params?: TransformProps): this`
- `TransformBuilder#funcTransform<T>(startValue: TransformValue<T, []>, endValue: TransformValue<T, []>, setFunc: (value: T) => void, params?: TransformProps): this`
- `TransformBuilder#transformObservable<T>(observable: ObservableValue<T>, endValue: TransformValue<T>, params?: TransformProps): this`
- `TransformBuilder#setup(setup: ((transform: TransformBuilder) => void) | undefined): this`

### `engine/shared/event/EventHandler.ts`

Holds connections to Roblox and engine signals so they can all be disconnected together with `unsubscribeAll`.

- `class EventHandler`
- `EventHandler#subscribe<TArgs extends unknown[]>(signal: ReadonlyArgsSignal<TArgs>, callback: (...args: TArgs) => void): void`
- `EventHandler#subscribeOnce<TArgs extends unknown[]>(signal: RBXScriptSignal<(...args: TArgs) => void>, callback: (...args: TArgs) => void): void`
- `EventHandler#register(disconnectable: SignalConnection): void`
- `EventHandler#unsubscribeAll(): void`

### `engine/shared/event/FakeObservableValue.propmacro.ts`

Observables derived from another one (mapped with `fCreateBased`, defaulted with `fWithDefault`, or a set viewed as an array) that read and write through to their source and must be destroyed to disconnect.

- `interface FakeObservableValue<T>`
- `interface ReadonlyFakeObservableValue<T>`
- `interface DestoyableOV<T>`
- `class DestoyableOV<T> extends ObservableValue<T>`
- `DestoyableOV#onDestroy(func: () => void): void`
- `DestoyableOV#destroy(): void`
- `ReadonlyObservableValue#fReadonlyCreateBased<U>(funcTo: (value: T) => U): ReadonlyFakeObservableValue<U>`
- `ReadonlyObservableValue#fReadonlyWithDefault<U>(value: U): ReadonlyFakeObservableValue<(T & defined) | U>`
- `ObservableValue#fCreateBased<U>(funcTo: (value: T) => U, funcFrom: (value: U, existing: T) => T, equalityFunc?: (oldv: T, newv: T) => boolean): FakeObservableValue<U>`
- `ObservableValue#fWithDefault<U>(value: U): FakeObservableValue<(T & defined) | U>`
- `ObservableValue#asArray<Item>(): FakeObservableValue<readonly Item[]>`

### `engine/shared/event/NumberObservableValue.ts`

An `ObservableValue` whose number is clamped to a min, max and optional step on every set, with NaN replaced by the min.

- `class NumberObservableValue<T extends number | undefined = number> extends ObservableValue<T>`
- `readonly NumberObservableValue#min: number`
- `readonly NumberObservableValue#max: number`
- `readonly NumberObservableValue#step: number | undefined`
- `new NumberObservableValue<T extends number | undefined = number>(value: T, min: number, max: number, step?: number)`
- `NumberObservableValue#getRange(): number`

### `engine/shared/event/ObservableCollection.ts`

Observable array and set collections that fire `changed` and a typed add/remove/set update for each change.

- `type CollectionChangedArgs<T>`
- `interface ReadonlyObservableCollection<T extends defined>`
- `interface ReadonlyObservableCollectionArr<T extends defined>`
- `interface ReadonlyObservableCollectionSet<T extends defined>`
- `interface ObservableCollectionArr<T extends defined>`
- `class ObservableCollectionArr<T extends defined> extends ObservableCollectionBase<T> implements ReadonlyObservableCollectionArr<T>, ObservableValueBase<readonly T[]>`
- `readonly ObservableCollectionArr#changed: ReadonlyArgsSignal<[value: readonly T[]]>`
- `new ObservableCollectionArr<T extends defined>(items?: readonly T[])`
- `ObservableCollectionArr#get(): readonly T[]`
- `ObservableCollectionArr#getArr(): readonly T[]`
- `ObservableCollectionArr#set(items: readonly T[]): void`
- `ObservableCollectionArr#size(): number`
- `ObservableCollectionArr#has(item: T): boolean`
- `ObservableCollectionArr#pop(): T | undefined`
- `ObservableCollectionArr#asReadonly(): ReadonlyObservableCollectionArr<T>`
- `interface ObservableCollectionSet<T extends defined>`
- `class ObservableCollectionSet<T extends defined> extends ObservableCollectionBase<T> implements ReadonlyObservableCollectionSet<T>, ObservableValueBase<ReadonlySet<T>>`
- `readonly ObservableCollectionSet#changed: ReadonlyArgsSignal<[value: ReadonlySet<T>]>`
- `new ObservableCollectionSet<T extends defined>(items?: readonly T[])`
- `ObservableCollectionSet#get(): ReadonlySet<T>`
- `ObservableCollectionSet#getArr(): readonly T[]`
- `ObservableCollectionSet#set(items: ReadonlySet<T>): void`
- `ObservableCollectionSet#size(): number`
- `ObservableCollectionSet#has(item: T): boolean`
- `ObservableCollectionSet#asReadonly(): ReadonlyObservableCollectionSet<T>`

### `engine/shared/event/ObservableMap.ts`

A map that fires `changed(key, value)` for every entry set or removed, with `undefined` as the value on removal.

- `class ObservableMap<K extends defined, V extends defined> implements ReadonlyObservableMap<K, V>`
- `readonly ObservableMap#changed: ReadonlyArgsSignal<[key: K, value: V | undefined]>`
- `ObservableMap#size(): number`
- `ObservableMap#getAll(): ReadonlyMap<K, V>`
- `ObservableMap#get(key: K): V | undefined`
- `ObservableMap#has(key: K): boolean`
- `ObservableMap#setRange(items: ReadonlyMap<K, V>): void`
- `ObservableMap#set(key: K, value: V): void`
- `ObservableMap#remove(key: K): void`
- `ObservableMap#clear(): void`
- `ObservableMap#asReadonly(): ReadonlyObservableMap<K, V>`

### `engine/shared/event/ObservableValue.propmacro.ts`

Observable shorthands: `subscribe`/`subscribePrev`, custom-equality and wait-once subscriptions, two-way `connect` and `createBothWayBased`, and `toggle` for booleans.

- `ReadonlyObservableValue#subscribe(func: (value: T) => void, executeImmediately?: boolean): SignalConnection`
- `ReadonlyObservableValue#subscribePrev(func: (value: T, prev: T) => void, executeImmediately?: boolean): SignalConnection`
- `ReadonlyObservableValue#subscribeWithCustomEquality(func: (value: T, prev: T) => void, equalityCheck: (value: T, prev: T) => boolean, executeImmediately?: boolean): SignalConnection`
- `ReadonlyObservableValue#createBased<TNew>(func: (value: T) => TNew): ReadonlyObservableValue<TNew>` *(deprecated)*
- `ReadonlyObservableValue#waitOnceFor<U extends T>(predicate: (value: T) => value is U, action: (value: U) => void): void`
- `ReadonlyObservableValue#waitOnceFor(predicate: (value: T) => boolean, action: (value: T) => void): void`
- `ObservableValue#asReadonly(): ReadonlyObservableValue<T>`
- `ObservableValue#createBothWayBased<U>(toOld: (value: U) => T, toNew: (value: T) => U): ObservableValue<U>`
- `ObservableValue#toggle(): boolean`
- `ObservableValue#connect(other: ObservableValue<T>): SignalConnection`

### `engine/shared/event/ObservableValue.ts`

The `ObservableValue` class and its read-only interfaces: a value with a `changed` signal and an optional middleware that can rewrite each new value.

- `interface ReadonlyObservableValueBase<out T>`
- `interface ObservableValueBase<T>`
- `interface ReadonlyObservableValue<T>`
- `interface ObservableValue<T>`
- `isReadonlyObservableValue(v: unknown): v is ReadonlyObservableValue<unknown>`
- `const ObservableValue: new <T>(value: T, middleware?: (newval: T, current: T) => T) => ObservableValue<T>`

### `engine/shared/event/Observables.ts`

Builds one observable from several: a string switch over boolean observables, one bidirectional object from several observables, and an observable on a path inside an observable object.

- `Observables.createObservableSwitch<T extends string>(sources: { readonly [k in T]: ObservableValue<boolean>; }): FakeObservableValue<T>`
- `Observables.createObservableSwitchFromObject<TObj extends object, T extends string>(object: ObservableValue<TObj>, sources: { readonly [k in T]: PartialThrough<TObj>; }): FakeObservableValue<T>`
- `Observables.createObservableFromMultiple<O extends object>(observables: { readonly [k in keyof O]: ObservableValue<O[k]>; }): FakeObservableValue<O>`
- `Observables.createObservableFromMultiple<T extends defined, K extends string | number | symbol>(observables: MultiValues<ObservableValue<T>, K>): FakeObservableValue<MultiValues<T, K>>`
- `Observables.createObservableFromObjectPropertyTyped<const TObj extends object, const Key extends keyof TObj>(object: ObservableValue<TObj>, path: readonly [Key]): FakeObservableValue<TObj[Key]>`
- `Observables.createObservableFromObjectPropertyTyped<const TObj extends object, const TPath extends readonly (string | number)[]>(object: ObservableValue<TObj>, path: TPath): FakeObservableValue<Objects.ValueOf<TObj, TPath>>`
- `Observables.createObservableFromObjectProperty<T>(object: ObservableValue<object>, path: readonly (string | number)[]): FakeObservableValue<T>`

### `engine/shared/event/PERemoteEvent.ts`

Typed remote events and functions named by direction (`C2S`, `S2C`, `C2C`, `A2S`, `A2OC`, and the request/response `S2C2S` and `C2S2C`), with timeout and rate-limit middlewares.

- `type CreatableRemoteEvents`
- `type CreatableRemoteFunctions`
- `class BidirectionalRemoteEvent<TArg = undefined>`
- `readonly BidirectionalRemoteEvent#s2c: S2CRemoteEvent<TArg>`
- `readonly BidirectionalRemoteEvent#c2s: C2SRemoteEvent<TArg>`
- `new BidirectionalRemoteEvent<TArg = undefined>(name: string, eventType?: CreatableRemoteEvents)`
- `class C2SRemoteEvent<TArg = undefined> extends PERemoteEvent<CustomRemoteEvent<TArg>>`
- `readonly C2SRemoteEvent#sent: ReadonlyArgsSignal<[arg: TArg]>`
- `readonly C2SRemoteEvent#invoked: ArgsSignal<[player: Player, arg: TArg]>`
- `new C2SRemoteEvent<TArg = undefined>(name: RemoteName, eventType?: CreatableRemoteEvents)`
- `C2SRemoteEvent#send(): void`
- `C2SRemoteEvent#send(arg: TArg): void`
- `class S2CRemoteEvent<TArg = undefined> extends PERemoteEvent<CustomRemoteEvent<TArg>>`
- `readonly S2CRemoteEvent#sent: ReadonlyArgsSignal<[player: Player, arg: TArg]>`
- `readonly S2CRemoteEvent#invoked: ArgsSignal<[arg: TArg]>`
- `new S2CRemoteEvent<TArg = undefined>(name: RemoteName, eventType?: CreatableRemoteEvents)`
- `S2CRemoteEvent#send(players: Player | readonly Player[] | "everyone", arg?: TArg): void`
- `S2CRemoteEvent#send(players: Player | readonly Player[] | "everyone", arg: TArg): void`
- `PERemoteEventMiddlewares.timeout(timeout: number): WaiterMiddleware`
- `PERemoteEventMiddlewares.rateLimiter(limit: number, time: number): WaiterMiddleware`
- `class S2C2SRemoteFunction<TArg = undefined, TResp extends Response = Response> extends PERemoteEvent<CustomRemoteFunctionBase<TArg, TArg, TResp | ErrorResponse>>`
- `readonly S2C2SRemoteFunction#sent: ReadonlyArgsSignal<[arg: TArg, response: ErrorResponse | TResp]>`
- `new S2C2SRemoteFunction<TArg = undefined, TResp extends Response = Response<{}>>(name: RemoteName)`
- `S2C2SRemoteFunction#addMiddleware(middleware: WaiterMiddleware): this`
- `S2C2SRemoteFunction#subscribe(func: typeof this.invoked & defined): SignalConnection`
- `S2C2SRemoteFunction#send(this: S2C2SRemoteFunction<undefined>, player: Player, arg?: TArg): ErrorResponse | TResp`
- `S2C2SRemoteFunction#send(player: Player, arg: TArg): ErrorResponse | TResp`
- `class C2S2CRemoteFunction<TArg = undefined, TResp extends Response = Response> extends PERemoteEvent<CustomRemoteFunctionBase<TArg, TArg, TResp | ErrorResponse>>`
- `readonly C2S2CRemoteFunction#received: ReadonlyArgsSignal<[player: Player, arg: TArg]>`
- `readonly C2S2CRemoteFunction#processed: ReadonlyArgsSignal<[player: Player, arg: TArg, response: TResp & { readonly success: true; }]>`
- `readonly C2S2CRemoteFunction#sent: ReadonlyArgsSignal<[arg: TArg]>`
- `readonly C2S2CRemoteFunction#completed: ReadonlyArgsSignal<[result: ErrorResponse | TResp]>`
- `new C2S2CRemoteFunction<TArg = undefined, TResp extends Response = Response<{}>>(name: RemoteName)`
- `C2S2CRemoteFunction#addMiddleware(middleware: WaiterMiddleware): this`
- `C2S2CRemoteFunction#execute(player: Player, arg: TArg): TResp`
- `C2S2CRemoteFunction#subscribe(func: typeof this.invoked & defined): SignalConnection`
- `C2S2CRemoteFunction#send<TResponse extends Response>(arg?: TArg): ErrorResponse | TResp`
- `C2S2CRemoteFunction#send(arg: TArg): ErrorResponse | TResp`
- `class C2CRemoteEvent<TArg = undefined> extends PERemoteEvent<CustomRemoteEventBase<TArg, { players: readonly Player[]; arg: TArg }>>`
- `readonly C2CRemoteEvent#invoked: ArgsSignal<[arg: TArg]>`
- `new C2CRemoteEvent<TArg = undefined>(name: RemoteName, eventType: CreatableRemoteEvents)`
- `C2CRemoteEvent#send(arg: TArg, players?: Player | readonly Player[] | "everyone"): void`
- `class A2SRemoteEvent<TArg = undefined> extends PERemoteEvent<CustomRemoteEventBase<TArg, TArg>>`
- `readonly A2SRemoteEvent#senderInvoked: ReadonlyArgsSignal<[arg: TArg]>`
- `readonly A2SRemoteEvent#invoked: ReadonlyArgsSignal<[player: Player | undefined, arg: TArg]>`
- `new A2SRemoteEvent<TArg = undefined>(name: string, eventType?: CreatableRemoteEvents)`
- `A2SRemoteEvent#send(arg: TArg): void`
- `class A2OCRemoteEvent<TArg = undefined> extends PERemoteEvent<CustomRemoteEventBase<{ sender?: Player; arg: TArg }, { target: Player; arg: TArg }>>`
- `readonly A2OCRemoteEvent#invoked: ArgsSignal<[arg: TArg, sender?: Player | undefined]>`
- `new A2OCRemoteEvent<TArg = undefined>(name: RemoteName, eventType: CreatableRemoteEvents)`
- `A2OCRemoteEvent#send(target: Player, arg: TArg): void`

### `engine/shared/event/Signal.ts`

`ArgsSignal` and `Signal`, the engine's own signals, plus `connection`, `connectionFromTask` and `multiConnection`, which wrap cleanup as a `SignalConnection`.

- `interface ReadonlyArgsSignal<TArgs extends unknown[]>`
- `interface ReadonlySignal<T extends (...args: any[]) => void = () => void>`
- `class ArgsSignal<TArgs extends unknown[] = []> implements ReadonlyArgsSignal<TArgs>`
- `ArgsSignal.connection(func: () => void): SignalConnection`
- `ArgsSignal.connectionFromTask(thread: thread): SignalConnection`
- `ArgsSignal.multiConnection(...connections: SignalConnection[]): SignalConnection`
- `ArgsSignal#Connect(callback: (...args: TArgs) => void): SignalConnection`
- `ArgsSignal#Fire(...args: TArgs): void`
- `ArgsSignal#destroy(): void`
- `ArgsSignal#asReadonly(): ReadonlyArgsSignal<TArgs>`
- `class Signal<T extends (...args: any) => void = () => void> extends ArgsSignal<Parameters<T>>`

### `engine/shared/event/SlimFilter.ts`

A list of predicate callbacks whose `Fire` returns false when any callback returns false.

- `class SlimFilter<T extends (...args: never[]) => boolean = () => true>`
- `SlimFilter#add(callback: T): void`
- `SlimFilter#Fire(...args: Parameters<T>): boolean`
- `SlimFilter#unsubscribeAll(): void`

### `engine/shared/event/SlimSignal.ts`

A minimal signal with `Connect`, `Fire` and `destroy`, and no per-subscriber disconnect.

- `interface ReadonlySlimSignal<T extends (...args: never[]) => void>`
- `class SlimSignal<T extends (...args: never[]) => void = () => void> implements ReadonlySlimSignal<T>`
- `SlimSignal#Connect(callback: T): void`
- `SlimSignal#Fire(...args: Parameters<T>): void`
- `SlimSignal#destroy(): void`

### `engine/shared/event/SubmittableValue.ts`

An `ObservableValue` paired with a `submitted` signal that fires only on `submit`, separating committed values from intermediate `set` calls.

- `interface ReadonlySubmittableValue<T>`
- `interface SignalReadonlySubmittableValue<T>`
- `class SubmittableValue<T> implements ReadonlySubmittableValue<T>, SignalReadonlySubmittableValue<T>`
- `SubmittableValue.from<T>(value: T): SubmittableValue<T>`
- `readonly SubmittableValue#value: ObservableValue<T>`
- `readonly SubmittableValue#submitted: ReadonlyArgsSignal<[value: T, prev: T]>`
- `new SubmittableValue<T>(observable: ObservableValue<T>)`
- `SubmittableValue#get(): T`
- `SubmittableValue#set(value: T): void`
- `SubmittableValue#submit(value: T): void`
- `SubmittableValue#asFullReadonly(): ReadonlySubmittableValue<T>`
- `SubmittableValue#asHalfReadonly(): SignalReadonlySubmittableValue<T>`

### `engine/shared/fixes/Arrays.propmacro.ts`

The LINQ-style methods on arrays, sets and maps: counting, searching, filtering, mapping to any of the three, grouping, chunking, exclusion, conversion and comparison.

- `ReadonlyArray#count(func?: (value: T, index: number) => boolean): number`
- `ReadonlyArray#all(func: (value: T, index: number) => boolean): boolean`
- `ReadonlyArray#any(): boolean`
- `ReadonlyArray#any(func: (value: T, index: number) => boolean): boolean`
- `ReadonlyArray#contains(value: T): boolean`
- `ReadonlySet#count(func?: (value: T) => boolean): number`
- `ReadonlySet#all(func: (value: T) => boolean): boolean`
- `ReadonlySet#any(): boolean`
- `ReadonlySet#any(func: (value: T) => boolean): boolean`
- `ReadonlySet#contains(value: T): boolean`
- `ReadonlyMap#count(func?: (key: K, value: V) => boolean): number`
- `ReadonlyMap#all(func: (key: K, value: V) => boolean): boolean`
- `ReadonlyMap#any(): boolean`
- `ReadonlyMap#any(func: (key: K, value: V) => boolean): boolean`
- `ReadonlyMap#containsKey(key: K): boolean`
- `ReadonlyMap#containsValue(value: V): boolean`
- `ReadonlyArray#first(): T | undefined`
- `ReadonlySet#first(): T | undefined`
- `ReadonlyMap#firstKey(): K | undefined`
- `ReadonlyMap#firstValue(): V | undefined`
- `ReadonlyArray#filter<S extends T>(callback: (value: T, index: number, array: ReadonlyArray<T>) => value is S): S[]`
- `ReadonlyArray#filter(callback: (value: T, index: number, array: ReadonlyArray<T>) => boolean | undefined): T[]`
- `ReadonlyArray#filterToSet<S extends T>(callback: (value: T, index: number, array: ReadonlyArray<T>) => value is S): Set<S>`
- `ReadonlyArray#filterToSet(callback: (value: T, index: number, array: ReadonlyArray<T>) => boolean | undefined): Set<T>`
- `ReadonlyArray#filterToMap<S extends T>(callback: (value: T, index: number, array: ReadonlyArray<T>) => value is S): Map<number, S>`
- `ReadonlyArray#filterToMap(callback: (value: T, index: number, array: ReadonlyArray<T>) => boolean | undefined): Map<number, T>`
- `ReadonlySet#filter<S extends T>(callback: (value: T, set: ReadonlySet<T>) => value is S): S[]`
- `ReadonlySet#filter(callback: (value: T, set: ReadonlySet<T>) => boolean | undefined): T[]`
- `ReadonlySet#filterToSet<S extends T>(callback: (value: T, set: ReadonlySet<T>) => value is S): Set<S>`
- `ReadonlySet#filterToSet(callback: (value: T, set: ReadonlySet<T>) => boolean | undefined): Set<T>`
- `ReadonlyMap#filter<S extends V>(callback: (key: K, value: V, set: ReadonlyMap<K, V>) => value is S): Map<K, S>`
- `ReadonlyMap#filter(callback: (key: K, value: V, set: ReadonlyMap<K, V>) => boolean | undefined): Map<K, V>`
- `ReadonlyArray#map<U extends defined>(callback: (value: T, index: number, array: ReadonlyArray<T>) => U): U[]`
- `ReadonlyArray#mapToSet<U extends defined>(callback: (value: T, index: number, array: ReadonlyArray<T>) => U): Set<U>`
- `ReadonlyArray#mapToMap<KU extends defined, VU extends defined>(callback: (value: T, index: number, array: ReadonlyArray<T>) => LuaTuple<[key: KU, value: VU | undefined]>): Map<KU, VU>`
- `ReadonlySet#map<U extends defined>(callback: (value: T, set: ReadonlySet<T>) => U): U[]`
- `ReadonlySet#mapToSet<U extends defined>(callback: (value: T, set: ReadonlySet<T>) => U): Set<U>`
- `ReadonlySet#mapToMap<KU extends defined, VU extends defined>(callback: (value: T, set: ReadonlySet<T>) => LuaTuple<[key: KU, value: VU | undefined]>): Map<KU, VU>`
- `ReadonlyMap#map<U extends defined>(func: (key: K, value: V, map: ReadonlyMap<K, V>) => U): U[]`
- `ReadonlyMap#mapToSet<U extends defined>(func: (key: K, value: V, map: ReadonlyMap<K, V>) => U): Set<U>`
- `ReadonlyMap#mapToMap<KU extends defined, VU extends defined>(callback: (key: K, value: V, map: ReadonlyMap<K, V>) => LuaTuple<[key: KU, value: VU | undefined]>): Map<KU, VU>`
- `ReadonlyArray#flatmap<U extends defined>(func: (value: T, index: number, arr: ReadonlyArray<T>) => readonly U[]): U[]`
- `ReadonlyArray#flatmapToSet<U extends defined>(func: (value: T, index: number, arr: ReadonlyArray<T>) => readonly U[]): Set<U>`
- `ReadonlyArray#flatmapToMap<KU extends defined, VU extends defined>(func: (value: T, index: number, arr: ReadonlyArray<T>) => readonly (readonly [key: KU, value: VU])[]): Map<KU, VU>`
- `ReadonlySet#flatmap<U extends defined>(func: (value: T, set: ReadonlySet<T>) => readonly U[]): U[]`
- `ReadonlySet#flatmapToSet<U extends defined>(func: (value: T, set: ReadonlySet<T>) => readonly U[]): Set<U>`
- `ReadonlySet#flatmapToMap<KU extends defined, VU extends defined>(func: (value: T, set: ReadonlySet<T>) => readonly (readonly [key: KU, value: VU])[]): Map<KU, VU>`
- `ReadonlyMap#flatmap<U extends defined>(func: (key: K, value: V, map: ReadonlyMap<K, V>) => readonly U[]): U[]`
- `ReadonlyMap#flatmapToSet<U extends defined>(func: (key: K, value: V, map: ReadonlyMap<K, V>) => readonly U[]): Set<U>`
- `ReadonlyMap#flatmapToMap<KU extends defined, VU extends defined>(func: (key: K, value: V, map: ReadonlyMap<K, V>) => readonly (readonly [key: KU, value: VU])[]): Map<KU, VU>`
- `ReadonlyArray#chunk(size: number): T[][]`
- `ReadonlySet#chunk(size: number): T[][]`
- `ReadonlyMap#chunk(size: number): [key: K, value: V][][]`
- `ReadonlyArray#keys(): number[]`
- `ReadonlyArray#keysSet(): Set<number>`
- `ReadonlySet#values(): T[]`
- `ReadonlySet#valuesSet(): Set<T>`
- `ReadonlyMap#keys(): K[]`
- `ReadonlyMap#values(): V[]`
- `ReadonlyMap#keysSet(): Set<K>`
- `ReadonlyMap#valuesSet(): Set<V>`
- `ReadonlyArray#find<U extends T>(func: (value: T, index: number, arr: ReadonlyArray<T>) => value is U): U | undefined`
- `ReadonlyArray#find(func: (value: T, index: number, arr: ReadonlyArray<T>) => boolean | undefined): T | undefined`
- `ReadonlySet#find<U extends T>(func: (value: T, set: ReadonlySet<T>) => value is U): U | undefined`
- `ReadonlySet#find(func: (value: T, set: ReadonlySet<T>) => boolean | undefined): T | undefined`
- `ReadonlyMap#find(func: (key: K, value: V, map: ReadonlyMap<K, V>) => boolean | undefined): LuaTuple<[K, V]> | LuaTuple<[undefined, undefined]>`
- `ReadonlyMap#findKey<U extends K>(func: (key: K, value: V, map: ReadonlyMap<K, V>) => key is U): U | undefined`
- `ReadonlyMap#findKey(func: (key: K, value: V, map: ReadonlyMap<K, V>) => boolean | undefined): K | undefined`
- `ReadonlyMap#findValue<U extends V>(func: (key: K, value: V, map: ReadonlyMap<K, V>) => value is U): U | undefined`
- `ReadonlyMap#findValue(func: (key: K, value: V, map: ReadonlyMap<K, V>) => boolean | undefined): V | undefined`
- `ReadonlyArray#asReadonly(): ReadonlyArray<T>`
- `ReadonlyArray#clone(): T[]`
- `ReadonlySet#asReadonly(): ReadonlySet<T>`
- `ReadonlySet#clone(): Set<T>`
- `ReadonlyMap#asReadonly(): ReadonlyMap<K, V>`
- `ReadonlyMap#clone(): Map<K, V>`
- `ReadonlyArray#groupBy<U extends defined>(keyfunc: (value: T, index: number, arr: ReadonlyArray<T>) => U): Map<U, T[]>`
- `ReadonlySet#groupBy<U extends defined>(keyfunc: (value: T, ste: ReadonlySet<T>) => U): Map<U, T[]>`
- `ReadonlyMap#groupBy<KU extends defined>(keyfunc: (key: K, value: V, map: ReadonlyMap<K, V>) => KU): Map<KU, V[]>`
- `ReadonlyMap#groupBy<KU extends defined, VU extends defined>(keyfunc: (key: K, value: V, map: ReadonlyMap<K, V>) => KU, valuefunc: (key: K, value: V, map: ReadonlyMap<K, V>) => VU): Map<KU, VU[]>`
- `ReadonlyArray#except(items: readonly T[]): T[]`
- `ReadonlyArray#exceptSet(items: ReadonlySet<T>): T[]`
- `ReadonlySet#except(items: readonly T[]): Set<T>`
- `ReadonlySet#exceptSet(items: ReadonlySet<T>): Set<T>`
- `ReadonlyMap#exceptKeys(items: readonly K[]): Map<K, V>`
- `ReadonlyMap#exceptValues(items: readonly V[]): Map<K, V>`
- `ReadonlyMap#exceptKeysSet(items: ReadonlySet<K>): Map<K, V>`
- `ReadonlyMap#exceptValuesSet(items: ReadonlySet<V>): Map<K, V>`
- `ReadonlyArray#toSet(): Set<T>`
- `ReadonlyArray#toMap<K extends defined>(func: (value: T) => K): Map<K, T>`
- `ReadonlySet#toArray(): T[]`
- `ReadonlySet#toMap<K extends defined>(func: (value: T) => K): Map<K, T>`
- `ReadonlyMap#toArray(): [key: K, value: V][]`
- `ReadonlyMap#toSet(): Set<[key: K, value: V]>`
- `ReadonlyArray#distinct(): T[]`
- `ReadonlySet#withAdded(items: readonly T[]): Set<T>`
- `ReadonlySet#withAddedSet(items: ReadonlySet<T>): Set<T>`
- `ReadonlyArray#sequenceEquals(other: readonly T[]): boolean`
- `ReadonlyArray#sequenceEqualsSet(other: ReadonlySet<T>): boolean`
- `ReadonlySet#sequenceEquals(other: ReadonlySet<T>): boolean`
- `ReadonlyMap#sequenceEquals(other: ReadonlyMap<K, V>): boolean`
- `Map#getOrSet(key: K, create: () => V): V`
- `ReadonlyArray#min(): number | undefined`
- `ReadonlyArray#max(): number | undefined`

### `engine/shared/fixes/Arrays.ts`

`intersect` for arrays and for sets, as plain functions separate from the collection macros.

- `Arrays.intersect<T extends defined>(arrays: readonly (readonly T[])[]): T[]`
- `Sets.intersect<T extends defined>(sets: readonly ReadonlySet<T>[]): T[]`

### `engine/shared/fixes/BB.ts`

An immutable oriented bounding box built from parts, models, regions or other boxes, with resizing, recentring, axis alignment and containment tests.

- `class BB`
- `BB.from(instance: BasePart | Model | readonly Model[]): BB`
- `BB.fromPart(part: BasePart): BB`
- `BB.fromModel(model: Model): BB`
- `BB.fromModels(models: readonly Model[], origin?: CFrame): BB`
- `BB.fromBBs(regions: readonly BB[], origin?: CFrame): BB`
- `BB.fromRegion3(region: Region3): BB`
- `new BB(center: CFrame, originalSize: Vector3)`
- `readonly BB#center: CFrame`
- `readonly BB#originalSize: Vector3`
- `BB#getRotatedSize(): Vector3`
- `BB#toAxisAligned(): BB`
- `BB#withCenter(position: CFrame | ((cf: CFrame) => CFrame)): BB`
- `BB#withSize(size: Vector3 | ((size: Vector3) => Vector3)): BB`
- `BB#isPointInside(globalPoint: Vector3): boolean`
- `BB#isBBInside(bb: BB): boolean`

### `engine/shared/fixes/Color3.propmacro.ts`

Per-channel `apply` and `with`, scalar `mul` and `toVector3` on `Color3`, plus `Color3s` helpers that build a colour from one value and unpack one into a tuple.

- `Color3s.fromValue(v: number): Color3`
- `Color3s.toTuple(color: Color3): LuaTuple<[number, number, number]>`
- `Color3#apply(func: (value: number, channel: "R" | "G" | "B") => number): Color3`
- `Color3#with(r?: number, g?: number, b?: number): Color3`
- `Color3#toVector3(): Vector3`
- `Color3#mul(n: number): Color3`

### `engine/shared/fixes/Instances.ts`

Find or wait for an instance by a child path, get an instance's path, and `waitClientOrCreateServer`, which creates the instance on the server and waits for it on the client.

- `Instances.findChild<T = Instance>(object: Instance, ...path: string[]): T | undefined`
- `Instances.waitForChild<T = Instance>(object: Instance, ...path: string[]): T`
- `Instances.waitClientOrCreateServer<T extends Instance = Instance>(parent: Instance, name: string, ctor: () => T): T`
- `Instances.pathOf(instance: Instance): string[]`
- `Instances.relativePathOf(instance: Instance, relativeTo: Instance): string[]`

### `engine/shared/fixes/Json.ts`

JSON serialize and deserialize that also round-trip Roblox datatypes such as `Vector3` and `CFrame`, which `HttpService:JSONEncode` cannot.

- `type JsonSerializedProperty`
- `JSON.serialize(value: unknown): string`
- `JSON.deserialize<T>(data: string): T`

### `engine/shared/fixes/Keys.ts`

Every `Enum.KeyCode` by name, type guards for keyboard, gamepad and D-pad key names, and `toReadable` for display.

- `type GamepadKeyCode`
- `type GamepadDPadKeys`
- `const Keys.Keys: object with 277 keys`
- `Keys.isKey(key: string): key is KeyCode`
- `Keys.isKeyGamepad(key: string): key is GamepadKeyCode`
- `Keys.isKeyGamepadDPad(key: string): key is GamepadDPadKeys`
- `Keys.toReadable(key: KeyCode): string`

### `engine/shared/fixes/Lock.ts`

A mutex whose `execute` yields until no other call holds it, then runs the function.

- `class Lock`
- `Lock#execute<T>(func: () => T): T`

### `engine/shared/fixes/MathUtils.ts`

Rounding to a step and clamping to optional bounds and step, plus the constant `e`.

- `const MathUtils.e: 2.718281828459`
- `MathUtils.round(value: number, step: number | undefined): number`
- `MathUtils.clamp(value: number, min: number | undefined, max: number | undefined, step?: number): number`

### `engine/shared/fixes/Objects.ts`

The object-side counterpart to the collection macros: keys, values, first entries, mapping, deep equality, deep merge, path access, `writable`, the shared `empty` array, and wrappers that await a promise or forbid yielding.

- `const Objects.empty: readonly []`
- `Objects.firstKey<T>(object: readonly T[]): number | undefined`
- `Objects.firstKey<T>(object: ReadonlyMap<T, defined>): T | undefined`
- `Objects.firstKey<T>(object: ReadonlySet<T>): T | undefined`
- `Objects.firstKey<T extends object>(object: T): keyof T | undefined`
- `Objects.firstValue<T extends readonly T[]>(object: T): T | undefined`
- `Objects.firstValue<T extends ReadonlyMap<defined, T>>(object: T): T | undefined`
- `Objects.firstValue<T extends ReadonlySet<T>>(object: T): boolean | undefined`
- `Objects.firstValue<T extends object>(object: T): T[keyof T] | undefined`
- `Objects.keys<T extends object>(object: T): (keyof T)[]`
- `Objects.values<T extends object>(object: T): (T[keyof T] & defined)[]`
- `Objects.size(object: object): number`
- `Objects.mapValues<const TObj extends object, const V extends defined>(obj: TObj, func: (key: keyof TObj, value: TObj[keyof TObj] & defined) => V | undefined): object & { [k in keyof TObj]: V; }`
- `Objects.map<const TObj extends readonly unknown[], const K extends string | number | symbol, const V extends defined>(obj: TObj, keyfunc: (key: keyof TObj, value: TObj extends readonly (infer E)[] ? E : never) => K, valuefunc: (key: keyof TObj, value: TObj extends readonly (infer E)[] ? E : never) => V | undefined): object & { [k in K]: V; }`
- `Objects.map<const TObj extends object, const K extends string | number | symbol, const V extends defined>(obj: TObj, keyfunc: (key: keyof TObj, value: TObj[keyof TObj] & defined) => K, valuefunc: (key: keyof TObj, value: TObj[keyof TObj] & defined) => V | undefined): object & { [k in K]: V; }`
- `Objects.entriesArray<T extends object>(object: T): (readonly [keyof T, T[keyof T] & defined])[]`
- `Objects.assign<T extends object, TProps extends object>(toObj: T, properties: TProps & Partial<T>): T & TProps`
- `Objects.fromEntries<T extends readonly (readonly [key: string | number, value: defined])[]>(entries: T): { [k in T[number][0]]: Extract<T[number], readonly [k, unknown]>[1]; }`
- `Objects.writable<T extends object>(object: T): Writable<T>`
- `Objects.awaitThrow<T>(promise: Promise<T>): T`
- `Objects.multiAwait(funcs: (() => void)[]): void`
- `Objects.deepEquals(left: unknown, right: unknown): boolean`
- `Objects.objectDeepEqualsExisting(object: object, properties: object): boolean`
- `Objects.deepCombine<T extends object>(o1: T, o2: PartialThrough<T>): T`
- `Objects.deepCombine<T extends object>(...objects: readonly T[]): T`
- `type Objects.PathsOf<T>`
- `type Objects.ValueOf<T, TPath extends readonly (string | number)[]>`
- `Objects.getValueByPathTyped<const TObj extends object, const TPath extends readonly string[]>(obj: TObj, path: TPath): ValueOf<TObj, TPath>`
- `Objects.getValueByPath(obj: object, path: readonly (string | number)[]): unknown`
- `Objects.createObjectWithValueByPath<V>(value: V, path: readonly (string | number)[]): object`
- `Objects.withValueByPath<T extends object>(obj: T, value: unknown, path: readonly (string | number)[]): T`
- `Objects.requireNoYield<TArgs extends unknown[], TRet>(func: (...args: TArgs) => TRet, ...args: TArgs): TRet`
- `Objects.wrapRequireNoYield<TFunc extends (...args: TArgs) => TRet, TArgs extends unknown[], TRet>(func: TFunc): (...args: TArgs) => TRet`

### `engine/shared/fixes/Roblock.propmacro.ts`

Per-axis `apply`, `with` and smallest/largest-axis methods on `Vector3`, and `apply`, `min` and `max` on `Vector2`.

- `Vector3#apply(func: (value: number, axis: "X" | "Y" | "Z") => number): Vector3`
- `Vector3#findMin(): number`
- `Vector3#findMax(): number`
- `Vector3#min(vector: Vector3): Vector3` *(deprecated)*
- `Vector3#max(vector: Vector3): Vector3` *(deprecated)*
- `Vector3#with(x?: number, y?: number, z?: number): Vector3`
- `Vector2#apply(func: (value: number, axis: "X" | "Y") => number): Vector2`
- `Vector2#min(vector: Vector2): Vector2`
- `Vector2#max(vector: Vector2): Vector2`

### `engine/shared/fixes/String.propmacro.ts`

`contains`, `startsWith`, `trim` and full-Unicode case conversion on strings, plus `Strings` formatters for values, numbers, durations and large numbers, and rich-text sanitising.

- `Strings.pretty(value: unknown): string`
- `Strings.prettyNumber(value: number, step: number | undefined): string`
- `Strings.sanitizeRichText(s: string): string`
- `Strings.prettySecondsAgo(seconds: number): string`
- `Strings.prettyTime(seconds: number): string`
- `Strings.prettyKMT(num: number): string`
- `Strings.prettyKMB(num: number): string`
- `String#contains(search: string): boolean`
- `String#startsWith(search: string): boolean`
- `String#trim(): string`
- `String#fullLower(): string`
- `String#fullUpper(): string`

### `engine/shared/t.propmacro.ts`

Adds `t.numberWithBounds` and, on every checker, `orUndefined`, plus `nominal` and `as`, which change only the compile-time type.

- `t.numberWithBounds(min: number, max: number): t.Type<number, { min: number; max: number }>`
- `t.numberWithBounds(min?: number, max?: number, step?: number): t.Type<number, { min?: number; max?: number; step?: number }>`
- `t.Type#orUndefined(): t.Type<T | undefined>`
- `t.Type#nominal<const TName extends string>(name: TName): t.Type<T & { ___nominal: TName }>`
- `t.Type#as<U extends T>(): t.Type<U>`

### `engine/shared/t.ts`

The repo's runtime type checker: primitive and composite checkers, `typeCheck`/`typeCheckWithThrow`, and `Infer` to derive a TypeScript type from a checker.

- `type t.Infer<T extends Type<unknown>>`
- `interface t.Type<T, TAdditional = unknown>`
- `interface t.Interface<T>`
- `t.newResult(): TypeCheckResult`
- `t.typeCheck<T>(value: unknown, vtype: RealT.Type<T>, result?: TypeCheckResult): value is T`
- `t.typeCheckWithThrow<T>(value: unknown, vtype: RealT.Type<T>): asserts value is T`
- `t.custom<T, TAdditional>(t: RealT.Type<T>["func"], additional?: TAdditional): RealT.Type<T, TAdditional>`
- `t.type<K extends keyof CheckableTypes>(name: K): RealT.Type<CheckableTypes[K]>`
- `t.enum<T extends EnumItem>(enumObject: Enum & { GetEnumItems(): Array<T>; }): RealT.Type<T>`
- `t.any: RealT.Type<unknown, unknown>`
- `t.anyInstance: RealT.Type<Instance, unknown>`
- `t.undefined: RealT.Type<undefined, unknown>`
- `t.number: RealT.Type<number, unknown>`
- `t.boolean: RealT.Type<boolean, unknown>`
- `t.string: RealT.Type<string, unknown>`
- `t.object: RealT.Type<object, unknown>`
- `t.unknownArray: RealT.Type<unknown[], unknown>`
- `t.const<const T>(val: T): RealT.Type<T, unknown>`
- `t.true: RealT.Type<true, unknown>`
- `t.false: RealT.Type<false, unknown>`
- `t.vector2: RealT.Type<Vector2, unknown>`
- `t.vector3: RealT.Type<Vector3, unknown>`
- `t.cframe: RealT.Type<CFrame, unknown>`
- `t.color: RealT.Type<Color3, unknown>`
- `t.material: RealT.Type<Enum.Material, unknown>`
- `t.instance<const T extends keyof Instances>(name: T): RealT.Type<Instances[T]>`
- `t.instanceTree<const Root extends keyof Instances, const Spec extends InstanceTreeSpec>(root: Root, children: Spec): RealT.Type<Instances[Root] & InferTree<Spec>>`
- `t.instanceTree<const T>(): t.Type<T>`
- `t.interface<const T extends { readonly [k in string]: RealT.Type<unknown>; }>(properties: T): RealT.Type<{ [K in keyof { readonly [k in keyof T]: RealT.Infer<T[k]>; }]: { readonly [k in keyof T]: RealT.Infer<T[k]>; }[K]; }, T>`
- `t.partial<const T extends { readonly [k in string]: RealT.Type<unknown>; }>(properties: T): RealT.Type<Partial<{ [K in keyof { readonly [k in keyof T]: RealT.Infer<T[k]>; }]: { readonly [k in keyof T]: RealT.Infer<T[k]>; }[K]; }>, T>`
- `t.mappedInterfaceKV<const K extends t.Type<string | number>, const V extends t.Type<unknown>>(tkey: K, tvalue: V): RealT.Type<{ [k in RealT.Infer<K>]: RealT.Infer<V>; }>`
- `t.strictInterface<const T extends { readonly [k in string]: RealT.Type<unknown>; }>(properties: T): RealT.Type<{ [K in keyof { readonly [k in keyof T]: RealT.Infer<T[k]>; }]: { readonly [k in keyof T]: RealT.Infer<T[k]>; }[K]; }>`
- `t.array<const T>(itemType: RealT.Type<T>): RealT.Type<T[]>`
- `t.intersection<const T extends readonly RealT.Type<unknown>[]>(...items: T): RealT.Type<TupleToIntersection<{ readonly [k in keyof T]: RealT.Infer<T[k]>; }>>`
- `t.union<const T extends readonly RealT.Type<unknown>[]>(...items: T): RealT.Type<UnwrapArrayUnion<T>>`
- `t.numberWithBounds(min: number, max: number): t.Type<number, { min: number; max: number; }>`
- `t.numberWithBounds(min?: number, max?: number, step?: number): t.Type<number, { min?: number; max?: number; step?: number; }>`

### `engine/shared/utils/PlayerUtils.ts`

`isAlive` (the character has a humanoid with health above zero) and `isPlayerPart` (the part's model has `HumanoidRootPart` as its primary part).

- `PlayerUtils.isAlive(player: Player): boolean`
- `PlayerUtils.isPlayerPart(part: BasePart): boolean`

### `shared/Colors.ts`

The game's palette (accent shades and backgrounds) and the nine base colours with `toInt` and `lightenPressed`; use this copy outside `engine/`.

- `const Colors.accentBlack: Color3`
- `const Colors.staticBackground: Color3`
- `const Colors.accentDark: Color3`
- `const Colors.accent: Color3`
- `const Colors.accentLight: Color3`
- `const Colors.newGui: { readonly staticBackground: Color3; readonly blue: Color3; }`
- `const Colors.white: Color3`
- `const Colors.black: Color3`
- `const Colors.red: Color3`
- `const Colors.green: Color3`
- `const Colors.blue: Color3`
- `const Colors.yellow: Color3`
- `const Colors.pink: Color3`
- `const Colors.purple: Color3`
- `const Colors.orange: Color3`
- `Colors.toInt(color: Color3): number`
- `Colors.lightenPressed(color: Color3): Color3`

### `shared/utils/Expression.ts`

Evaluates an arithmetic expression typed into a value box, with implicit multiplication, returning undefined when it is malformed or not finite.

- `Expression.evaluate(input: string): number | undefined`

### `shared/utils/FunctionEnvironment.ts`

The sandboxed environment for player-written maths in the Function block and `MathExpression`: `math` plus `sum`, `prod` and `integral`.

- `FunctionEnvironment.baseEnv.sum(term: (index: number) => number, from: number, to: number): number`
- `FunctionEnvironment.baseEnv.prod(term: (index: number) => number, from: number, to: number): number`
- `FunctionEnvironment.baseEnv.integral(term: (x: number) => number, from: number, to: number, steps?: number): number`
- `FunctionEnvironment.baseEnv.abs(n: number): number`
- `FunctionEnvironment.baseEnv.acos(n: number): number`
- `FunctionEnvironment.baseEnv.asin(n: number): number`
- `FunctionEnvironment.baseEnv.atan(n: number): number`
- `FunctionEnvironment.baseEnv.atan2(y: number, x: number): number`
- `FunctionEnvironment.baseEnv.ceil(n: number): number`
- `FunctionEnvironment.baseEnv.cos(n: number): number`
- `FunctionEnvironment.baseEnv.cosh(n: number): number`
- `FunctionEnvironment.baseEnv.deg(n: number): number`
- `FunctionEnvironment.baseEnv.exp(n: number): number`
- `FunctionEnvironment.baseEnv.floor(n: number): number`
- `FunctionEnvironment.baseEnv.fmod(x: number, y: number): number`
- `FunctionEnvironment.baseEnv.frexp(n: number): LuaTuple<[number, number]>`
- `FunctionEnvironment.baseEnv.ldexp(m: number, e: number): number`
- `FunctionEnvironment.baseEnv.log(x: number, base?: number): number`
- `FunctionEnvironment.baseEnv.log10(n: number): number`
- `FunctionEnvironment.baseEnv.map(x: number, inmin: number, inmax: number, outmin: number, outmax: number): number`
- `FunctionEnvironment.baseEnv.lerp(a: number, b: number, t: number): number`
- `FunctionEnvironment.baseEnv.max(...n: Array<number>): number`
- `FunctionEnvironment.baseEnv.min(...n: Array<number>): number`
- `FunctionEnvironment.baseEnv.modf(n: number): LuaTuple<[number, number]>`
- `FunctionEnvironment.baseEnv.pow(x: number, y: number): number`
- `FunctionEnvironment.baseEnv.rad(n: number): number`
- `FunctionEnvironment.baseEnv.random(): number`
- `FunctionEnvironment.baseEnv.random(max: number): number`
- `FunctionEnvironment.baseEnv.random(min: number, max: number): number`
- `FunctionEnvironment.baseEnv.randomseed(seed: number): void`
- `FunctionEnvironment.baseEnv.round(n: number): number`
- `FunctionEnvironment.baseEnv.sign(n: number): -1 | 0 | 1`
- `FunctionEnvironment.baseEnv.sin(n: number): number`
- `FunctionEnvironment.baseEnv.sinh(n: number): number`
- `FunctionEnvironment.baseEnv.sqrt(n: number): number`
- `FunctionEnvironment.baseEnv.tan(n: number): number`
- `FunctionEnvironment.baseEnv.tanh(n: number): number`
- `FunctionEnvironment.baseEnv.isnan(x: number): boolean`
- `FunctionEnvironment.baseEnv.isinf(x: number): boolean`
- `FunctionEnvironment.baseEnv.isfinite(x: number): boolean`
- `FunctionEnvironment.baseEnv.pi: number`
- `FunctionEnvironment.baseEnv.huge: number`
- `FunctionEnvironment.baseEnv.e: number`
- `FunctionEnvironment.baseEnv.nan: number`
- `FunctionEnvironment.baseEnv.phi: number`
- `FunctionEnvironment.baseEnv.sqrt2: number`
- `FunctionEnvironment.baseEnv.tau: number`
- `FunctionEnvironment.baseEnv.noise(x: number, y?: number, z?: number): number`
- `FunctionEnvironment.baseEnv.clamp(n: number, min: number, max: number): number`
- `FunctionEnvironment.createSafeEnv(): {}`

### `shared/utils/ImplicitMultiplication.ts`

Inserts the multiplication signs the Function block's Luau grammar needs but a player writing maths leaves out (`2a`, `3(a+b)`, `ab`).

- `ImplicitMultiplication.expand(expression: string, reserved: { readonly [name: string]: unknown; }): string`

### `shared/utils/PartUtils.ts`

Bulk changes to a model's descendants (material, colour, transparency, ghosting), joint breaking, and keeping a part's velocity across a network-ownership handoff.

- `PartUtils.ghostModel(model: Model, color: Color3): void`
- `PartUtils.switchDescendantsMaterial(model: Instance, material: Enum.Material): void`
- `PartUtils.switchDescendantsColor(model: Instance, color: Color3): void`
- `PartUtils.switchDescendantsTransparency(model: Instance, transparency: number): void`
- `PartUtils.pinAssemblyVelocity(part: BasePart): void`
- `PartUtils.unpinAssemblyVelocity(part: Instance | undefined): void`
- `PartUtils.BreakJoints(part: BasePart): void`
- `PartUtils.applyToAllDescendantsOfType<T extends InstancesKeys>(typeName: T, parent: Instance, callback: (instance: Instances[T]) => void): void`

### `shared/utils/TagUtils.ts`

The instance tag names the game uses, and a check for whether a tag is one of them.

- `const TagUtils.allTags: { readonly ANCHORED: "ANCHORED"; readonly IMPACT_STRONG: "ImpactStrong"; readonly IMPACT_UNBREAKABLE: "ImpactProof"; readonly FIREPROOF_MATERIAL: "fireproof"; readonly LAVAPROOF_MATERIAL: "LAVAPROOF"; readonly OBSTACLEPROOF_MATERIAL: "OBSTACLEPROOF"; readonly TRANSPARENT_MATERIAL: "TRANSPARENT"; readonly STATIC_MATERIAL: "STATIC_MATERIAL"; readonly STATIC_COLOR: "STATIC_COLOR"; readonly PLAYER_LOADED: "Loaded"; readonly GAME_LOADED: "GameLoaded"; readonly BLOCK_UNSCALABLE: "UNSCALABLE"; readonly BLOCK_NONCOLLIDABLE: "NONCOLLIDABLE"; readonly SPECIAL_RADARVIEW: "RADARVIEW"; readonly MIRROR_REFLECTIVE: "Mirror_Reflective"; }`
- `TagUtils.isASystemTag(tag: string): boolean`

### `shared/utils/VectorUtils.ts`

Static vector helpers for contexts with no receiver: per-axis apply, rounding to a step or base, normalisation, CFrame near-equality, and converting a `NormalId` to a world normal.

- `VectorUtils.apply(vector: Vector3, func: (num: number) => number): Vector3`
- `VectorUtils.apply(vector: Vector2, func: (num: number) => number): Vector2`
- `VectorUtils.round(num: number, precision?: number): number`
- `VectorUtils.areCFrameEqual(cf1: CFrame, cf2: CFrame, precision?: number): boolean`
- `VectorUtils.normalizeVector2(vector: Vector2): Vector2`
- `VectorUtils.normalizeVector3(vector: Vector3): Vector3`
- `VectorUtils.normalize<T extends Vector3 | Vector2>(vector: T): T`
- `VectorUtils.roundVectorToBase(vector: Vector3, base: number): Vector3`
- `VectorUtils.roundVectorToNearestHalf(vector: Vector3): Vector3`
- `VectorUtils.roundVector3(vector: Vector3): Vector3`
- `VectorUtils.roundVector3To(vector: Vector3, step: number): Vector3`
- `VectorUtils.roundVector2(vector: Vector2): Vector2`
- `VectorUtils.normalIdToNormalVector(mouse_surface: Enum.NormalId, part: BasePart): { vector: Vector3; size: number; }`

<!-- utility-index:end -->
