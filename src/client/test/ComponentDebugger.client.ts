import { Players, RunService, UserInputService } from "@rbxts/services";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { InputController } from "engine/client/InputController";
import { Component } from "engine/shared/component/Component";
import { Element } from "engine/shared/Element";
import { PlayerRank } from "engine/shared/PlayerRank";
import { Colors } from "shared/Colors";
import type { DebuggableComponent } from "engine/shared/component/Component";

type TreeControlDefinition = GuiObject & {
	readonly Main: GuiButton;
	readonly Children: Frame;
};
class TreeControl extends Control<TreeControlDefinition> {
	static createChildList(main: GuiButton): TreeControl {
		const createElement = Element.create;
		const gui = createElement(
			"Frame",
			{
				Size: new UDim2(1, 0, 0, 0),
				AutomaticSize: Enum.AutomaticSize.Y,
				BackgroundColor3: Colors.black,
				BackgroundTransparency: 0.9,
			},
			{
				list: createElement("UIListLayout", { SortOrder: Enum.SortOrder.LayoutOrder }),
				Main: main,
				Children: createElement(
					"Frame",
					{
						Size: new UDim2(1, 0, 0, 0),
						AutomaticSize: Enum.AutomaticSize.Y,
						BackgroundColor3: Colors.black,
						BackgroundTransparency: 1,
						LayoutOrder: 99,
					},
					{
						list: createElement("UIListLayout", { SortOrder: Enum.SortOrder.LayoutOrder }),
						padding: createElement("UIPadding", { PaddingLeft: new UDim(0, 20) }),
					},
				),
			},
		);

		return new TreeControl(gui);
	}

	private readonly main: Control<GuiButton>;
	readonly childContainer: Control;

	constructor(gui: TreeControlDefinition) {
		super(gui);
		this.main = this.add(new Control(gui.Main));
		this.childContainer = this.add(new Control(this.gui.Children));

		this.main.instance.BackgroundColor3 = Colors.accent;

		this.main.parent(
			new Control(this.main.instance).addButtonAction(() => {
				if (this.childContainer.isInstanceVisible()) {
					this.main.instance.BackgroundColor3 = Colors.accentDark;
					this.childContainer.hide();
				} else {
					this.main.instance.BackgroundColor3 = Colors.accent;
					this.childContainer.show();
				}
			}),
		);
	}
}

const create = (): TreeControl => {
	const createElement = Element.create;
	const root = createElement(
		"ScrollingFrame",
		{
			Name: "DebugROOT",
			AutoLocalize: false,
			Size: new UDim2(1, 0, 1, 0),
			BackgroundColor3: Colors.black,
			BackgroundTransparency: 1,
			ScrollingDirection: Enum.ScrollingDirection.Y,
			AutomaticCanvasSize: Enum.AutomaticSize.Y,
			Parent: createElement("ScreenGui", {
				Name: "DebugSCREEN",
				Parent: Interface.getPlayerGui(),
			}),
		},
		{
			list: createElement("UIListLayout", { SortOrder: Enum.SortOrder.LayoutOrder }),
			Main: createElement("TextButton", {
				Text: "TREE",
				AutomaticSize: Enum.AutomaticSize.XY,
				LayoutOrder: 0,
			}),
			Children: createElement(
				"Frame",
				{
					Size: new UDim2(1, 0, 0, 0),
					AutomaticSize: Enum.AutomaticSize.Y,
					BackgroundColor3: Colors.black,
					BackgroundTransparency: 1,
					LayoutOrder: 1,
				},
				{
					list: createElement("UIListLayout", { SortOrder: Enum.SortOrder.LayoutOrder }),
					padding: createElement("UIPadding", { PaddingLeft: new UDim(0, 20) }),
				},
			),
		},
	);

	return new TreeControl(root);
};

let tree: TreeControl | undefined;
const update = (root: DebuggableComponent) => {
	if (!tree) throw "what";

	const add = (component: object | DebuggableComponent, tree: TreeControl) => {
		const childtree = tree.childContainer.add(
			TreeControl.createChildList(
				Element.create("TextButton", {
					AutomaticSize: Enum.AutomaticSize.XY,
					Text: tostring(getmetatable(component)),
					TextColor3: Colors.white,
					Font: Enum.Font.Ubuntu,
					TextSize: 16,
				}),
			),
		);

		if ("getDebugChildren" in component) {
			for (const child of component.getDebugChildren()) {
				add(child, childtree);
			}
		}
	};

	add(root, tree);
};
const toggle = (root: DebuggableComponent) => {
	if (!tree) {
		tree = create();
		update(root);
		tree.show();
		return;
	} else {
		tree.destroy();
		tree = undefined;
	}
};

const launch = RunService.IsStudio() || PlayerRank.isAdmin(Players.LocalPlayer);
if (!launch) new Instance("BindableEvent").Event.Wait();
task.wait(0.5); // wait for the controls to enable

UserInputService.InputBegan.Connect((input) => {
	if (input.UserInputType !== Enum.UserInputType.Keyboard) return;
	if (input.KeyCode !== Enum.KeyCode.F6) return;
	if (!InputController.isShiftPressed()) return;

	toggle(new Component()); // TODO:
});
