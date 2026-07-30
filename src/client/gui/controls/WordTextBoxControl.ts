import { Control } from "engine/client/gui/Control";
import { NumberObservableValue } from "engine/shared/event/NumberObservableValue";
import { Signal } from "engine/shared/event/Signal";

export type WordTextBoxControlDefinition = TextBox;

/** Control that represents a 16-bit word via a HEX text input */
export class WordTextBoxControl extends Control<WordTextBoxControlDefinition> {
	readonly submitted = new Signal<(value: number) => void>();
	readonly value = new NumberObservableValue<number>(0, 0, 0xFFFF, 1);

	constructor(gui: WordTextBoxControlDefinition) {
		super(gui);

		this.event.subscribeObservable(
			this.value,
			(value) => {
				this.gui.Text = string.format("%04X", value ?? 0);
			},
			true,
		);

		this.event.subscribe(this.gui.FocusLost, () => this.commit(true));
		this.event.subscribe(this.gui.ReturnPressedFromOnScreenKeyboard, () => this.commit(false));
	}

	private commit(byLostFocus: boolean) {
		const text = this.gui.Text.gsub("[^%dA-Fa-f]", "")[0];

		// 16-bit word = максимум 4 HEX-символа
		if (text.size() > 4) {
			if (byLostFocus) {
				this.gui.Text = string.format("%04X", this.value.get() ?? 0);
				return;
			}

			this.gui.Text = "0000";
			this.value.set(0);
			this.submitted.Fire(0);
			return;
		}

		let num = tonumber(text, 16);

		if (num === undefined) {
			if (byLostFocus) {
				this.gui.Text = string.format("%04X", this.value.get() ?? 0);
				return;
			}

			this.gui.Text = "0000";
			num = 0;
		}

		// Ограничение 16-bit: 0000..FFFF
		num = math.clamp(math.floor(num), 0, 0xFFFF);

		if (num === this.value.get()) {
			this.gui.Text = string.format("%04X", num);
			return;
		}

		this.value.set(num);
		this.submitted.Fire(num);
		this.gui.Text = string.format("%04X", num);
	}

	destroy() {
		this.commit(true);
		super.destroy();
	}
}