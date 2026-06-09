import { NumberTextBoxControl } from "client/gui/controls/NumberTextBoxControl";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

type NumberControlDefinition = GuiObject & {
	readonly SubButton: GuiButton;
	readonly AddButton: GuiButton;
	readonly ValueTextBox: TextBox;
};
class NumberControl extends Control<NumberControlDefinition> {
	constructor(gui: NumberControlDefinition, value: ObservableValue<number>) {
		super(gui);

		this.parent(new ButtonControl(gui.AddButton, () => value.set(value.get() + 1)));
		this.parent(new ButtonControl(gui.SubButton, () => value.set(value.get() - 1)));
		this.parent(new NumberTextBoxControl(gui.ValueTextBox, value));
	}
}

export type ScaleEditorControlDefinition = GuiObject & {
	readonly ScaleAllControl: GuiObject & {
		readonly ConfirmButton: GuiButton;
		readonly ValueTextBox: TextBox;
	};
	readonly ScaleXControl: NumberControlDefinition;
	readonly ScaleYControl: NumberControlDefinition;
	readonly ScaleZControl: NumberControlDefinition;
};
export class ScaleEditorControl extends Control<ScaleEditorControlDefinition> {
	constructor(gui: ScaleEditorControlDefinition, scale: ObservableValue<Vector3>) {
		super(gui);

		const createVectorNum = (axis: "X" | "Y" | "Z"): ObservableValue<number> => {
			const clamp = (v: number) => math.clamp(v, 1 / 512, 512);

			const value = this.event.addObservable(
				scale.fCreateBased<number>(
					(v) => clamp(v[axis]),
					(v) =>
						new Vector3(
							clamp(axis === "X" ? v : scale.get().X),
							clamp(axis === "Y" ? v : scale.get().Y),
							clamp(axis === "Z" ? v : scale.get().Z),
						),
				),
			);

			return value;
		};

		this.parent(new NumberControl(gui.ScaleXControl, createVectorNum("X")));
		this.parent(new NumberControl(gui.ScaleYControl, createVectorNum("Y")));
		this.parent(new NumberControl(gui.ScaleZControl, createVectorNum("Z")));

		const all = this.parent(new NumberTextBoxControl(gui.ScaleAllControl.ValueTextBox, 1 / 32, 256));
		all.value.set(1);
		this.parent(
			new ButtonControl(gui.ScaleAllControl.ConfirmButton, () => {
				const val = all.value.get();
				scale.set(new Vector3(val, val, val));
			}),
		);
	}
}
