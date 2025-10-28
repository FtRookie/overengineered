import { GuiService } from "@rbxts/services";
import { TextButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { TextBoxControl } from "engine/client/gui/TextBoxControl";
import { Signal } from "engine/shared/event/Signal";
import type { ButtonDefinition, TextButtonDefinition } from "engine/client/gui/Button";

type SelectButtonPopupDefinition = GuiObject & {
	readonly Content: {
		readonly Buttons: {
			readonly CancelButton: GuiButton;
		};
		readonly List: GuiObject & {
			readonly ScrollingFrame: ScrollingFrame & {
				readonly ButtonTemplate: TextButtonDefinition;
			};
			readonly AcceptButton: GuiButton;
			readonly CustomTextBox: TextBox;
		};
	};
	readonly Heading: {
		readonly CloseButton: ButtonDefinition;
	};
};

class _SelectButtonPopup<TAllowCustomString extends boolean> extends Control<SelectButtonPopupDefinition> {
	private readonly buttonPressed = new Signal<(key: KeyCode) => void>();
	private readonly cancelButton;
	private readonly closeButton;

	constructor(
		allowCustomString: TAllowCustomString,
		confirmFunc: (key: TAllowCustomString extends true ? string : KeyCode) => void,
		cancelFunc: () => void,
	) {
		const gui = Interface.getInterface<{
			Popups: { MobileButtonSelection: SelectButtonPopupDefinition };
		}>().Popups.MobileButtonSelection.Clone();
		super(gui);

		this.cancelButton = this.parent(new Control(gui.Content.Buttons.CancelButton));
		this.closeButton = this.parent(new Control(gui.Heading.CloseButton));

		const customTextBox = this.parent(new TextBoxControl(gui.Content.List.CustomTextBox));
		const acceptButton = this.parent(new Control(gui.Content.List.AcceptButton));
		if (allowCustomString) {
			acceptButton.addButtonAction(() => {
				this.hide();
				confirmFunc(customTextBox.text.get() as KeyCode);
			});
		} else {
			customTextBox.instance.Interactable = false;
			acceptButton.setButtonInteractable(false);
		}

		const list = new Control(gui.Content.List.ScrollingFrame);
		this.parent(list);

		const template = this.asTemplate(gui.Content.List.ScrollingFrame.ButtonTemplate);

		const keys = Enum.KeyCode.GetEnumItems().filter((value) => {
			// numbers
			if (value.Value >= 48 && value.Value <= 57) return true;

			// a-z
			if (value.Value >= 97 && value.Value <= 122) return true;

			// gamepad
			if (value.Value >= 1000 && value.Value <= 1017) return true;

			return false;
		});

		const keyToName = (key: KeyCode) => {
			if (key === "Zero") return "0";
			if (key === "One") return "1";
			if (key === "Two") return "2";
			if (key === "Three") return "3";
			if (key === "Four") return "4";
			if (key === "Five") return "5";
			if (key === "Six") return "6";
			if (key === "Seven") return "7";
			if (key === "Eight") return "8";
			if (key === "Nine") return "9";

			if (key.find("^Button")[0] !== undefined) {
				return key.sub("Button".size());
			}

			return key;
		};

		for (const key of keys) {
			const btn = new TextButtonControl(template());
			btn.text.set(keyToName(key.Name));
			list.add(btn);

			this.event.subscribe(btn.activated, () => this.buttonPressed.Fire(key.Name));
		}

		this.event.subscribe(this.buttonPressed, (key) => {
			this.hide();
			confirmFunc(key);
		});
		this.cancelButton.addButtonAction(() => {
			this.hide();
			cancelFunc();
		});
		this.closeButton.addButtonAction(() => {
			this.hide();
			cancelFunc();
		});

		this.event.onPrepareGamepad(() => (GuiService.SelectedObject = this.cancelButton.instance));
	}
}

export class SelectButtonPopup extends _SelectButtonPopup<false> {
	constructor(confirmFunc: (key: KeyCode) => void, cancelFunc: () => void) {
		super(false, confirmFunc, cancelFunc);
	}
}
export class SelectButtonPopupWithCustomString extends _SelectButtonPopup<true> {
	constructor(confirmFunc: (key: KeyCode | string) => void, cancelFunc: () => void) {
		super(true, confirmFunc, cancelFunc);
	}
}
