import { ConfigControlBase } from "client/gui/configControls/ConfigControlBase";
import { ToggleControlNullable } from "client/gui/controls/ToggleControl";
import type { ConfigControlBaseDefinition } from "client/gui/configControls/ConfigControlBase";
import type { ToggleControlDefinition } from "client/gui/controls/ToggleControl";

declare module "client/gui/configControls/ConfigControlsList" {
	export interface ConfigControlTemplateList {
		readonly Toggle: ConfigControlToggleDefinition;
	}
}

export type ConfigControlToggleDefinition = ConfigControlBaseDefinition & {
	readonly Control: ToggleControlDefinition;
};
export class ConfigControlToggle extends ConfigControlBase<ConfigControlToggleDefinition, boolean> {
	private readonly control;

	constructor(gui: ConfigControlToggleDefinition, name: string) {
		super(gui, name);

		const control = this.parent(new ToggleControlNullable(gui.Control));
		this.control = control;

		this.initFromMulti(control.value);
		this.event.subscribe(control.submitted, (value) => this.submit(this.multiMap(() => value)));
	}

	setInteractable(interactable: boolean): this {
		this.control.setButtonInteractable(interactable);
		return this;
	}
}
