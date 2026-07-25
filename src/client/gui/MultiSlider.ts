import { SliderControlNullable } from "client/gui/controls/SliderControl";
import { Control } from "engine/client/gui/Control";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import type { SliderControlConfig, SliderControlDefinition } from "client/gui/controls/SliderControl";

export type MultiSliderRowDefinition = GuiObject & {
	readonly Control: SliderControlDefinition;
	readonly ManualControl: TextBox;
	readonly SliderNameLabel: TextLabel;
};

class MultiSliderRow extends Control<MultiSliderRowDefinition> {
	readonly slider;

	constructor(gui: MultiSliderRowDefinition, name: string, config: SliderControlConfig) {
		super(gui);

		gui.SliderNameLabel.Text = name;
		this.slider = this.parent(new SliderControlNullable(gui.Control, config, { TextBox: gui.ManualControl }));
	}
}

export type MultiSliderDefinition = GuiObject & {
	readonly Data: GuiObject & {
		readonly GroupLabel: TextLabel;
	};
	readonly List: GuiObject & {
		readonly SliderTemplate: MultiSliderRowDefinition;
	};
};

declare module "client/gui/configControls/ConfigControlsList" {
	export interface ConfigControlTemplateList {
		readonly MultiSlider: MultiSliderDefinition;
	}
}

/** A titled group of named sliders — one header, one slider row per entry. */
export class MultiSlider extends Control<MultiSliderDefinition> {
	private readonly template;
	private readonly rows;

	constructor(gui: MultiSliderDefinition, title: string) {
		super(gui);

		gui.Data.GroupLabel.Text = title;
		this.template = this.asTemplate(gui.List.SliderTemplate);
		this.rows = this.parent(new ComponentChildren<MultiSliderRow>().withParentInstance(gui.List));
	}

	addSlider(name: string, config: SliderControlConfig): SliderControlNullable {
		const row = new MultiSliderRow(this.template(), name, config);
		this.rows.add(row);

		return row.slider;
	}
}
