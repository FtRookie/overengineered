import { Control } from "engine/client/gui/Control";
import { NumberObservableValue } from "engine/shared/event/NumberObservableValue";
import { Signal } from "engine/shared/event/Signal";

/** Control that represents a byte via a text input */
export type ByteTextBoxControlDefinition = TextBox;
export class ByteTextBoxControl extends Control<ByteTextBoxControlDefinition> {
	readonly submitted = new Signal<(value: number) => void>();
	readonly value = new NumberObservableValue<number>(0, 0, 255, 1);

	constructor(gui: ByteTextBoxControlDefinition) {
		super(gui);

		this.event.subscribeObservable(
			this.value,
			(value) => {
				let text = tostring(value ?? "");
				text = string.format("%02X", value);

				this.gui.Text = text;
			},
			true,
		);

		this.event.subscribe(this.gui.FocusLost, () => this.commit(true));
		this.event.subscribe(this.gui.ReturnPressedFromOnScreenKeyboard, () => this.commit(false));
	}

	private commit(byLostFocus: boolean) {
		const text = this.gui.Text.gsub("[^%dA-Fa-f]", "")[0];
		const sanitizedText = text.size() > 2 ? text.sub(-2) : text;

		let num = tonumber(sanitizedText, 16);

		if (num === undefined) {
			if (byLostFocus) {
				this.gui.Text = string.format("%02X", this.value.get() ?? 0);
				return;
			}

			this.gui.Text = "00";
			num = 0;
		}

		if (num === this.value.get()) {
			this.gui.Text = string.format("%02X", num);
			return;
		}

		this.value.set(num);
		this.submitted.Fire(num);
		this.gui.Text = string.format("%02X", num);
	}

	destroy() {
		this.commit(true);
		super.destroy();
	}
}
