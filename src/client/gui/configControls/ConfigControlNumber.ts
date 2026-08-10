import { ConfigControlBase } from "client/gui/configControls/ConfigControlBase";
import { NumberTextBoxControlNullable } from "client/gui/controls/NumberTextBoxControl";
import { MathUtils } from "engine/shared/fixes/MathUtils";
import { Objects } from "engine/shared/fixes/Objects";
import type { ConfigControlBaseDefinition } from "client/gui/configControls/ConfigControlBase";
import type { NumberTextBoxControlDefinition } from "client/gui/controls/NumberTextBoxControl";

declare module "client/gui/configControls/ConfigControlsList" {
	export interface ConfigControlTemplateList {
		readonly Number: ConfigControlNumberDefinition;
	}
}

export type ConfigControlNumberDefinition = ConfigControlBaseDefinition & {
	readonly Buttons: GuiObject & {
		readonly TextBox: NumberTextBoxControlDefinition;
	};
};
export class ConfigControlNumber extends ConfigControlBase<ConfigControlNumberDefinition, number> {
	constructor(
		gui: ConfigControlNumberDefinition,
		name: string,
		min: number | undefined,
		max: number | undefined,
		step: number | undefined,
	) {
		super(gui, name);

		const control = this.parent(new NumberTextBoxControlNullable(gui.Buttons.TextBox, min, max, step));

		this.initFromMulti(control.value);
		this.valueChanged((values) => (control.relative = Objects.size(values) > 1));

		this.event.subscribe(control.submitted, (value, apply) =>
			this.submit(
				this.multiMap((_, current) => (apply ? MathUtils.clamp(apply(current), min, max, step) : value)),
			),
		);
	}
}
