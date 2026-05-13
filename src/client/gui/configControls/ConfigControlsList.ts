import { ConfigControlButton } from "client/gui/configControls/ConfigControlButton";
import { ConfigControlColor } from "client/gui/configControls/ConfigControlColor";
import { ConfigControlDivider } from "client/gui/configControls/ConfigControlDivider";
import { ConfigControlKey } from "client/gui/configControls/ConfigControlKey";
import { ConfigControlMaterial } from "client/gui/configControls/ConfigControlMaterial";
import { ConfigControlNumber } from "client/gui/configControls/ConfigControlNumber";
import { ConfigControlSlider } from "client/gui/configControls/ConfigControlSlider";
import { ConfigControlString } from "client/gui/configControls/ConfigControlString";
import { ConfigControlSwitch } from "client/gui/configControls/ConfigControlSwitch";
import { ConfigControlToggle } from "client/gui/configControls/ConfigControlToggle";
import { ConfigControlVector3 } from "client/gui/configControls/ConfigControlVector3";
import { Control } from "engine/client/gui/Control";
import type { Component } from "engine/shared/component/Component";

export interface ConfigControlTemplateList {}
export type ConfigControlListDefinition = ScrollingFrame;

const clone = <T extends GuiObject>(instance: T): T => {
	const clone = instance.Clone();
	clone.Visible = true;
	clone.Parent = instance.Parent;

	return clone;
};
type ArgsOfSkip1<T extends ConstructorOf<Component>> =
	T extends ConstructorOf<unknown, infer Args extends unknown[]>
		? Args extends [unknown, ...infer Rest extends unknown[]]
			? Rest
			: []
		: never;

export class ConfigControlList extends Control<ScrollingFrame & ConfigControlTemplateList> {
	protected clone<T extends GuiObject>(instance: T): T {
		return clone(instance);
	}

	protected addCategory(...args: ArgsOfSkip1<typeof ConfigControlDivider>) {
		return this.parent(new ConfigControlDivider(clone(this.gui.Divider), ...args));
	}
	protected addNumber(...args: ArgsOfSkip1<typeof ConfigControlNumber>) {
		return this.parent(new ConfigControlNumber(clone(this.gui.Number), ...args));
	}
	protected addString(...args: ArgsOfSkip1<typeof ConfigControlString>) {
		return this.parent(new ConfigControlString(clone(this.gui.String), ...args));
	}
	protected addSlider(...args: ArgsOfSkip1<typeof ConfigControlSlider>) {
		return this.parent(new ConfigControlSlider(clone(this.gui.Slider), ...args));
	}
	protected addToggle(...args: ArgsOfSkip1<typeof ConfigControlToggle>) {
		return this.parent(new ConfigControlToggle(clone(this.gui.Toggle), ...args));
	}
	protected addKey(...args: ArgsOfSkip1<typeof ConfigControlKey>) {
		return this.parent(new ConfigControlKey(clone(this.gui.Key), ...args));
	}
	protected addSwitch<T extends string>(...args: ArgsOfSkip1<typeof ConfigControlSwitch<T>>) {
		return this.parent(new ConfigControlSwitch(clone(this.gui.Switch), ...args));
	}
	protected addColor(...args: ArgsOfSkip1<typeof ConfigControlColor>) {
		return this.parent(new ConfigControlColor(clone(this.gui.Color), ...args));
	}
	protected addVector3(...args: ArgsOfSkip1<typeof ConfigControlVector3>) {
		return this.parent(new ConfigControlVector3(clone(this.gui.Vector3), ...args));
	}
	protected addMaterial(...args: ArgsOfSkip1<typeof ConfigControlMaterial>) {
		return this.parent(new ConfigControlMaterial(clone(this.gui.Material), ...args));
	}
	protected addButton(...args: ArgsOfSkip1<typeof ConfigControlButton>) {
		return this.parent(new ConfigControlButton(clone(this.gui.Button), ...args));
	}
}
