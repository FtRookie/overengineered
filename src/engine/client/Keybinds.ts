import { ContextActionService } from "@rbxts/services";
import { InputController } from "engine/client/InputController";
import { ObservableMap } from "engine/shared/event/ObservableMap";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Signal } from "engine/shared/event/Signal";
import { Keys } from "engine/shared/fixes/Keys";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

type KeybindSubscription = {
	readonly func: (input: InputObject) => Enum.ContextActionResult | Enum.ContextActionResult["Name"];
	readonly connection: SignalConnection;
};

/**
 * Everything BindAction accepts, which is wider than a key. An action reachable only through its touch button
 * binds {@link Enum.UserInputType.None}: no device can produce it, so it keeps the binding non-empty without
 * opening a second way to fire the action.
 */
export type BoundInput = Enum.KeyCode | Enum.PlayerActions | Enum.UserInputType;

/** ContextActionService owns the button, so a press cannot be suppressed at the source while it is dragged. */
let arrangingTouchButtons = false;
/** Set by the arrange mode, so dragging a touch button does not also fire its action. */
export function setArrangingTouchButtons(arranging: boolean) {
	arrangingTouchButtons = arranging;
}

export type { KeybindRegistration };
class KeybindRegistration {
	private readonly indices: number[] = [];
	private readonly subscriptions: {
		[k in Enum.UserInputState["Name"]]?: { [k in number]?: Set<KeybindSubscription> };
	} = {};
	private held = false;

	private readonly _keys: ObservableValue<readonly KeyCombination[]>;
	/** Subscribe to refresh anything showing the bound keys; a rebind fires this. */
	readonly keys: ReadonlyObservableValue<readonly KeyCombination[]>;

	private readonly _isPressed = new ObservableValue(false);
	readonly isPressed = this._isPressed.asReadonly();
	/** Where the player dragged this button to, overriding the authored position. */
	private touchPosition?: UDim2;

	constructor(
		readonly action: string,
		readonly displayPath: readonly string[],
		/** Kept so a rebind can be undone without consulting the definition registry. */
		readonly defaultKeys: readonly KeyCombination[],
		private readonly bindPriority?: number,
		private readonly touchButton?: TouchButtonInfo,
	) {
		this._keys = new ObservableValue<readonly KeyCombination[]>(defaultKeys);
		this.keys = this._keys.asReadonly();
		this.register();

		// the button only exists while the device is touch, so plugging a controller in mid-session re-binds
		if (touchButton) InputController.inputType.changed.Connect(() => this.register());

		this.onDown(() => {
			this._isPressed.set(true);
			return "Pass";
		});
		this.onUp(() => {
			this._isPressed.set(false);
			return "Pass";
		});
	}

	private register() {
		ContextActionService.UnbindAction(this.action);
		this.held = false;

		const handler = (name: string, state: Enum.UserInputState, input: InputObject) => {
			if (name !== this.action) return;

			const process = (subs: { [x: number]: Set<KeybindSubscription> | undefined }) => {
				for (const k of [...this.indices]) {
					if (!subs[k]) continue;

					for (const { func } of [...subs[k]]) {
						const result = func(input);
						if (result === Enum.ContextActionResult.Sink || result === "Sink") {
							return Enum.ContextActionResult.Sink;
						}
					}
				}
			};

			if (state === Enum.UserInputState.Begin) InputController.setKeyHeld(input.KeyCode, true);
			else if (state === Enum.UserInputState.End) InputController.setKeyHeld(input.KeyCode, false);

			const modifiersHeld = (comb: KeyCombination) => {
				for (let i = 0; i < comb.size() - 1; i++) {
					if (!InputController.isKeyHeld(Keys.Keys[comb[i]])) return false;
				}

				return true;
			};

			// The touch button carries no key to match against. Nothing else can arrive without one, because
			// the only non-key input ever bound is None, which no device produces.
			const fromTouchButton =
				this.touchButton !== undefined &&
				(input.UserInputType === Enum.UserInputType.Touch || input.KeyCode === Enum.KeyCode.Unknown);

			if (fromTouchButton && arrangingTouchButtons) return Enum.ContextActionResult.Sink;

			if (state === Enum.UserInputState.Begin) {
				if (this.held) return Enum.ContextActionResult.Pass;
				if (
					!fromTouchButton &&
					!this._keys
						.get()
						.any((comb) => Keys.Keys[comb[comb.size() - 1]] === input.KeyCode && modifiersHeld(comb))
				) {
					return Enum.ContextActionResult.Pass;
				}
				this.held = true;

				const result = process(this.subscriptions.Begin ?? {});
				if (result) return result;

				return Enum.ContextActionResult.Pass;
			}

			if (state === Enum.UserInputState.End && this.held) {
				this.held = false;

				const result = process(this.subscriptions.End ?? {});
				if (result) return result;
			}

			return Enum.ContextActionResult.Pass;
		};

		const touch = this.touchButton !== undefined && InputController.inputType.get() === "Touch";
		const keys = this._keys.get().flatmap((k) => k.map((k) => Keys.Keys[k]));
		// On a touch device the button is the input, so it must not need a key to exist. None keeps the
		// binding non-empty while staying unproducible, leaving the button the only way through it.
		const inputs: BoundInput[] = touch ? [...keys, Enum.UserInputType.None] : keys;
		if (inputs.isEmpty()) return; // unbound; BindAction with no keys is not a binding

		if (this.bindPriority !== undefined) {
			ContextActionService.BindActionAtPriority(this.action, handler, touch, this.bindPriority, ...inputs);
		} else {
			ContextActionService.BindAction(this.action, handler, touch, ...inputs);
		}

		if (touch) {
			ContextActionService.SetDescription(this.action, this.touchButton!.description);
			ContextActionService.SetImage(this.action, this.touchButton!.image);
			ContextActionService.SetPosition(this.action, this.touchPosition ?? this.touchButton!.position);
		}
	}

	getKeys(): readonly KeyCombination[] {
		return this._keys.get();
	}
	setKeys(keys: readonly KeyCombination[]) {
		this._keys.set(keys);
		this.register();
	}
	/** Undefined restores the authored position. */
	setTouchPosition(position: UDim2 | undefined) {
		if (this.touchPosition === position) return;

		this.touchPosition = position;

		// Moved in place rather than re-registered: rebinding destroys and recreates the button, which drops
		// whatever was attached to the old instance — the arrange mode's drag handlers among them.
		const target = position ?? this.touchButton?.position;
		if (target && ContextActionService.GetButton(this.action)) {
			ContextActionService.SetPosition(this.action, target);
			return;
		}

		this.register();
	}

	onDown(func: KeybindSubscription["func"], priority?: number): SignalConnection {
		return this.on(Enum.UserInputState.Begin, func, priority);
	}
	onUp(func: KeybindSubscription["func"], priority?: number): SignalConnection {
		return this.on(Enum.UserInputState.End, func, priority);
	}
	private on(state: Enum.UserInputState, func: KeybindSubscription["func"], priority?: number): SignalConnection {
		priority ??= 0;

		const subs = (this.subscriptions[state.Name] ??= {});

		const connection = Signal.connection(() => {
			subs[priority]?.delete(sub);
			this.held = false;
			this._isPressed.set(false);
		});
		const sub = { func, connection };

		// checked against indices, not subs: indices is shared by both states, so a priority already added by
		// Begin would be added a second time by End and process() would then run every subscription twice
		if (!this.indices.contains(priority)) {
			this.indices.push(priority);
			this.indices.sort();
		}
		(subs[priority] ??= new Set()).add(sub);

		return connection;
	}
}

export type KeyCombination = readonly KeyCode[];
/** An on-screen button for touch devices, where there is no key to press. */
export interface TouchButtonInfo {
	readonly description: string;
	readonly image: string;
	readonly position: UDim2;
}
export interface KeybindDefinition {
	readonly action: string;
	readonly displayPath: readonly string[];
	readonly keys: readonly KeyCombination[];
	/** Set higher if certain keys are blocked by GameProcessedEvent */
	readonly priority?: number;
	readonly touchButton?: TouchButtonInfo;
}

export class Keybinds {
	private static readonly _definitions = new ObservableMap<string, KeybindDefinition>();
	/** Every registered keybind, including ones nothing has instantiated yet. */
	static readonly definitions = this._definitions.asReadonly();

	static registerDefinition(
		action: string,
		displayPath: readonly string[],
		keys: readonly KeyCombination[],
		priority?: number,
		touchButton?: TouchButtonInfo,
	): KeybindDefinition {
		let definition = this._definitions.get(action);
		if (!definition) {
			this._definitions.set(action, (definition = { action, displayPath, keys, priority, touchButton }));
		}

		return definition;
	}

	private readonly _registrations = new ObservableMap<string, KeybindRegistration>();
	readonly registrations = this._registrations.asReadonly();
	private overrides: { readonly [action: string]: readonly KeyCombination[] } = {};
	private touchPositions: { readonly [action: string]: UDim2 } = {};

	/** Replaces the user's bindings. A present but empty list means "deliberately unbound". */
	setOverrides(overrides: { readonly [action: string]: readonly KeyCombination[] }) {
		this.overrides = overrides;

		// registrations are created lazily, so this covers the ones already alive and register() the rest
		for (const [, registration] of this._registrations.getAll()) {
			registration.setKeys(this.keysFor(registration.action, registration.defaultKeys));
		}
	}

	/** Replaces the player's dragged button positions; an absent entry falls back to the authored one. */
	setTouchButtonPositions(positions: { readonly [action: string]: UDim2 }) {
		this.touchPositions = positions;

		for (const [, registration] of this._registrations.getAll()) {
			registration.setTouchPosition(this.touchPositions[registration.action]);
		}
	}

	private keysFor(action: string, defaultKeys: readonly KeyCombination[]): readonly KeyCombination[] {
		// presence wins, so an empty list can mean "no key" — absent is what falls back to the default
		return this.overrides[action] ?? defaultKeys;
	}

	fromDefinition({ action, displayPath, keys, priority, touchButton }: KeybindDefinition): KeybindRegistration {
		return this.register(action, displayPath, keys, priority, touchButton);
	}

	register(
		action: string,
		displayPath: readonly string[],
		keys: readonly KeyCombination[],
		priority?: number,
		touchButton?: TouchButtonInfo,
	): KeybindRegistration {
		let registration = this._registrations.get(action);
		if (!registration) {
			this._registrations.set(
				action,
				(registration = new KeybindRegistration(action, displayPath, keys, priority, touchButton)),
			);

			const overridden = this.keysFor(action, keys);
			if (overridden !== keys) registration.setKeys(overridden);

			const position = this.touchPositions[action];
			if (position) registration.setTouchPosition(position);
		}

		return registration;
	}

	get(action: string): KeybindRegistration {
		const registration = this._registrations.get(action);
		if (!registration) {
			throw `Unknown registration ${action}`;
		}

		return registration;
	}
}
