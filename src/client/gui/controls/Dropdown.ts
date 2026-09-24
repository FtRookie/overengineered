import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Transforms } from "engine/shared/component/Transforms";
import { TransformService } from "engine/shared/component/TransformService";
import { ObservableValue } from "engine/shared/event/ObservableValue";

export type DropdownDefinition = GuiObject & {
	readonly Header: GuiButton & {
		readonly Arrow?: GuiObject;
	};
	readonly Content: GuiObject;
};
export class Dropdown<T extends DropdownDefinition = DropdownDefinition> extends Control<T> {
	readonly isOpen;
	readonly contents;

	constructor(gui: T, defaultVisibility = false) {
		super(gui);

		this.contents = this.add(new Control(gui.Content));
		this.isOpen = new ObservableValue(defaultVisibility);

		const initVisibilityAnimation = (button: ButtonControl, gui: DropdownDefinition) => {
			const materialVisibleTransform = Transforms.multiStateMachine(
				Transforms.boolStateMachine(
					gui,
					Transforms.commonProps.quadOut02,
					{ Size: gui.Size },
					{ Size: new UDim2(gui.Size.X, new UDim(0, 40)) },
				),
				Transforms.boolStateMachine(
					gui.Header.FindFirstChild("Arrow") ? gui.Header.Arrow! : new Instance("ImageLabel"),
					Transforms.commonProps.quadOut02,
					{ Rotation: 180 },
					{ Rotation: 0 },
				),
			);

			{
				materialVisibleTransform(false);
				TransformService.finish(gui);

				if (gui.Header.FindFirstChild("Arrow")) {
					TransformService.finish(gui.Header.Arrow!);
				}
			}

			let wasvisible = defaultVisibility;
			this.event.subscribe(button.activated, () => {
				this.isOpen.toggle();
				materialVisibleTransform(this.isOpen.get());
			});

			this.onDisable(() => {
				wasvisible = this.isOpen.get();
				this.isOpen.set(false);
				materialVisibleTransform(false);
			});
			this.onEnable(() => {
				if (!wasvisible) return;

				this.isOpen.set(true);
				materialVisibleTransform(true);
			});
		};

		const button = this.add(new ButtonControl(this.gui.Header));
		initVisibilityAnimation(button, gui);
	}
}
