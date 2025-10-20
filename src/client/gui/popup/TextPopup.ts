import { GuiService } from "@rbxts/services";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";

type TextPopupDefinition = GuiObject & {
	readonly Heading: Frame & {
		readonly CloseButton: TextButton;
		readonly TitleLabel: TextLabel;
	};
	readonly Content: {
		readonly Buttons: {
			readonly DoneButton: TextButton;
		};
		readonly Frame: {
			readonly ScrollingFrame: ScrollingFrame & {
				readonly TextBox: TextBox;
			};
		};
	};
};

export class TextPopup extends Control<TextPopupDefinition> {
	private readonly doneButton;
	private readonly closeButton;

	constructor(text: string, ps: string = "", okFunc: (text: string) => void, noFunc: () => void) {
		const gui = Interface.getInterface<{ Popups: { TextInput: TextPopupDefinition } }>().Popups.TextInput.Clone();
		super(gui);

		this.doneButton = this.parent(new ButtonControl(gui.Content.Buttons.DoneButton));
		this.closeButton = this.parent(new ButtonControl(gui.Heading.CloseButton));

		gui.Heading.TitleLabel.Text = text;
		gui.Content.Frame.ScrollingFrame.TextBox.PlaceholderText = ps;
		this.event.subscribe(this.doneButton.activated, () => {
			okFunc(gui.Content.Frame.ScrollingFrame.TextBox.Text);
			this.hide();
		});
		this.event.subscribe(this.closeButton.activated, () => {
			noFunc();
			this.hide();
		});

		this.event.onPrepareGamepad(() => (GuiService.SelectedObject = gui.Content.Frame.ScrollingFrame.TextBox));
	}
}
