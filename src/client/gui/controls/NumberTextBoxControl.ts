import { Control } from "engine/client/gui/Control";
import { Colors } from "engine/shared/Colors";
import { Transforms } from "engine/shared/component/Transforms";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Signal } from "engine/shared/event/Signal";
import { MathUtils } from "engine/shared/fixes/MathUtils";
import { Strings } from "engine/shared/fixes/String.propmacro";
import { Expression } from "shared/utils/Expression";

/** ObservableValue that stores a number that can be clamped */
class NumberObservableValue<T extends number | undefined = number> extends ObservableValue<T> {
	constructor(
		value: T,
		readonly min: number | undefined,
		readonly max: number | undefined,
		readonly step?: number,
	) {
		super(value, (value) => {
			if (value === undefined) return value;
			return MathUtils.clamp(value, this.min, this.max, this.step) as T;
		});
	}
}

/** Applies an entered adjustment to an existing value, so one entry can be applied to several different ones. */
export type RelativeApply = (current: number) => number;

/**
 * An entry starting with an operator adjusts what is already there instead of replacing it — `+1` on a mixed
 * selection raises every value by one rather than flattening them all to 1. Subtraction is `--`, which leaves a
 * single `-` to the negative number it reads as.
 */
function relativeApplyOf(text: string): RelativeApply | undefined {
	const trimmed = text.trim();

	if (trimmed.sub(1, 2) === "--") {
		const operand = Expression.evaluate(trimmed.sub(3));
		if (operand === undefined) return undefined;

		return (current) => current - operand;
	}

	const operator = trimmed.sub(1, 1);
	const operand = Expression.evaluate(trimmed.sub(2));
	if (operand === undefined) return undefined;

	if (operator === "+") return (current) => current + operand;
	if (operator === "*") return (current) => current * operand;
	if (operator === "/" && operand !== 0) return (current) => current / operand;

	return undefined;
}

type ToNum<TAllowNull extends boolean> = TAllowNull extends false ? number : number | undefined;
export type NumberTextBoxControlDefinition = TextBox;
/** Control that represents a number via a text input */
class _NumberTextBoxControl<TAllowNull extends boolean = false> extends Control<NumberTextBoxControlDefinition> {
	readonly submitted = new Signal<(value: number, apply?: RelativeApply) => void>();
	readonly value: ObservableValue<ToNum<TAllowNull>>;
	/** Whether an entry may adjust what is already there. Only meaningful for a box standing in for several
	 * values, where each takes the same adjustment; a lone value has nothing to distinguish `+1` from `1`. */
	relative = false;
	private textChanged = false;

	constructor(gui: NumberTextBoxControlDefinition);
	constructor(gui: NumberTextBoxControlDefinition, value: ObservableValue<ToNum<TAllowNull>>);
	constructor(gui: NumberTextBoxControlDefinition, min: number | undefined, max: number | undefined, step?: number);
	constructor(
		gui: NumberTextBoxControlDefinition,
		min?: number | ObservableValue<ToNum<TAllowNull>>,
		max?: number,
		private readonly step?: number,
	) {
		super(gui);

		if (min && typeIs(min, "table")) {
			this.value = min;
		} else {
			this.value = new NumberObservableValue<ToNum<TAllowNull>>(0, min, max, step);
		}

		this.event.subscribeObservable(
			this.value,
			(value) => {
				if (value === undefined) {
					this.gui.Text = "";
					return;
				}

				this.gui.Text = Strings.prettyNumber(value ?? 0, step);
			},
			true,
		);

		this.event.subscribe(this.gui.Focused, () => (this.textChanged = true));
		this.event.subscribe(this.gui.FocusLost, () => this.commit(true));
		this.event.subscribe(this.gui.ReturnPressedFromOnScreenKeyboard, () => this.commit(false));
	}

	private commit(byLostFocus: boolean) {
		if (!this.textChanged) {
			return;
		}

		const apply = this.relative ? relativeApplyOf(this.gui.Text) : undefined;
		if (apply) {
			const current = this.value.get();
			if (current === undefined) {
				// several values behind one box, which stays blank because they are still not all the same
				this.gui.Text = "";
			} else {
				this.value.set(apply(current));
				this.gui.Text = Strings.prettyNumber(this.value.get() ?? 0, this.step);
			}

			this.submitted.Fire(this.value.get() ?? 0, apply);
			return;
		}

		let num = Expression.evaluate(this.gui.Text);
		if (num === undefined) {
			Transforms.create() //
				.flashColor(this.instance, Colors.red)
				.run(this.instance);

			if (byLostFocus) {
				this.gui.Text = Strings.prettyNumber(this.value.get() ?? 0, this.step);
				return;
			}

			this.gui.Text = "0";
			num = 0;
		}
		// Collapse the entered expression to its value even when it resolves to the current one (`2/1` while
		// the box already holds 2): normalize the text, but skip the value set and submit — nothing changed.
		if (num === this.value.get()) {
			this.gui.Text = Strings.prettyNumber(this.value.get() ?? 0, this.step);
			return;
		}

		this.value.set(num);
		this.submitted.Fire(this.value.get()!);
		this.gui.Text = Strings.prettyNumber(this.value.get() ?? 0, this.step);
	}

	destroy() {
		this.commit(true);
		super.destroy();
	}
}

export class NumberTextBoxControl extends _NumberTextBoxControl<false> {}
export class NumberTextBoxControlNullable extends _NumberTextBoxControl<true> {}
