import { showColorChooser } from "client/gui/ColorChooserPopup";
import { ColorVisualizerWithAlpha } from "client/gui/ColorVisualizerWithAlpha";
import { ConfigControlBase } from "client/gui/configControls/ConfigControlBase";
import { Color4TextBox } from "client/gui/controls/Color4TextBox";
import { Control } from "engine/client/gui/Control";
import { Observables } from "engine/shared/event/Observables";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { SubmittableValue } from "engine/shared/event/SubmittableValue";
import type { ColorVisualizerWithAlphaDefinition } from "client/gui/ColorVisualizerWithAlpha";
import type { ConfigControlBaseDefinition } from "client/gui/configControls/ConfigControlBase";
import type { PopupController } from "client/gui/PopupController";

class ColorControl extends Control<ConfigControlColorDefinition["Control"]> {
	readonly value;

	constructor(gui: ConfigControlColorDefinition["Control"], defaultColor: Color4, allowAlpha: boolean) {
		super(gui);

		const v = new SubmittableValue(new ObservableValue<Color4>(defaultColor));
		this.value = v.asHalfReadonly();

		this.parent(new Color4TextBox(gui.RGBA, v, allowAlpha));
		this.parent(new ColorVisualizerWithAlpha(gui.Preview, v.value));

		this.$onInjectAuto((popupController: PopupController) => {
			this.parent(new Control(gui.EditControl)) //
				.addButtonAction(() => showColorChooser(popupController, gui, v, allowAlpha));
		});

		this.parent(new Control(gui.UnsetControl)) //
			.addButtonAction(() => v.submit(defaultColor));
	}
}

declare module "client/gui/configControls/ConfigControlsList" {
	export interface ConfigControlTemplateList {
		readonly Color: ConfigControlColorDefinition;
	}
}

export type ConfigControlColorDefinition = ConfigControlBaseDefinition & {
	readonly Control: GuiObject & {
		readonly Preview: ColorVisualizerWithAlphaDefinition;
		readonly RGBA: TextBox;
		readonly EditControl: GuiButton;
		readonly UnsetControl: GuiButton;
	};
};
export class ConfigControlColor extends ConfigControlBase<ConfigControlColorDefinition, Color4> {
	constructor(gui: ConfigControlColorDefinition, name: string, defaultColor: Color4, alpha = false) {
		super(gui, name);

		const control = this.parent(new ColorControl(gui.Control, defaultColor, alpha));

		this.initFromMultiWithDefault(control.value.value, () => defaultColor);
		this.event.subscribe(control.value.submitted, (value) => this.submit(this.multiMap(() => value)));
	}

	initColor(
		observable: ObservableValue<object>,
		colorPath: readonly string[],
		transparencyPath: readonly string[],
		updateType: "value" | "submit" = "submit",
	): this {
		const color = this.event.addObservable(
			Observables.createObservableFromObjectProperty<Color3>(observable, colorPath),
		);
		let alpha = this.event.addObservable(
			Observables.createObservableFromObjectProperty<number>(observable, transparencyPath),
		);
		alpha = this.event.addObservable(
			alpha.fCreateBased(
				(c) => 1 - c,
				(c) => 1 - c,
			),
		);

		const stuff = this.event.addObservable(Observables.createObservableFromMultiple({ color, alpha }));

		return this.initToObservable(stuff, updateType);
	}
}

export class ConfigControlColor3 extends ConfigControlBase<ConfigControlColorDefinition, Color3> {
	constructor(gui: ConfigControlColorDefinition, name: string, defaultColor: Color3) {
		super(gui, name);

		const control = this.parent(new ColorControl(gui.Control, { alpha: 1, color: defaultColor }, false));

		const c3 = this.event.addObservable(
			control.value.value.fCreateBased(
				(c) => c.color,
				(c) => ({ alpha: 1, color: c }),
			),
		);
		this.initFromMultiWithDefault(c3, () => defaultColor);
		this.event.subscribe(control.value.submitted, (value) => this.submit(this.multiMap(() => value.color)));
	}
}
