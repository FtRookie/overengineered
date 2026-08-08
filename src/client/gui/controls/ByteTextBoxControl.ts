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

		this.event.subscribe(this.gui.FocusLost, () => this.commit(true, true));
		this.event.subscribe(this.gui.ReturnPressedFromOnScreenKeyboard, () => this.commit(false, true));
	}

	/**
	 * @param fromUser An edit the player finished. It reports the value even when it already matches the one
	 * held, because a cell that was never written reads 0, so typing 0 into one must still register.
	 */
	private commit(byLostFocus: boolean, fromUser = false) {
		const text = this.gui.Text.gsub("[^%dA-Fa-f]", "")[0];

		let num = tonumber(text, 16);
		if (num === undefined) {
			if (byLostFocus) {
				this.gui.Text = string.format("%02X", this.value.get() ?? 0);
				return;
			}

			this.gui.Text = "00";
			num = 0;
		}

		num = math.clamp(math.floor(num), 0, 255);

		if (num === this.value.get() && !fromUser) {
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
