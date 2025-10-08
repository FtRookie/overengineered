import { ConfigControlBase } from "client/gui/configControls/ConfigControlBase";
import { MultiKeyNumberControl } from "client/gui/MultiKeyNumberControl";
import { Objects } from "engine/shared/fixes/Objects";
import type { ConfigControlBaseDefinition } from "client/gui/configControls/ConfigControlBase";
import type { MultiKeyNumberControlDefinition, MultiKeyPart } from "client/gui/MultiKeyNumberControl";

declare module "client/gui/configControls/ConfigControlsList" {
	export interface ConfigControlTemplateList {
		readonly MultiKeys: ConfigControlMultiKeysDefinition;
	}
}

export type ConfigControlMultiKeysDefinition = ConfigControlBaseDefinition & {
	readonly AddButton: GuiButton;
	readonly Buttons: MultiKeyNumberControlDefinition;
};

export class ConfigControlMultiKeys extends ConfigControlBase<
	ConfigControlMultiKeysDefinition,
	readonly MultiKeyPart[]
> {
	constructor(
		gui: ConfigControlMultiKeysDefinition,
		name: string,
		defaultValue: number,
		min: number | undefined,
		max: number | undefined,
	) {
		super(gui, name);

		// const control = this.parent(
		// 	new MultiKeyNumberControl(gui.Buttons, defaultValue, min, max, { AddButton: gui.AddButton }),
		// );

		// this.initFromMultiWithDefault(control.v.value, () => Objects.empty);
		// this.event.subscribe(control.v.submitted, (value) => this.submit(this.multiMap(() => value)));
	}
}
