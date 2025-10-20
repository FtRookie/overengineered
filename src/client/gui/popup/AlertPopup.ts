import { GuiService } from "@rbxts/services";
import { SoundController } from "client/controller/SoundController";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import type { ButtonDefinition } from "engine/client/gui/Button";

type AlertPopupDefinition = GuiObject & {
	readonly Content: Frame & {
		readonly Text: TextLabel;
		readonly Buttons: {
			readonly OkButton: TextButton;
		};
	};
	readonly Heading: {
		readonly CloseButton: ButtonDefinition;
	};
};

export class AlertPopup extends Control<AlertPopupDefinition> {
	private readonly okButton;

	constructor(text: string, okFunc?: () => void, delayBeforeInteractable = 3) {
		const gui = Interface.getInterface<{
			Popups: { Crossplatform: { Alert: AlertPopupDefinition } };
		}>().Popups.Crossplatform.Alert.Clone();
		super(gui);

		this.okButton = this.parent(new Control(gui.Content.Buttons.OkButton));

		SoundController.getUISounds().Warning.Play();

		gui.Content.Text.Text = text;

		this.okButton.addButtonAction(() => {
			okFunc?.();
			this.hide();
		});

		const closeButton = this.parent(new Control(gui.Heading.CloseButton).addButtonAction(() => this.hide()));

		this.okButton.setButtonInteractable(false);
		closeButton.setButtonInteractable(false);
		task.delay(delayBeforeInteractable, () => {
			this.okButton.setButtonInteractable(true);
			closeButton.setButtonInteractable(true);
		});

		this.event.onPrepareGamepad(() => (GuiService.SelectedObject = this.okButton.instance));
	}
}
