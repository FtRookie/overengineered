import { NumberTextBoxControl } from "client/gui/controls/NumberTextBoxControl";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import type { EditMode } from "client/modes/build/BuildingMode";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

type NumberControlDefinition = GuiObject & {
	readonly SubButton: GuiButton;
	readonly AddButton: GuiButton;
	readonly ValueTextBox: TextBox;
};
class NumberControl extends Control<NumberControlDefinition> {
	constructor(gui: NumberControlDefinition, value: ObservableValue<number>) {
		super(gui);

		this.add(new ButtonControl(gui.AddButton, () => value.set(value.get() * 2)));
		this.add(new ButtonControl(gui.SubButton, () => value.set(value.get() / 2)));
		this.add(new NumberTextBoxControl(gui.ValueTextBox, value));
	}
}

type DoubleSwitchDefinition = GuiObject & {
	readonly Frame: GuiObject;
	readonly LocalButton: GuiButton;
	readonly GlobalButton: GuiButton;
};
class DoubleSwitch extends Control<DoubleSwitchDefinition> {
	constructor(gui: DoubleSwitchDefinition, mode: ObservableValue<EditMode>) {
		super(gui);

		this.event.subscribeObservable(
			mode,
			(mode) => {
				gui.Frame.AnchorPoint = new Vector2(mode === "local" ? 0 : 1, 0);
				gui.Frame.Position = new UDim2(mode === "local" ? 0 : 1, 0, 0, 0);
			},
			true,
		);

		this.add(new ButtonControl(gui.LocalButton, () => mode.set("local")));
		this.add(new ButtonControl(gui.GlobalButton, () => mode.set("global")));
	}
}

export type GridEditorControlDefinition = GuiObject & {
	readonly Move: GuiObject & {
		readonly Control: NumberControlDefinition;
	};
	readonly Rotate: GuiObject & {
		readonly Control: NumberControlDefinition;
	};
	readonly TriangleThickness: GuiObject & {
		readonly Control: NumberControlDefinition;
	};
	readonly RelativeSwitch: DoubleSwitchDefinition;
};
export class GridEditorControl extends Control<GridEditorControlDefinition> {
	constructor(
		gui: GridEditorControlDefinition,
		moveStep: ObservableValue<number>,
		rotateStep: ObservableValue<number>,
		triangleThickness: ObservableValue<number>,
		mode?: ObservableValue<EditMode>,
	) {
		super(gui);

		gui.RelativeSwitch.Visible = mode !== undefined;
		if (mode) {
			this.add(new DoubleSwitch(gui.RelativeSwitch, mode));
		}

		this.add(new NumberControl(gui.Move.Control, moveStep));
		this.add(new NumberControl(gui.Rotate.Control, rotateStep));
		this.add(new NumberControl(gui.TriangleThickness.Control, triangleThickness));
	}
}
