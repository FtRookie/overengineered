import { FloatingWindow } from "client/gui/FloatingWindow";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { initDragging } from "engine/client/gui/Draggable";
import { Interface } from "engine/client/gui/Interface";
import { initResizing } from "engine/client/gui/Resizable";
import { Component } from "engine/shared/component/Component";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import type { FloatingWindowDefinition } from "client/gui/FloatingWindow";
import type { GraphGroup, GraphSessionStore } from "client/gui/graph/GraphSessionStore";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

const VISIBLE_ICON = "rbxassetid://13321848320";
const HIDDEN_ICON = "rbxassetid://125716871945612";

/** Width is fixed by the template; only the height is grabbable, and only from the bottom edge. */
const MIN_SIZE = new Vector2(0, 120);

type RowDefinition = GuiObject & {
	readonly Label: TextLabel;
	readonly Visibility: ImageButton;
	readonly Delete: GuiButton;
};
type GraphManagerDefinition = FloatingWindowDefinition & {
	readonly TextLabel: GuiObject;
	readonly Content: GuiObject & {
		readonly Frame: GuiObject & {
			readonly AddGroup: GuiButton;
			readonly GroupName: TextBox;
		};
		/** Scrolls on its own: AutomaticCanvasSize grows the canvas as rows are added, so nothing here sizes it. */
		readonly List: ScrollingFrame & {
			readonly Template: RowDefinition;
		};
	};
};

class GraphManagerRow extends Control<RowDefinition> {
	constructor(gui: RowDefinition, group: GraphGroup, remove: () => void) {
		super(gui);

		gui.Label.Text = group.name;

		this.event.subscribeObservable(
			group.visible,
			(visible) => (gui.Visibility.Image = visible ? VISIBLE_ICON : HIDDEN_ICON),
			true,
			true,
		);

		this.parent(new ButtonControl(gui.Visibility, () => group.visible.set(!group.visible.get())));
		// Deferred: removing the group destroys this row, and destroying a button inside its own click handler
		// unwinds the signal that is still firing it.
		this.parent(new ButtonControl(gui.Delete, () => task.defer(remove)));
	}
}

/** The always-available window listing every graph group, with the per-group show/hide and delete. */
export class GraphManagerWindow extends Component {
	constructor(store: GraphSessionStore, visible: ObservableValue<boolean>) {
		super();

		const template = Interface.getInterface<{
			Floating: { GraphManager: GraphManagerDefinition };
		}>().Floating.GraphManager;

		const gui = template.Clone();
		gui.Parent = template.Parent;

		const window = this.parent(FloatingWindow.create(gui));
		this.event.subscribeObservable(visible, (v) => window.setVisibleAndEnabled(v), true);

		initDragging(this.event, gui.TextLabel, gui);
		// Bottom only: the title bar owns the top, and the width is whatever the rows need.
		initResizing(this.event, gui, { min: MIN_SIZE, edges: { left: false, right: false, top: false } });

		const rowTemplate = this.asTemplate(gui.Content.List.Template);
		const rows = this.parent(new ComponentChildren<GraphManagerRow>().withParentInstance(gui.Content.List));

		const nameBox = gui.Content.Frame.GroupName;
		this.parent(
			new ButtonControl(gui.Content.Frame.AddGroup, () => {
				const typed = nameBox.Text.trim();
				store.addGroup(typed !== "" ? typed : `Graph ${store.groups.get().size() + 1}`);
				nameBox.Text = "";
			}),
		);

		// The list is short and only changes on an explicit add or delete, so a full rebuild is cheaper to reason
		// about than diffing, and costs nothing between edits.
		this.event.subscribeCollection(
			store.groups,
			() => {
				rows.clear();
				for (const group of store.groups.get()) {
					rows.add(new GraphManagerRow(rowTemplate(), group, () => store.removeGroup(group)));
				}
			},
			true,
			true,
		);
	}
}
