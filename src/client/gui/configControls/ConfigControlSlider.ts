import { ConfigControlBase } from "client/gui/configControls/ConfigControlBase";
import { SliderControlNullable } from "client/gui/controls/SliderControl";
import { MathUtils } from "engine/shared/fixes/MathUtils";
import { Objects } from "engine/shared/fixes/Objects";
import type { ConfigControlBaseDefinition } from "client/gui/configControls/ConfigControlBase";
import type { SliderControlConfig, SliderControlDefinition } from "client/gui/controls/SliderControl";

declare module "client/gui/configControls/ConfigControlsList" {
	export interface ConfigControlTemplateList {
		readonly Slider: ConfigControlSliderDefinition;
	}
}

export type ConfigControlSliderDefinition = ConfigControlBaseDefinition & {
	readonly Control: SliderControlDefinition;
	readonly ManualControl: TextBox;
};
export class ConfigControlSlider extends ConfigControlBase<ConfigControlSliderDefinition, number> {
	constructor(gui: ConfigControlSliderDefinition, name: string, config: SliderControlConfig) {
		super(gui, name);

		const control = this.parent(new SliderControlNullable(gui.Control, config, { TextBox: gui.ManualControl }));

		this.initFromMulti(control.value);
		this.valueChanged((values) => control.setRelative(Objects.size(values) > 1));

		this.event.subscribe(control.submitted, (value, apply) =>
			this.submit(
				this.multiMap((_, current) =>
					apply ? MathUtils.clamp(apply(current), config.min, config.max, config.step) : value,
				),
			),
		);
	}
}
