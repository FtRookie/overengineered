import { Control } from "engine/client/gui/Control";
import { NumberObservableValue } from "engine/shared/event/NumberObservableValue";
import { Signal } from "engine/shared/event/Signal";

/** Control that represents a fixed-width hex number via a text input */
export type HexTextBoxControlDefinition = TextBox;

export class HexTextBoxControl extends Control<HexTextBoxControlDefinition> {
	readonly submitted = new Signal<(value: number) => void>();
	readonly value;

	private readonly max;
	private readonly format;

	constructor(gui: HexTextBoxControlDefinition, digits: number) {
		super(gui);

		this.max = 16 ** digits - 1;
		this.format = `%0${digits}X`;
		this.value = new NumberObservableValue<number>(0, 0, this.max, 1);

		this.event.subscribeObservable(
			this.value,
			(value) => {
				this.gui.Text = string.format(this.format, value ?? 0);
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
				this.gui.Text = string.format(this.format, this.value.get() ?? 0);
				return;
			}

			num = 0;
		}

		num = math.clamp(math.floor(num), 0, this.max);

		if (num === this.value.get() && !fromUser) {
			this.gui.Text = string.format(this.format, num);
			return;
		}

		this.value.set(num);
		this.submitted.Fire(num);
		this.gui.Text = string.format(this.format, num);
	}

	destroy() {
		this.commit(true);
		super.destroy();
	}
}
