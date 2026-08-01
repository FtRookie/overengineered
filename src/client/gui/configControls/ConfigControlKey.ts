import { ConfigControlBase } from "client/gui/configControls/ConfigControlBase";
import {
	KeyChooserControl,
	KeyCombinationChooserControl,
	KeyOrStringChooserControl,
} from "client/gui/controls/KeyChooserControl";
import { Control } from "engine/client/gui/Control";
import type {
	ConfigControlBaseDefinition,
	ConfigControlBaseDefinitionParts,
} from "client/gui/configControls/ConfigControlBase";
import type { KeyChooserControlDefinition } from "client/gui/controls/KeyChooserControl";

declare module "client/gui/configControls/ConfigControlsList" {
	export interface ConfigControlTemplateList {
		readonly Key: ConfigControlKeyDefinition;
	}
}

export type ConfigControlKeyDefinition = ConfigControlBaseDefinition & ConfigControlKeyDefinitionParts;
export type ConfigControlKeyDefinitionParts = ConfigControlBaseDefinitionParts & {
	readonly Control: KeyChooserControlDefinition;
	/** Back to the default. */
	readonly ResetControl: GuiButton;
	/** No key at all. */
	readonly RemoveControl: GuiButton;
};
export class ConfigControlKey extends ConfigControlBase<
	ConfigControlBaseDefinition,
	KeyCode | "Unknown",
	ConfigControlKeyDefinitionParts
> {
	constructor(
		gui: ConfigControlBaseDefinition & ConfigControlKeyDefinitionParts,
		name: string,
		defaultValue: KeyCode | "Unknown" = "Unknown",
	) {
		super(gui, name);

		const control = this.parent(new KeyChooserControl(this.parts.Control));

		this.initFromMultiWithDefault(control.value, () => "Unknown");
		this.event.subscribe(control.submitted, (value) => this.submit(this.multiMap(() => value)));

		this.parent(new Control(this.parts.ResetControl)) //
			.addButtonAction(() => this.submit(this.multiMap(() => defaultValue)));
		this.parent(new Control(this.parts.RemoveControl)) //
			.addButtonAction(() => this.submit(this.multiMap(() => "Unknown")));
	}
}

export class ConfigControlKeyOrString extends ConfigControlBase<
	ConfigControlBaseDefinition,
	KeyCode | string | "Unknown",
	ConfigControlKeyDefinitionParts
> {
	constructor(gui: ConfigControlBaseDefinition & ConfigControlKeyDefinitionParts, name: string) {
		super(gui, name);

		const control = this.parent(new KeyOrStringChooserControl(this.parts.Control));

		this.initFromMultiWithDefault(control.value, () => "Unknown");
		this.event.subscribe(control.submitted, (value) => this.submit(this.multiMap(() => value)));

		this.parent(new Control(this.parts.ResetControl)) //
			.addButtonAction(() => this.submit(this.multiMap(() => "Unknown")));
		this.parent(new Control(this.parts.RemoveControl)) //
			.addButtonAction(() => this.submit(this.multiMap(() => "Unknown")));
	}
}

/** A key plus its modifiers, e.g. Left Shift + O. Shares the Key template. */
export class ConfigControlKeyCombination extends ConfigControlBase<
	ConfigControlBaseDefinition,
	readonly KeyCode[],
	ConfigControlKeyDefinitionParts
> {
	constructor(
		gui: ConfigControlBaseDefinition & ConfigControlKeyDefinitionParts,
		name: string,
		defaultValue: readonly KeyCode[] = [],
	) {
		super(gui, name);

		const control = this.parent(new KeyCombinationChooserControl(this.parts.Control));

		this.initFromMultiWithDefault(control.value, () => []);
		this.event.subscribe(control.submitted, (value) => this.submit(this.multiMap(() => value)));

		this.parent(new Control(this.parts.ResetControl)) //
			.addButtonAction(() => this.submit(this.multiMap(() => defaultValue)));
		this.parent(new Control(this.parts.RemoveControl)) //
			.addButtonAction(() => this.submit(this.multiMap(() => [])));
	}
}
