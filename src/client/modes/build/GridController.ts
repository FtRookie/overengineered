import { FloatingWindow } from "client/gui/FloatingWindow";
import { GridEditorControl } from "client/gui/GridEditor";
import { ButtonControl } from "engine/client/gui/Button";
import { Interface } from "engine/client/gui/Interface";
import { Component } from "engine/shared/component/Component";
import type { FloatingWindowDefinition } from "client/gui/FloatingWindow";
import type { GridEditorControlDefinition } from "client/gui/GridEditor";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { WindowPositionController } from "client/gui/WindowPositions";
import type { EditMode } from "client/modes/build/BuildingMode";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

@injectable
export class GridController extends Component {
	constructor(
		moveGrid: ObservableValue<number>,
		rotateGrid: ObservableValue<number>,
		triangleThickness: ObservableValue<number>,
		editMode: ObservableValue<EditMode>,
		@inject mainScreen: MainScreenLayout,
		@inject windowPositions: WindowPositionController,
	) {
		super();

		const gridButton = this.parentGui(mainScreen.registerTopRightButton("Grid"));
		this.parent(
			new ButtonControl(gridButton.instance, () =>
				floatingScreen.setVisibleAndEnabled(!floatingScreen.isInstanceVisible()),
			),
		);

		const fg = Interface.getInterface<{
			Floating: {
				Grid: FloatingWindowDefinition & { TextLabel: GuiObject; Content: GridEditorControlDefinition };
			};
		}>().Floating.Grid;
		const floatingGui = fg.Clone();
		floatingGui.Parent = fg.Parent;

		const floatingScreen = this.parent(FloatingWindow.create(floatingGui));
		floatingScreen.add(
			new GridEditorControl(floatingGui.Content, moveGrid, rotateGrid, triangleThickness, editMode),
		);
		// Width only until the template drops AutomaticSize.Y, which refuses a vertical grab.
		windowPositions.attach(this.event, floatingGui.TextLabel, floatingGui, "Grid", { min: new Vector2(150, 0) });
	}
}
