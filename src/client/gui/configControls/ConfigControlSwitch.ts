import { ConfigControlBase } from "client/gui/configControls/ConfigControlBase";
import { SwitchControl } from "client/gui/controls/SwitchControl";
import { Objects } from "engine/shared/fixes/Objects";
import type { ConfigControlBaseDefinitionParts } from "client/gui/configControls/ConfigControlBase";
import type { SwitchControlDefinition, SwitchControlItem } from "client/gui/controls/SwitchControl";

declare module "client/gui/configControls/ConfigControlsList" {
	export interface ConfigControlTemplateList {
		readonly Switch: ConfigControlSwitchDefinition;
	}
}

export type ConfigControlSwitchDefinition = GuiObject &
	ConfigControlSwitchDefinitionParts & {
		readonly Control: SwitchControlDefinition;
	};
export type ConfigControlSwitchDefinitionParts = ConfigControlBaseDefinitionParts & {
	readonly ChosenItemDescriptionLabel: TextLabel;
};
export class ConfigControlSwitch<T extends string> extends ConfigControlBase<
	ConfigControlSwitchDefinition,
	T,
	ConfigControlSwitchDefinitionParts
> {
	constructor(
		gui: ConfigControlSwitchDefinition,
		name: string,
		items: readonly (readonly [key: T, item: SwitchControlItem])[],
	) {
		super(gui, name);

		const control = this.parent(new SwitchControl<T>(gui.Control, items));
		this.initFromMultiWithDefault(control.value, () => items[0][0]);
		this.event.subscribe(control.submitted, (value) => this.submit(this.multiMap(() => value)));

		if (this.parts.ChosenItemDescriptionLabel) {
			const obj = Objects.fromEntries(items);
			control.value.subscribe((value) => {
				if (!value || obj[value]?.description === undefined) {
					this.parts.ChosenItemDescriptionLabel.Visible = false;
				} else {
					this.parts.ChosenItemDescriptionLabel.Visible = true;
					this.parts.ChosenItemDescriptionLabel.Text = `${obj[value].name ?? value}: ${obj[value].description}`;
				}
			}, true);
		}
	}
}
