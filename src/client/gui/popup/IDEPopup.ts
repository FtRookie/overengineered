import { CodeEditor } from "client/gui/popup/ide/CodeEditor";
import { checkLuaSyntax } from "client/gui/popup/ide/LuaSyntaxCheck";
import { TextButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { Colors } from "shared/Colors";

const syntaxCheckDebounce = 1; // seconds after last change
const meterColor = Color3.fromRGB(139, 148, 158);

type IDEPopupDefinition = GuiObject & {
	readonly Heading: Frame & {
		readonly CloseButton: TextButton;
		readonly Frame: Frame & {
			readonly TitleLabel: TextLabel;
			readonly SizeLabel: TextLabel;
		};
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
	private readonly tb: TextBox;
	private syntaxError?: string;
	private syntaxToken = 0;
	private lastCheckedCode?: string;
	private lastLineCount = -1;

	constructor(
		private readonly lengthLimit: number,
		code: string,
		callback: (data: string) => void,
	) {
		const gui = Interface.getInterface<{
			Popups: { Crossplatform: { IDE: IDEPopupDefinition } };
		}>().Popups.Crossplatform.IDE.Clone();
		super(gui);

		this.tb = gui.Content.Content.Code.TextBox;
		this.parent(new CodeEditor(this.tb, code));
		this.saveButton = new TextButtonControl(gui.Content.Buttons.SaveButton);

		this.event.subscribe(this.tb.GetPropertyChangedSignal("Text"), () => {
			this.updateDisplay();
			this.scheduleSyntaxCheck();
		});

		this.parent(new Control(gui.Heading.CloseButton).addButtonAction(() => this.hideThenDestroy()));
		this.parent(new Control(gui.Content.Buttons.CancelButton).addButtonAction(() => this.hideThenDestroy()));
		this.parent(
			this.saveButton.addButtonAction(() => {
				callback(this.tb.Text);
				this.hideThenDestroy();
			}),
		);

		this.event.subscribe(this.gui.Content.Content.Code.GetPropertyChangedSignal("CanvasPosition"), () => {
			this.gui.Content.Content.Rows.CanvasPosition = this.gui.Content.Content.Code.CanvasPosition;
		});

		this.updateDisplay();
		this.scheduleSyntaxCheck();
	}

	private scheduleSyntaxCheck() {
		const token = ++this.syntaxToken;
		task.delay(syntaxCheckDebounce, () => {
			if (
				//
				this.isDestroyed() ||
				!this.isEnabled() ||
				token !== this.syntaxToken
			)
				return;

			const code = this.tb.Text;
			if (code === this.lastCheckedCode) return;
			this.lastCheckedCode = code;

			const nextError = checkLuaSyntax(code);
			if (nextError !== this.syntaxError) {
				this.syntaxError = nextError;
				this.updateDisplay();
			}
		});
	}

	private updateDisplay() {
		const size = this.tb.Text.size();
		const overLimit = size > this.lengthLimit;

		const sizeLabel = this.gui.Heading.Frame.SizeLabel;
		sizeLabel.Text = `(${size}/${this.lengthLimit} bytes)`;
		sizeLabel.TextColor3 = overLimit ? Colors.red : meterColor;

		// bottom line is a warning only: shown for the over-limit block or a syntax error, hidden otherwise
		const label = this.gui.Content.LimitReached;
		if (overLimit) {
			label.Visible = true;
			label.TextColor3 = Colors.red;
			label.Text = `⚠️ Limit of ${this.lengthLimit} characters reached.`;
			this.saveButton.buttonInteractabilityComponent().setInteractable(false);
		} else {
			this.saveButton.buttonInteractabilityComponent().setInteractable(true);
			if (this.syntaxError !== undefined) {
				label.Visible = true;
				label.TextColor3 = Colors.orange;
				label.Text = `⚠️ ${this.syntaxError}`;
			} else {
				label.Visible = false;
			}
		}

		// rebuild the line-number gutter only when the line count changes
		const lineCount = this.tb.Text.gsub("\n", "")[1] + 1;
		if (lineCount !== this.lastLineCount) {
			this.lastLineCount = lineCount;
			let str = "";
			for (let index = 1; index <= lineCount; index++) {
				str += `${index}\n`;
			}
			this.gui.Content.Content.Rows.TextLabel.Text = str;
		}
	}
}
