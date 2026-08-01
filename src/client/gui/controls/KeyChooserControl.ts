import { ContextActionService } from "@rbxts/services";
import { SelectButtonPopup, SelectButtonPopupWithCustomString } from "client/gui/popup/SelectButtonPopup";
import { Control } from "engine/client/gui/Control";
import { InputController } from "engine/client/InputController";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Signal } from "engine/shared/event/Signal";
import { Keys } from "engine/shared/fixes/Keys";
import { Colors } from "shared/Colors";
import type { PopupController } from "client/gui/PopupController";

export type KeyChooserControlDefinition = TextButton;

type ToStr<NonString extends boolean> = NonString extends false ? KeyCode : KeyCode | string;
/** Control that represents a key */
class _KeyChooserControl<TKC extends boolean> extends Control<KeyChooserControlDefinition> {
	readonly submitted = new Signal<(value: ToStr<TKC>, prev: ToStr<TKC>) => void>();
	readonly value = new ObservableValue<ToStr<TKC>>("P");

	constructor(
		gui: KeyChooserControlDefinition,
		touchChooserCtor: TKC extends true ? typeof SelectButtonPopupWithCustomString : typeof SelectButtonPopup,
	) {
		super(gui);

		const buttonColor = this.gui.BackgroundColor3;
		const buttonColorActive = Colors.lightenPressed(this.gui.BackgroundColor3);

		this.value.subscribe(
			(value) => (this.gui.Text = value === "Unknown" ? "" : Keys.isKey(value) ? Keys.toReadable(value) : value),
			true,
		);

		this.$onInjectAuto((popupController: PopupController) => {
			this.gui.Activated.Connect(() => {
				if (InputController.inputType.get() === "Touch") {
					const p = new touchChooserCtor(
						(key) => {
							const prev = this.value.get();
							this.value.set(key as ToStr<TKC>);
							this.submitted.Fire(key as ToStr<TKC>, prev);
						},
						() => {},
					);

					popupController.showPopup(p);
				} else {
					this.gui.BackgroundColor3 = buttonColorActive;

					const actionName = "peKeySelection";
					ContextActionService.BindActionAtPriority(
						actionName,
						(name, state, input) => {
							if (actionName === name) {
								if (input.KeyCode === Enum.KeyCode.Escape || input.KeyCode === Enum.KeyCode.Unknown) {
									return Enum.ContextActionResult.Sink;
								}

								ContextActionService.UnbindAction(actionName);

								const prev = this.value.get();
								this.value.set(input.KeyCode.Name);
								this.submitted.Fire(input.KeyCode.Name, prev);
								this.gui.BackgroundColor3 = buttonColor;
							}
						},
						false,
						2000 + 1,
						Enum.UserInputType.Keyboard,
						Enum.UserInputType.Gamepad1,
					);

					this.onDisable(() => ContextActionService.UnbindAction(actionName));
				}
			});
		});
	}
}

export class KeyChooserControl extends _KeyChooserControl<false> {
	constructor(gui: KeyChooserControlDefinition) {
		super(gui, SelectButtonPopup);
	}
}
export class KeyOrStringChooserControl extends _KeyChooserControl<true> {
	constructor(gui: KeyChooserControlDefinition) {
		super(gui, SelectButtonPopupWithCustomString);
	}
}

/**
 * Captures a whole combination: keys accumulate while any is held, and the set is submitted once everything is
 * released. Press order is kept, since Keybinds treats the last key as the trigger and the earlier ones as
 * modifiers to hold first.
 */
export class KeyCombinationChooserControl extends Control<KeyChooserControlDefinition> {
	readonly submitted = new Signal<(value: readonly KeyCode[]) => void>();
	readonly value = new ObservableValue<readonly KeyCode[]>([]);

	constructor(gui: KeyChooserControlDefinition) {
		super(gui);

		const actionName = "peKeyCombinationSelection";
		const buttonColor = this.gui.BackgroundColor3;
		const buttonColorActive = Colors.lightenPressed(this.gui.BackgroundColor3);

		this.value.subscribe((value) => (this.gui.Text = value.map(Keys.toReadable).join(" + ")), true);
		this.onDisable(() => ContextActionService.UnbindAction(actionName));

		this.gui.Activated.Connect(() => {
			const previous = this.value.get();
			const combo: KeyCode[] = [];
			const held = new Set<KeyCode>();

			this.gui.BackgroundColor3 = buttonColorActive;

			const finish = (keep: boolean) => {
				ContextActionService.UnbindAction(actionName);
				this.gui.BackgroundColor3 = buttonColor;

				if (!keep || combo.isEmpty()) {
					this.value.set(previous);
					return;
				}

				this.value.set(combo);
				this.submitted.Fire(combo);
			};

			ContextActionService.BindActionAtPriority(
				actionName,
				(name, state, input) => {
					if (name !== actionName) return Enum.ContextActionResult.Pass;

					if (input.KeyCode === Enum.KeyCode.Escape || input.KeyCode === Enum.KeyCode.Unknown) {
						if (state === Enum.UserInputState.Begin) finish(false);
						return Enum.ContextActionResult.Sink;
					}

					const key = input.KeyCode.Name as KeyCode;
					if (state === Enum.UserInputState.Begin) {
						held.add(key);
						if (!combo.contains(key)) combo.push(key);
						this.value.set([...combo]); // show it building up
					} else if (state === Enum.UserInputState.End) {
						held.delete(key);
						if (held.size() === 0) finish(true);
					}

					return Enum.ContextActionResult.Sink;
				},
				false,
				2000 + 1,
				Enum.UserInputType.Keyboard,
				Enum.UserInputType.Gamepad1,
			);
		});
	}
}
