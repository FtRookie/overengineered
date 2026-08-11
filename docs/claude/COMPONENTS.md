# Components & Lifecycle

`Component` enable/disable/destroy semantics, parenting, and the `task.spawn` yield-guard pattern.

> Extracted from `CLAUDE.md`, which keeps the tripwires and routes here for detail.

## task.spawn in Components

When a `Component` uses `task.spawn` for a long-running loop, a guard at the **top of the loop** is not sufficient if yield points (`task.wait()`) exist inside called functions. The component can be destroyed during those inner yields, and any state writes after the yield will operate on cleared/destroyed state.

Guard pattern — check `isDestroyed()` (or `isEnabled()`) after any yield point before writing back to Component state:

```ts
task.spawn(() => {
    while (true as boolean) {
        task.wait();
        if (this.isDestroyed()) return; // top-of-loop guard
        if (!this.isEnabled()) continue;

        const result = this.doWorkThatMayYield(); // task.wait() may fire inside here
        if (this.isDestroyed()) {                 // guard again after the yield
            result.cleanup();
            return;
        }
        this.state = result; // safe to write now
    }
});
```

## Component Lifecycle

`enable`, `disable`, and `destroy` directly map to in-game block state:
- **`enable`** — called when the player enters Ride Mode; all blocks become active
- **`disable`** — called when a block is turned off by configuration or an error state (e.g. GARBAGE)
- **`destroy`** — managed by the Ride Mode controller when the vehicle is torn down

Block instances (including all model parts) are **fully regenerated from the original block model** when the player exits Ride Mode back to Build Mode. It is safe to destroy instance parts in `onDisable` — they will be recreated fresh on the next enable.

**A teardown handler that broadcasts must guard on `isDestroying()`.** A ride exit disables every block in one pass, so a "stop the effect" message per block is a burst of remotes for models that are about to stop existing — a real source of despawn lag. `Component.isDestroying()` is true from the moment `destroy()` begins, and the flag is handed down to children before they are disabled — by `parent()` for parented components, and by `markChildDestroying` in `ComponentChildren` / `ComponentKeyedChildren` / `ComponentChild`, which is the path block logic takes. So a block can tell a despawn from a burn synchronously:

```ts
this.onDisable(() => {
    if (this.isDestroying()) return;
    ...send...
});
```

Plain `onDisable` with no guard is still right for purely local work. Before adding the guard, confirm the receiving side reaches the same resting state on its own (an effect handler that bails on a destroyed instance, a timer that stops when its block loses its parent), since the message is genuinely dropped.

`HostedService` extends `Component` but cannot be disabled — it lives for the entire session, and one that was registered is enabled for all of it. Still subscribe through `this.event` rather than connecting signals directly: the guarantee is a property of how it is registered today, not of the class, and a service demoted back to a plain `Component` would leave raw connections running.

`Component` mechanics (`engine/shared/component/Component.ts`):

- `enable()`/`disable()`/`destroy()` are idempotent, and everything is a no-op after destroy. `destroy()` calls `disable()` first, so `onDisable` handlers always run before `onDestroy` handlers during teardown.
- `onEnable(func)` fires immediately when subscribing to an already-enabled component; `onDisable` fires only on a real transition.
- `parent(child, config?)` ties the child's lifecycle to the parent — enable/disable/destroy each propagate unless opted out (`{ enable: false }` etc.), and a child parented to an already-enabled parent is enabled on the spot. Parenting also hands the parent's DI scope to the child; this is how injection flows down the component tree.
- Every injected component gets its own DI scope with itself registered in it (resolvable by its class). `cacheDI(value)` adds a value to that scope for descendants; `onInject(func)` runs once DI arrives and must be subscribed *before* parenting — it throws afterwards.
- `getComponent(Clazz)` lazily creates and caches one attached component per class, parenting it (or destroy-linking a non-`Component`) automatically.
