# Keybind System — Analysis & Rebindable-Keybinds Plausibility

> How the keybind system works today, and how plausible it is to make keybinds
> user-rebindable and persisted through player config.
> Core: `src/engine/client/Keybinds.ts`. Key-name map: `src/engine/shared/fixes/Keys.ts`.
> Key-capture UI: `src/client/gui/controls/KeyChooserControl.ts`.

---

## TL;DR

- **Runtime rebinding already works** at the API level: `KeybindRegistration.setKeys()`
  re-registers the ContextActionService binding. But it has **zero callers** — nothing
  wires it to UI or persistence.
- A **key-capture control already exists** (`KeyChooserControl`), currently used only for
  *block* key-config. It captures a **single** key (not a combination).
- The registries (`definitions`, `registrations`) are `ObservableMap`s and every keybind
  carries a `displayPath` (`["Edit tool", "Mirror X"]`) — the system is clearly shaped for
  a rebinding UI that was never built.
- **Serialization is trivial**: a key is a `KeyCode` = the Roblox enum *name string*, so a
  binding is a `string[][]` (JSON-safe).
- Config persistence needs **no new save version** — adding a `keybinds` field is a pure
  additive change that `Config.addDefaults` backfills for free.
- **Net-new work** is a settings page, a change-notification signal, combo/multi-binding
  capture UX, and the persistence glue. No architectural blockers.

**Verdict: high plausibility, moderate effort. Most of the hard infrastructure is present.**

---

## 1. Current architecture

### Registration → definition → registration → CAS bind

```
Keybinds.registerDefinition(action, displayPath, keys, priority?)   // static; stores a KeybindDefinition
   → keybinds.fromDefinition(def)                                    // instance; memoized per action
       → new KeybindRegistration(action, displayPath, keys, priority)
           → register(): ContextActionService.BindAction / BindActionAtPriority
```

| Piece | Ref | Role |
|---|---|---|
| `KeybindDefinition` | `Keybinds.ts:114-119` | `{ action, displayPath, keys, priority? }`; the immutable **default** |
| `Keybinds.registerDefinition` | `Keybinds.ts:123-135` | static; memoizes definitions in an `ObservableMap` |
| `Keybinds.fromDefinition` / `register` | `Keybinds.ts:139-159` | creates/memoizes a live `KeybindRegistration` per action |
| `KeybindRegistration` | `Keybinds.ts:13-111` | owns the CAS binding + subscriptions + current keys |
| `KeybindRegistration.register` | `Keybinds.ts:41-79` | binds via `BindAction` (or `BindActionAtPriority` when a priority is set) |
| `KeybindRegistration.getKeys` / `setKeys` | `Keybinds.ts:81-87` | read / **replace** the bound keys (setKeys re-runs `register()`) |

### How an input is dispatched

`register()` binds the CAS action on the *individual* keys of every combination
(`keys.flatmap(...)`, `Keybinds.ts:77`). When any of them fires, the handler:

1. Confirms the **full combination** with `UserInputService.IsKeyDown(...)` — `keys.any(comb => comb.all(k => IsKeyDown(k)))` (`Keybinds.ts:61`). This is how `["LeftShift","O"]` requires *both* held, and how `[["F"],["ButtonX"]]` means *F or ButtonX*.
2. Dispatches to subscriptions ordered by an integer `priority` index (`Keybinds.ts:48-59`).
3. Returns `Sink` if any subscription sinks, else `Pass`.

`Action.initKeybind` (`src/client/Action.propmacro.ts:28-38`) subscribes `onDown → execute()` and returns `Sink` by default; the subscription is tied to the Action's component lifecycle, so it disconnects on disable (this is how a build-tool keybind stops sinking a key in ride mode).

### Data model of a binding

```ts
type KeyCombination = readonly KeyCode[];     // keys held simultaneously, e.g. ["LeftShift","O"]
KeybindDefinition.keys: readonly KeyCombination[];   // alternatives, e.g. [["F"],["ButtonX"]] = F OR gamepad-X
```

`KeyCode` is the Roblox enum **name string** (`"O"`, `"LeftShift"`, `"ButtonX"`).
`Keys` (`src/engine/shared/fixes/Keys.ts`) maps name → `Enum.KeyCode` (`Keys.Keys`), and
provides `isKey(str)` / `isKeyGamepad(str)` validators. **A binding is therefore a plain
`string[][]` — directly JSON-serializable, no custom serializer needed.**

### UI-oriented surfaces already present

- **`displayPath: readonly string[]`** on every definition (`["Edit tool", "Mirror X"]`, `["Freecam"]`) — first element is the group, the rest the label. Purpose-built for a grouped settings list.
- **`Keybinds.definitions`** (static `ObservableMap<string, KeybindDefinition>`) and **`registrations`** (`ObservableMap<string, KeybindRegistration>`, `Keybinds.ts:136-137`) — a UI can enumerate/observe every keybind reactively.
- **Tooltips** already render a keybind's keys: `TooltipsControl.setFromKeybinds` reads `kb.getKeys()` (`src/client/gui/static/TooltipsControl.ts:101-105`).

---

## 2. What already exists for rebinding

1. **Runtime rebind API — built, unused.** `KeybindRegistration.setKeys(keys)` sets the keys
   and calls `register()`, which `UnbindAction`s and re-binds via CAS (`Keybinds.ts:84-87,42`).
   **Grep confirms zero callers of `setKeys` in the entire codebase** — the capability is
   fully wired but nothing uses it.
2. **Key-capture control — built, used elsewhere.** `KeyChooserControl`
   (`src/client/gui/controls/KeyChooserControl.ts`) binds a temporary CAS action at priority
   `2001` over Keyboard + Gamepad1, captures the next key, sinks `Escape`/`Unknown`, and fires
   `submitted(value, prev)` with the `KeyCode.Name` (`KeyChooserControl.ts:47-73`). Currently
   consumed by **block** config only (`ConfigControlKey`, `KeyOrStringChooserControl`, KeySensor-style
   blocks) — not by any global-keybind UI. It captures a **single** key, not a combination.
3. **Observable registries + `displayPath`** — everything a settings page needs to list and
   group keybinds reactively (see §1).
4. **Defaults are preserved.** `registerDefinition` stores the original keys in the immutable
   `KeybindDefinition`; `setKeys` mutates only the `KeybindRegistration`. So "reset to default"
   is `registration.setKeys(definition.keys)` — the source of truth for defaults is never lost.

---

## 3. What's missing

- **No settings UI** for global keybinds — `playerSettings/` and `popup/` reference no keybind
  registries (grep clean). Rebinding exists only for block key-config.
- **No persistence** — nothing stores user key choices; `setKeys` is never called, so bindings
  are always the registered defaults.
- **No change-notification.** `setKeys` re-registers but fires no "keys changed" signal, and
  `TooltipsControl.setFromKeybinds` reads `getKeys()` once. A live rebind wouldn't refresh open
  tooltips/labels without a new observable.
- **Single-key capture only.** `KeyChooserControl` can't express `["LeftShift","O"]` combos or
  multiple alternatives (keyboard + gamepad) per action.

---

## 4. Plausibility of config-backed rebindable keybinds

### 4a. Persistence shape (no version bump)

Add one field to `PlayerConfigDefinition` (`src/shared/config/PlayerConfig.ts`):

```ts
type KeybindsConfiguration = {
    readonly overrides: { readonly [action: string]: readonly (readonly string[])[] };
};
// definition default:
keybinds: { type: "keybinds", config: { overrides: {} as ... } }
```

- A binding is `string[][]` (alternatives × simultaneously-held keys) — JSON-safe.
- **Store only overrides** (absence = registered default), like `mapUnload`'s dynamic-key map.
- **No new save version is required** — per the config contract, adding a field is backfilled
  by `Config.addDefaults` on every load (`CLAUDE.md` "Adding a field needs no version").
  `addDefaults` handles the top-level `keybinds` key; individual action entries are dynamic
  keys it leaves alone (correct — missing action = default).

### 4b. Load → apply (mind the registration timing)

There's a real ordering subtlety: `registerDefinition` creates a **definition** at module-eval
time, but a **registration** (the thing with `setKeys`) is created lazily by `fromDefinition`,
i.e. when the consuming component (tool/controller) initializes. So applying an override purely
via `setKeys` at config-load only works for registrations that *already exist*. Also note the
`Keybinds` instance exposes `get(action)` which **throws** on an unknown action (there is no
`tryGet` today — `Keybinds.ts:152-159`).

The robust design is to make the `register()` path **consult the overrides** when building a
registration, and additionally push into any registrations that already exist:

```ts
// when creating a KeybindRegistration, prefer the stored override over the definition default
const keys = overrides[action] ?? definition.keys;

// and at config-load, update the ones already alive:
for (const [action, combos] of pairs(config.keybinds.overrides)) {
    const valid = combos.map(c => c.filter(Keys.isKey)).filter(c => c.size() > 0);
    const reg = keybinds.registrations.get(action);      // map lookup, not the throwing get()
    reg?.setKeys(valid);
}
```

This covers both creation orders (registration born after vs before config-load). Unknown
actions and invalid key names degrade gracefully (skipped / fall back to default). A small
`tryGet` (or reading the `registrations` map directly) avoids the throwing `get`.

### 4c. Save on rebind

On a `KeyChooserControl.submitted` (or combo-capture) event in the settings page:
`reg.setKeys(newCombos)` then `playerData.sendPlayerConfig({ keybinds: { overrides: { [action]: newCombos } } })`.
`sendPlayerConfig` is typed `PartialThrough<PlayerConfig>` and deep-merges, so a single-action
partial send is valid and non-destructive (same pattern the audio/interface settings already use).

### 4d. Settings UI

A new `PlayerSettingsKeybinds` page (mirroring the existing settings pages) iterates
`Keybinds.definitions`, groups by `displayPath[0]`, and renders one row per action with a
`KeyChooserControl` (or a combo-capable variant) plus a reset button that calls
`reg.setKeys(definition.keys)` and clears the override. The registries are observable, so the
list can build reactively.

### 4e. Reset to default

`registration.setKeys(Keybinds.definitions.get(action).keys)` + delete the override key from
config. The definition keeps the original defaults, so this is lossless.

---

## 5. Work items (itemized)

| # | Item | Where | Size |
|---|---|---|---|
| 1 | `keybinds.overrides` config field (+ type/registry/definition) | `PlayerConfig.ts` | S — additive, no version |
| 2 | Load-apply: `register()` consults overrides + push into existing registrations (see §4b timing) | `Keybinds.ts` + hook near `PlayerDataStorage` load | S–M |
| 3 | Save on rebind via `sendPlayerConfig` | settings page | S |
| 4 | `PlayerSettingsKeybinds` page from `definitions` + `displayPath` | `client/gui/playerSettings/` | M |
| 5 | **Change-notification signal** on `KeybindRegistration` (e.g. a `keysChanged`/`ObservableValue`) so tooltips/labels refresh live | `Keybinds.ts` + `TooltipsControl` | S–M |
| 6 | **Combination + multi-binding capture** (modifiers, keyboard-or-gamepad alternatives) | extend `KeyChooserControl` | M |
| 7 | Conflict detection + reserved-key guard (I/O/WASD/Space) | settings page / validator | M |
| 8 | Reset-to-default per binding | settings page | S |

---

## 6. Risks / gotchas

- **Definitions populate lazily.** `registerDefinition` runs at module-eval time, so
  `Keybinds.definitions` is only complete once all keybind-defining modules (tools, controllers)
  have loaded. A settings page must open after startup (true in practice) or it will list a
  partial set.
- **`setKeys` has no change signal** (item 5) — without it, live rebinds won't update open
  tooltips or on-screen labels, and any future "is this key already bound?" UI can't react.
- **Combinations & alternatives.** The data model is `KeyCombination[]` (alternatives), each a
  `KeyCode[]` (held-together). A single-key capture control covers the common case but silently
  can't represent Shift+O or "F or ButtonX". Decide whether v1 rebinds only the primary keyboard
  binding and preserves the gamepad alternative, or supports full combos.
- **Reserved-key collisions.** Users can rebind onto Roblox-reserved keys (I/O zoom, WASD, Space).
  The system's priority param (now on `registerDefinition`) can win the key, but a validator
  should at least warn. (See the freecam Shift+O / edit-tool `I` fixes for precedent.)
- **Priority is code-owned, not user-owned.** `priority` is set at registration for CAS ordering;
  it should **not** be persisted or exposed in the rebinding UI — only `keys` are user-editable.
- **Unbinding.** Decide whether an empty combo means "unbound" and whether that's allowed
  (some actions may need to remain bound).
- **Context is orthogonal.** Whether a keybind is active (edit tool selected, build vs ride mode)
  is governed by the Action's component lifecycle, not the binding — rebinding changes *which key*,
  not *when it's live*. No interaction to worry about.

---

## 7. Effort assessment

**Moderate, front-loaded on UI.** The load-bearing infrastructure — runtime rebind (`setKeys`),
key capture (`KeyChooserControl`), observable registries, `displayPath` grouping, trivial
string serialization, and a config system that backfills new fields without a version bump —
**already exists**. The genuinely new work is the settings page (item 4), the combo/multi-binding
capture UX (item 6), and a change-notification signal (item 5); the persistence glue (items 1–3, 8)
is small and follows established config patterns.

**Recommended increments:**
1. **MVP** — single-key keyboard rebind for the common actions: config field + load/save +
   a settings page reusing `KeyChooserControl` + reset. Ships the feature for ~90% of keybinds.
2. **Fidelity** — add the `keysChanged` signal (live tooltip refresh) and conflict/reserved-key
   validation.
3. **Full** — combination + keyboard/gamepad-alternative capture for the remaining actions.

---

## Key files

| Concern | File |
|---|---|
| Keybind core (definitions, registrations, CAS bind, `setKeys`) | `src/engine/client/Keybinds.ts` |
| Key-name ↔ `Enum.KeyCode`, validators | `src/engine/shared/fixes/Keys.ts` |
| Key-capture control (single key) | `src/client/gui/controls/KeyChooserControl.ts` |
| Action ↔ keybind wiring (`initKeybind`, Sink/Pass) | `src/client/Action.propmacro.ts` |
| Tooltip rendering of current keys | `src/client/gui/static/TooltipsControl.ts:101-105` |
| Player config + persistence (`addDefaults`, `sendPlayerConfig`) | `src/shared/config/PlayerConfig.ts`, `src/client/PlayerDataStorage.ts` |
| Config-control precedent | `src/client/gui/configControls/ConfigControlKey.ts` |
| Priority param (CAS ordering) | `src/engine/client/Keybinds.ts` + `src/client/controller/FreecamController.ts` |
