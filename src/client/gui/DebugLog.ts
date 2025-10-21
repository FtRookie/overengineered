import { RunService } from "@rbxts/services";
import { LabelControl } from "client/gui/controls/LabelControl";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { ComponentKeyedChildren } from "engine/shared/component/ComponentKeyedChildren";
import { Element } from "engine/shared/Element";
import { Strings } from "engine/shared/fixes/String.propmacro";

class CategoryControl extends Control {
	readonly unnamed;
	readonly named;
	readonly categories;
	tempDisabled = false;

	constructor(gui: GuiObject) {
		super(gui);

		this.unnamed = this.parent(new ComponentChildren<LabelControl>().withParentInstance(gui));
		this.named = this.parent(new ComponentKeyedChildren<defined, LabelControl>().withParentInstance(gui));
		this.categories = this.parent(new ComponentKeyedChildren<defined, CategoryControl>().withParentInstance(gui));
	}
}

const gui = Element.create(
	"Frame",
	{
		Name: "DebugLog",
		BackgroundTransparency: 1,
		Position: new UDim2(0, 0, 0, 40),
		Size: new UDim2(1, 0, 0.5, 0),
		Parent: Interface.getInterface(),
	},
	{
		list: Element.create("UIListLayout", {
			Padding: new UDim(0, 4),
			SortOrder: Enum.SortOrder.LayoutOrder,
			HorizontalAlignment: Enum.HorizontalAlignment.Right,
		}),
	},
);
const mainControl = new CategoryControl(gui);
mainControl.setVisibleAndEnabled(RunService.IsStudio());

const disabled = !mainControl.isEnabled();
const disabledCategoryObject = {};

const categoryStack: defined[] = [];

export namespace DebugLog {
	function newText(text?: unknown) {
		return new LabelControl(
			Element.create("TextLabel", {
				AutoLocalize: false,
				Font: Enum.Font.Ubuntu,
				TextSize: 32,
				AutomaticSize: Enum.AutomaticSize.XY,
				BackgroundTransparency: 0.5,
				Text: tostring(text ?? ""),
			}),
		);
	}
	function newCategoryControl(name: defined) {
		const gui = Element.create(
			"Frame",
			{
				BackgroundTransparency: 1,
				AutomaticSize: Enum.AutomaticSize.XY,
			},
			{
				list: Element.create("UIListLayout", {
					Padding: new UDim(0, 4),
					FillDirection: Enum.FillDirection.Vertical,
					SortOrder: Enum.SortOrder.LayoutOrder,
					HorizontalAlignment: Enum.HorizontalAlignment.Right,
				}),
				padding: Element.create("UIPadding", { PaddingLeft: new UDim(0, 8) }),
				title: newText(`[[[${name}]]]`).instance,
			},
		);

		return new CategoryControl(gui);
	}

	export function category(name: defined, props: object & Record<string, unknown>, disabled = false) {
		if (disabled) return;

		startCategory(name, disabled);
		multiNamed(props);
		endCategory();
	}

	export function startCategory(name: defined, disable = false) {
		if (disabled) return;

		if (disable) {
			categoryStack.push(disabledCategoryObject);
		} else {
			categoryStack.push(name);
		}
	}
	export function endCategory() {
		if (disabled) return;
		categoryStack.pop();
	}

	function getCurrentParent(): CategoryControl | undefined {
		if (categoryStack.size() === 0) {
			return mainControl;
		}

		let c = mainControl;
		for (const cat of categoryStack) {
			if (cat === disabledCategoryObject) {
				return undefined;
			}

			let nextcat = c.categories.get(cat);
			if (!nextcat) {
				nextcat = newCategoryControl(cat);
				c.categories.add(cat, nextcat);
			}

			c = nextcat;
		}

		return c;
	}

	export function multiNamed(props: object & Record<string, unknown>) {
		if (disabled) return;

		for (const [name, value] of pairs(props)) {
			named(name, value);
		}
	}
	export function named(name: defined, text: defined) {
		if (disabled) return;

		const category = getCurrentParent();
		if (!category) return;

		let control = category.named.get(name);
		if (!control) {
			control = newText();
			category.named.add(name, control);
		}

		control.instance.Text = `${Strings.pretty(text)} [${name}]`;
	}
	export function log(text: string) {
		if (disabled) return;

		const category = getCurrentParent();
		if (!category) return;

		const control = newText();
		control.value.set(text);
		category.unnamed.add(control);

		task.delay(1, () => control.destroy());
	}
}
