import { PartialControl } from "engine/client/gui/PartialControl";
import { ObservableValue } from "engine/shared/event/ObservableValue";

declare module "client/gui/configControls/ConfigControlsList" {
	export interface ConfigControlTemplateList {
		readonly Search: ConfigControlSearchDefinition;
	}
}

export type ConfigControlSearchDefinition = GuiObject & ConfigControlSearchDefinitionParts;
export type ConfigControlSearchDefinitionParts = {
	readonly TitleLabel: TextLabel;
	readonly Preview: TextBox;
};

/** A filter box for a settings page. Not a config value — nothing here is stored. */
export class ConfigControlSearch extends PartialControl<ConfigControlSearchDefinitionParts> {
	readonly text = new ObservableValue("");

	constructor(gui: ConfigControlSearchDefinition, name: string, placeholder?: string) {
		super(gui);

		this.parts.TitleLabel.Text = name;
		if (placeholder !== undefined) {
			this.parts.Preview.PlaceholderText = placeholder;
		}

		// per keystroke, not on submit: a filter that waits for Enter reads as broken
		this.event.subscribe(this.parts.Preview.GetPropertyChangedSignal("Text"), () =>
			this.text.set(this.parts.Preview.Text),
		);
	}
}
