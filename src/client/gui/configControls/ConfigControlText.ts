import { Control } from "engine/client/gui/Control";

declare module "client/gui/configControls/ConfigControlsList" {
	export interface ConfigControlTemplateList {
		readonly Text: ConfigControlTextDefinition;
	}
}

export type ConfigControlTextDefinition = TextLabel;
export class ConfigControlText extends Control<ConfigControlTextDefinition> {
	constructor(gui: ConfigControlTextDefinition, text: string) {
		super(gui);
		gui.Text = text;
	}
}
