import { GuiService, Players } from "@rbxts/services";
import { Signals } from "client/Signals";
import { Interface } from "engine/client/gui/Interface";
import { Component } from "engine/shared/component/Component";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { PlayerUtils } from "engine/shared/utils/PlayerUtils";
import { SharedPlot } from "shared/building/SharedPlot";

export class HoveredPartHighlighter<T extends Instance> extends Component {
	readonly highlightedPart = new ObservableValue<T | undefined>(undefined);

	constructor(map?: (part: BasePart) => T | undefined) {
		super();

		const mouse = Players.LocalPlayer.GetMouse();
		let selectionBox: (SelectionBox & { Parent: T }) | undefined;

		const destroyHighlight = () => {
			selectionBox?.Destroy();
			selectionBox = undefined;

			this.highlightedPart.set(undefined);
		};

		const updatePosition = () => {
			// ignore if ESC menu is open
			if (GuiService.MenuIsOpen) {
				return;
			}

			// ignore if not alive
			if (!PlayerUtils.isAlive(Players.LocalPlayer)) {
				return;
			}

			// ignore if over a GUI element
			if (Interface.isCursorOnVisibleGui()) {
				destroyHighlight();
				return;
			}

			let target: Instance | undefined = mouse.Target;

			// if the same target
			if (target === selectionBox?.Parent) {
				return;
			}

			destroyHighlight();

			if (target) {
				target = map?.(target as BasePart);
			}

			if (!target) return;

			destroyHighlight();

			selectionBox = new Instance("SelectionBox") as typeof selectionBox & defined;
			selectionBox.Parent = target as T;
			selectionBox.Adornee = target;
			selectionBox.SurfaceTransparency = 0.95;
			selectionBox.LineThickness = 0.1;
			selectionBox.Color3 = new Color3(1, 1, 1);
			selectionBox.SurfaceColor3 = new Color3(1, 1, 1);
			selectionBox.Transparency = 0;

			this.highlightedPart.set(selectionBox.Parent);
		};

		this.event.onPrepare((inputType, eventHandler, inputHandler) => {
			eventHandler.subscribe(SharedPlot.anyChanged, updatePosition);

			if (inputType === "Desktop") {
				eventHandler.subscribe(mouse.Move, updatePosition);
				eventHandler.subscribe(Signals.CAMERA.MOVED, updatePosition);
			} else if (inputType === "Gamepad") {
				eventHandler.subscribe(Signals.CAMERA.MOVED, updatePosition);
			} else if (inputType === "Touch") {
				inputHandler.onTouchTap(updatePosition);
			}

			updatePosition();
		});
		this.onDisable(destroyHighlight);
	}
}
