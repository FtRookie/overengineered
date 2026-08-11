# Dependency Injection

Registering and resolving services, scopes, `@injectable`/`@tryInject`, and `$onInjectAuto` timing. The system
is transformer-powered and lives in `src/engine/shared/di/` — read the implementation directly when this doc
does not settle the question.

> Extracted from `CLAUDE.md`, which keeps the tripwires and routes here for detail.

The DI system lives in `src/engine/shared/di/` and is transformer-powered — resolution keys are TypeScript type paths injected at compile time, not strings written by hand.

Any class that receives `@inject` parameters in its constructor must be decorated with `@injectable` directly above the class definition — without it, the DI transformer will not wire up the parameters correctly.

**Resolving:**
```ts
const svc = di.resolve<MyService>(); // no string argument needed — transformer fills it
const svc = di.tryResolve<MyService>(); // returns undefined if not registered
```

**Registering** (via `DIContainerBuilder`):
```ts
builder.registerSingletonClass(MyClass)        // instantiated once, reused
builder.registerTransientClass(MyClass)        // new instance per resolve
builder.registerSingletonValue(existingObj)    // pre-built instance
builder.registerSingletonFunc(di => new X(di)) // factory, result cached
```

Registrations chain: `.as<OtherType>()` / `.asSelf()` expose one registration under additional type paths, `.withArgs(...)` supplies constructor args (the singleton variant also accepts `(di) => args`), `.onInit(fn)` runs after construction, and `.autoInit()` constructs a singleton eagerly at container build instead of on first resolve. Singletons are otherwise lazy and cached, and circular resolution is detected and thrown.

**Services** (`HostedService extends Component`) are long-lived singletons that cannot be disabled. Register them via `GameHostBuilder.services.registerService<T>(MyService)`. They are parented to the `GameHost` automatically.

**Scoped containers:**
```ts
const child = di.beginScope((builder) => {
    builder.registerSingletonValue(x);
});
```
Child containers inherit all parent registrations and override only what they add.

**Resolution is by exact type path, not structure.** `tryResolve` is a string-key lookup that walks parent scopes; a value registered under one type is invisible under any other type, however identical the shape — registering `PlayerDataStorage` does not make a `PlayerConfig` injection resolvable. Expose extra paths explicitly with `.as<T>()`.

**`@tryInject`** marks a constructor parameter as optional injection — it resolves to `undefined` instead of throwing when nothing is registered under the type. This is the standard way shared block logic reaches client-only services (`PlayerDataStorage`, `LogControl`): on the server the parameter is simply `undefined` (see WingsBlocks, GravitySensorBlock, LuaCircuitBlock).

**`resolveForeignClass(Clazz, [args])`** instantiates a class that isn't registered in any container, resolving its decorated parameters from this one — this is how `SharedMachine` constructs block logic (`di.resolveForeignClass(logicctor, [block])`). Positional `args` fill the non-decorated parameters; `@inject`/`@tryInject` parameters come from the container.

**Decorators only fire on the class DI instantiates.** A base class reached through `super(...)` never sees the
container — that call is plain Lua with the arguments the subclass wrote, and `di` exists only inside the
generated `_depsCreate`. So decorate the leaf and forward the value up (`ServerBlockLogic` and its 13 subclasses
are the pattern), or, for a dependency the base alone uses, take it in the base with `$onInjectAuto`.
`@injectable` on the base is worse than useless: `isDeps` is an `_depsCreate ~= nil` index that follows
`__index = super`, so a subclass without its own would inherit one built for the *base's* parameter list and
receive every argument shifted.

**Constructor parameter when the dependency is required and read unconditionally; `$onInjectAuto` / `@tryInject`
when it is optional or side-specific.** `$onInjectAuto` resolves after the constructor returns and before
parenting, so the field is genuinely `undefined` for that window — fine for a value already read with `?.`,
wrong for one called bare from three places, where the failure is a nil call inside one block rather than a
compile error.

**An optional `$onInjectAuto` parameter (`x?: T` or `T | undefined`) resolves through `tryResolve`** and arrives
`undefined` when nothing is registered, instead of throwing. This is how shared code reaches a client-only
service without a constructor parameter. A non-optional one uses `resolve` and throws.

**`@pathOf("T")` decorator** on a parameter is a transformer macro — it replaces the parameter's runtime value with the string path of TypeScript type `T`. This is how `resolve<T>()` works without an explicit string argument.

**`$autoResolve`** wraps a function so all its parameters are resolved from a `DIContainer` automatically.
