import { TextButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { Instances } from "engine/shared/fixes/Instances";
import { Colors } from "shared/Colors";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

type IDEPopupDefinition = GuiObject & {
	readonly Heading: Frame & {
		readonly CloseButton: TextButton;
		readonly TitleLabel: TextLabel;
	};
	readonly Content: Frame & {
		LimitReached: TextLabel;
		Buttons: {
			SaveButton: TextButton;
			CancelButton: TextButton;
		};
		Content: Frame & {
			Code: ScrollingFrame & {
				TextBox: TextBox;
			};
			Rows: ScrollingFrame & {
				TextLabel: TextLabel;
			};
		};
	};
};

export class IDEPopup extends Control<IDEPopupDefinition> {
	private saveButton: TextButtonControl = undefined!;

	constructor(
		private readonly lengthLimit: number,
		code: string,
		callback: (data: string) => void,
	) {
		const gui = Interface.getInterface<{
			Popups: { Crossplatform: { IDE: IDEPopupDefinition } };
		}>().Popups.Crossplatform.IDE.Clone();
		super(gui);

		this.$onInjectAuto((dataStorage: PlayerDataStorage) => {
			if (!dataStorage.config.get().syntaxHighlight) {
				const tb = Instances.findChild<TextBox>(gui, "Content", "Content", "Code", "TextBox");
				if (!tb) return;

				tb.FindFirstChild("SyntaxHighlighting")?.Destroy();
				tb.FindFirstChild("SyntaxHighlights")?.Destroy();
				tb.TextColor3 = Colors.white;
				tb.TextTransparency = 0;
			}
		});

		gui.Content.Content.Code.TextBox.Text = code;
		this.saveButton = new TextButtonControl(gui.Content.Buttons.SaveButton);

		this.event.subscribe(gui.Content.Content.Code.TextBox.GetPropertyChangedSignal("Text"), () => {
			this.updateHighlight();
		});

		this.parent(new Control(gui.Heading.CloseButton).addButtonAction(() => this.hideThenDestroy()));
		this.parent(new Control(gui.Content.Buttons.CancelButton).addButtonAction(() => this.hideThenDestroy()));
		this.parent(
			this.saveButton.addButtonAction(() => {
				callback(gui.Content.Content.Code.TextBox.Text);

				this.hideThenDestroy();
			}),
		);

		this.event.subscribe(this.gui.Content.Content.Code.GetPropertyChangedSignal("CanvasPosition"), () => {
			this.gui.Content.Content.Rows.CanvasPosition = this.gui.Content.Content.Code.CanvasPosition;
		});

		this.updateHighlight();
	}

	updateHighlight() {
		if (this.gui.Content.Content.Code.TextBox.Text.size() > this.lengthLimit) {
			this.gui.Content.LimitReached.Visible = true;
			this.gui.Content.LimitReached.Text = `⚠️ Limit of ${this.lengthLimit} characters reached. (${this.gui.Content.Content.Code.TextBox.Text.size()})`;
			this.saveButton.buttonInteractabilityComponent().setInteractable(false);
		} else {
			this.gui.Content.LimitReached.Visible = false;
			this.saveButton.buttonInteractabilityComponent().setInteractable(true);
		}

		// Update rows
		let str = "";
		for (let index = 1; index < this.gui.Content.Content.Code.TextBox.Text.split("\n").size() + 1; index++) {
			str += `${index}\n`;
		}
		this.gui.Content.Content.Rows.TextLabel.Text = str;
	}
}
