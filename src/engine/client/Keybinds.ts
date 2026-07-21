import { ContextActionService, UserInputService } from "@rbxts/services";
import { ObservableMap } from "engine/shared/event/ObservableMap";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Signal } from "engine/shared/event/Signal";
import { Keys } from "engine/shared/fixes/Keys";

type KeybindSubscription = {
	readonly func: (input: InputObject) => Enum.ContextActionResult | Enum.ContextActionResult["Name"];
	readonly connection: SignalConnection;
};

export type { KeybindRegistration };
class KeybindRegistration {
	private readonly indices: number[] = [];
	private readonly subscriptions: {
		[k in Enum.UserInputState["Name"]]?: { [k in number]?: Set<KeybindSubscription> };
	} = {};
	private keys: readonly KeyCombination[];

	private readonly _isPressed = new ObservableValue(false);
	readonly isPressed = this._isPressed.asReadonly();

	constructor(
		readonly action: string,
		readonly displayPath: readonly string[],
		defaultKeys: readonly KeyCombination[],
		private readonly bindPriority?: number,
	) {
		this.keys = defaultKeys;
		this.register();

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

			const anyPressed = this.keys.any((comb) => comb.all((k) => UserInputService.IsKeyDown(k)));
			if (!anyPressed) {
				if (input.UserInputState === Enum.UserInputState.End) {
					const result = process(this.subscriptions[input.UserInputState.Name] ?? []);
					if (result) return result;
				}

				return Enum.ContextActionResult.Pass;
			}

			const result = process(this.subscriptions[input.UserInputState.Name] ?? {});
			if (result) return result;

			return Enum.ContextActionResult.Pass;
		};

		const inputs = this.keys.flatmap((k) => k.map((k) => Keys.Keys[k]));
		if (this.bindPriority !== undefined) {
			ContextActionService.BindActionAtPriority(this.action, handler, false, this.bindPriority, ...inputs);
		} else {
			ContextActionService.BindAction(this.action, handler, false, ...inputs);
		}
	}

	getKeys(): readonly KeyCombination[] {
		return this.keys;
	}
	setKeys(keys: readonly KeyCombination[]) {
		this.keys = keys;
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

		const connection = Signal.connection(() => subs[priority]?.delete(sub));
		const sub = { func, connection };

		if (!subs[priority]) {
			this.indices.push(priority);
			this.indices.sort();
		}
		(subs[priority] ??= new Set()).add(sub);

		return connection;
	}
}

export type KeyCombination = readonly KeyCode[];
export interface KeybindDefinition {
	readonly action: string;
	readonly displayPath: readonly string[];
	readonly keys: readonly KeyCombination[];
	/** ContextActionService bind priority; higher wins the input over lower bindings (e.g. the core camera). */
	readonly priority?: number;
}

export class Keybinds {
	private static readonly definitions = new ObservableMap<string, KeybindDefinition>();

	static registerDefinition(
		action: string,
		displayPath: readonly string[],
		keys: readonly KeyCombination[],
		priority?: number,
	): KeybindDefinition {
		let definition = this.definitions.get(action);
		if (!definition) {
			this.definitions.set(action, (definition = { action, displayPath, keys, priority }));
		}

		return definition;
	}

	private readonly _registrations = new ObservableMap<string, KeybindRegistration>();
	readonly registrations = this._registrations.asReadonly();

	fromDefinition({ action, displayPath, keys, priority }: KeybindDefinition): KeybindRegistration {
		return this.register(action, displayPath, keys, priority);
	}

	register(
		action: string,
		displayPath: readonly string[],
		keys: readonly KeyCombination[],
		priority?: number,
	): KeybindRegistration {
		let registration = this._registrations.get(action);
		if (!registration) {
			this._registrations.set(
				action,
				(registration = new KeybindRegistration(action, displayPath, keys, priority)),
			);
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
