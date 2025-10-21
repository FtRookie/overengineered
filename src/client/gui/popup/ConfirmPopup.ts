import { GuiService } from "@rbxts/services";
import { SoundController } from "client/controller/SoundController";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { PartialControl } from "engine/client/gui/PartialControl";

const template = Interface.getInterface<{
	Popups: { Crossplatform: { Confirmation: GuiObject } };
}>().Popups.Crossplatform.Confirmation;
template.Visible = false;

type ConfirmPopupParts = {
	readonly CloseButton: GuiButton;

	readonly TextLabel1: TextLabel;
	readonly TextLabel2: TextLabel;

	readonly AcceptButton: GuiButton;
	readonly CancelButton: GuiButton;
};
export class ConfirmPopup extends PartialControl<ConfirmPopupParts> {
	private readonly confirmButton;
	private readonly cancelButton;
	private readonly closeButton;

	constructor(text: string, ps: string = "", okFunc?: () => void, noFunc?: () => void) {
		const gui = template.Clone();
		super(gui);

		this.confirmButton = this.parent(new Control(this.parts.AcceptButton));
		this.cancelButton = this.parent(new Control(this.parts.CancelButton));
		this.closeButton = this.parent(new Control(this.parts.CloseButton));

		SoundController.getUISounds().Warning.Play();

		this.parts.TextLabel1.Text = text;
		this.parts.TextLabel2.Text = ps;
		this.confirmButton.addButtonAction(() => {
			okFunc?.();
			this.hide();
		});
		this.cancelButton.addButtonAction(() => {
			noFunc?.();
			this.hide();
		});
		this.closeButton.addButtonAction(() => {
			noFunc?.();
			this.hide();
		});

		this.event.onPrepareGamepad(() => (GuiService.SelectedObject = this.cancelButton.instance));
	}
}
