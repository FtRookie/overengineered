import { ConfigControlBase } from "client/gui/configControls/ConfigControlBase";
import { NumberTextBoxControlNullable } from "client/gui/controls/NumberTextBoxControl";
import { Objects } from "engine/shared/fixes/Objects";
import type { ConfigControlBaseDefinition } from "client/gui/configControls/ConfigControlBase";
import type { NumberTextBoxControlDefinition } from "client/gui/controls/NumberTextBoxControl";

declare module "client/gui/configControls/ConfigControlsList" {
	export interface ConfigControlTemplateList {
		readonly Vector3: ConfigControlVector3Definition;
	}
}

export type ConfigControlVector3Definition = ConfigControlBaseDefinition & {
	readonly Buttons: GuiObject & {
		readonly X: NumberTextBoxControlDefinition;
		readonly Y: NumberTextBoxControlDefinition;
		readonly Z: NumberTextBoxControlDefinition;
	};
};
export class ConfigControlVector3 extends ConfigControlBase<ConfigControlVector3Definition, Vector3> {
	constructor(gui: ConfigControlVector3Definition, name: string) {
		super(gui, name);

		const x = this.parent(new NumberTextBoxControlNullable(gui.Buttons.X));
		const y = this.parent(new NumberTextBoxControlNullable(gui.Buttons.Y));
		const z = this.parent(new NumberTextBoxControlNullable(gui.Buttons.Z));

		this.valueChanged(() => {
			x.value.set(this.multiOf(this.multiMap((k, v) => v.X)));
			y.value.set(this.multiOf(this.multiMap((k, v) => v.Y)));
			z.value.set(this.multiOf(this.multiMap((k, v) => v.Z)));
		});

		this.valueChanged((values) => {
			const relative = Objects.size(values) > 1;
			x.relative = relative;
			y.relative = relative;
			z.relative = relative;
		});

		this.event.subscribe(x.submitted, (x, apply) =>
			this.submit(this.multiMap((k, v) => v.with(apply ? apply(v.X) : x, undefined, undefined))),
		);
		this.event.subscribe(y.submitted, (y, apply) =>
			this.submit(this.multiMap((k, v) => v.with(undefined, apply ? apply(v.Y) : y, undefined))),
		);
		this.event.subscribe(z.submitted, (z, apply) =>
			this.submit(this.multiMap((k, v) => v.with(undefined, undefined, apply ? apply(v.Z) : z))),
		);
	}
}
