# GUI & Input

**Read this before any GUI work at all**, not only the topics named here. Covers keybind registration, touch
buttons, settings rows, and block config controls — and note that broader GUI work is left to the user unless
the pattern is already clearly established.

> Extracted from `CLAUDE.md`, which keeps the tripwires and routes here for detail.

## Keybinds and touch buttons

**Every player-facing key goes through `Keybinds`.** Register a `Keybinds.registerDefinition(action, displayPath, keys, priority?, touchButton?)` and subscribe with `keybinds.fromDefinition(def)`, never `ContextActionService.BindAction` or `InputHandler.onKeyDown("X")` directly. The registries carry a `displayPath` per action precisely so a rebinding UI can enumerate and remap them; a key bound outside the system is invisible to that and can never be rebound. A combination's **last** key is the trigger and the ones before it are modifiers held first, so `[["LeftControl", "L"]]` means holding Ctrl and pressing L.

**On-screen touch buttons are part of the same registration.** Pass a `TouchButtonInfo { description, image, position }` as the fifth argument; `KeybindRegistration` creates the ContextActionService button itself and binds `Enum.UserInputType.None` alongside the keys, so the button still works when the action has no key bound. `TouchButtonController` then lets the player drag it, persisting the position in `interface.touchButtonPositions`. A button made with a raw `BindAction` sits outside all of that — not arrangeable, not resettable, and destroyed the moment the action rebinds. The system originally had no mobile support at all, so treat any older guidance to reach for `createTouchButton` directly as superseded.

Raw `ContextActionService` is still correct for input that isn't a rebindable action: capturing an arbitrary key (`KeyChooserControl`), a key the player configures per block (`KeyboardBlock`), and blanket sinks that swallow whole input types while something is open (`ConfigControlColor`'s `"everything"`, `TutorialController.disableInput`).

## Settings rows

**Settings rows label the row, not the widget.** `addButton("Reset UI Position", func)` names the *row*; the text on the button itself comes from `.button.setButtonText("Reset")`, which must end the builder chain (or be split out into a `const` when another call would otherwise follow it). Passing the button's caption as the first argument silently labels the row instead.

**A settings row must be added synchronously.** `$onInjectAuto` does not run until the component is parented, which puts it after every synchronous `addX` call — so a row created inside its callback lands below every later category rather than where it was written. Add the row in place and let the callback fill in what it needs afterwards: capture the service into a `let`, and configure the row (`initToObservable`, `setValues`) from inside the callback if it depends on an injected value. Only the `addX` call has to be synchronous; the ordering is all it controls.

## Block config controls

**GUI config controls** — `ConfigControlBase<T, V>` is the base class for block configuration UI controls. It wraps a `SubmittableValue` (edit state + submit event) backed by an `ObservableValue`, and supports multi-block editing via `Values<V> = { [k: string]: V }`. Subclass it when building a reusable config input. Leave broader GUI work to the user unless the pattern is clearly established.
