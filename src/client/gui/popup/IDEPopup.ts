import { CodeEditor } from "client/gui/popup/ide/CodeEditor";
import { findUnidentifiedTokens } from "client/gui/popup/ide/LuaIdentifiers";
import { compressIndentation } from "client/gui/popup/ide/LuaSource";
import { checkLuaSyntax } from "client/gui/popup/ide/LuaSyntaxCheck";
import { TextButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { Colors } from "shared/Colors";
import type { UnidentifiedToken } from "client/gui/popup/ide/LuaIdentifiers";

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
	private readonly editor: CodeEditor;
	private syntaxError?: string;
	private unidentified: UnidentifiedToken[] = [];
	private byteSize = 0; // stored; computed during the syntax check
	private syntaxToken = 0;
	private lastCheckedCode?: string;
	private lastLineCount = -1;
	private lastFoldStamp = -1;

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
		this.editor = this.parent(new CodeEditor(this.tb, code));
		this.saveButton = new TextButtonControl(gui.Content.Buttons.SaveButton);

		this.event.subscribe(this.tb.GetPropertyChangedSignal("Text"), () => {
			this.updateDisplay();
			this.scheduleSyntaxCheck();
		});

		this.parent(new Control(gui.Heading.CloseButton).addButtonAction(() => this.hideThenDestroy()));
		this.parent(new Control(gui.Content.Buttons.CancelButton).addButtonAction(() => this.hideThenDestroy()));
		this.parent(
			this.saveButton.addButtonAction(() => {
				callback(compressIndentation(this.editor.getFullText()));
				this.hideThenDestroy();
			}),
		);

		this.event.subscribe(this.gui.Content.Content.Code.GetPropertyChangedSignal("CanvasPosition"), () => {
			this.gui.Content.Content.Rows.CanvasPosition = this.gui.Content.Content.Code.CanvasPosition;
		});

		this.byteSize = compressIndentation(this.editor.getFullText()).size();
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

			const code = this.editor.getFullText();
			if (code === this.lastCheckedCode) return;
			this.lastCheckedCode = code;

			const nextError = checkLuaSyntax(code);
			const nextUnknown = findUnidentifiedTokens(code);
			const nextSize = compressIndentation(code).size();
			const asKey = (tokens: UnidentifiedToken[]) => tokens.map((t) => `${t.line}:${t.name}`).join("\n");
			const unknownChanged = asKey(nextUnknown) !== asKey(this.unidentified);
			if (nextError === this.syntaxError && !unknownChanged && nextSize === this.byteSize) return;

			this.syntaxError = nextError;
			this.byteSize = nextSize;
			if (unknownChanged) {
				this.unidentified = nextUnknown;
				// flag the confirmed unknowns red now, not on every keystroke as they are typed
				this.editor.setUnknownTokens(new Set(nextUnknown.map((t) => t.name)));
			}
			this.updateDisplay();
		});
	}

	private updateDisplay() {
		const size = this.byteSize;
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
			} else if (this.unidentified.size() > 0) {
				label.Visible = true;
				label.TextColor3 = Colors.orange;
				const first = this.unidentified[0];
				const more = this.unidentified.size() - 1;
				const suffix = more > 0 ? ` (+${more} more)` : "";
				// matches Luau's own linter phrasing and the "Line X:" form of the syntax errors above
				label.Text = `⚠️ Line ${first.line}: Unknown global '${first.name}'${suffix}`;
			} else {
				label.Visible = false;
			}
		}

		// rebuild the line-number gutter only when the line count or fold layout changes
		const lineCount = this.tb.Text.gsub("\n", "")[1] + 1;
		const foldStamp = this.editor.getFoldStamp();
		if (lineCount !== this.lastLineCount || foldStamp !== this.lastFoldStamp) {
			this.lastLineCount = lineCount;
			this.lastFoldStamp = foldStamp;

			// numbers are real (unfolded) line numbers, skipping the lines hidden inside folds
			const offsets = this.editor.getFoldOffsets();
			let str = "";
			let real = 1;
			let nextFold = 0;
			for (let index = 1; index <= lineCount; index++) {
				str += `${real}\n`;
				const fold = offsets[nextFold];
				if (fold !== undefined && fold.line === index) {
					real += fold.hidden;
					nextFold++;
				}
				real++;
			}
			this.gui.Content.Content.Rows.TextLabel.Text = str;
		}
	}
}
