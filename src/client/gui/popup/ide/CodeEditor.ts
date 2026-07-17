import { UserInputService } from "@rbxts/services";
import { Highlighter } from "client/gui/popup/ide/highlighter/Highlighter";
import {
	codePart,
	diffSplice,
	endBlockCloser,
	INDENT,
	INDENT_LEN,
	isCloserLine,
	leadingWhitespace,
	lineBounds,
	lastNewlineBefore,
	opensBlock,
	toggleCommentLines,
	unclosedBlocks,
	unclosedPairs,
} from "client/gui/popup/ide/LuaSource";
import { Control } from "engine/client/gui/Control";
import { Colors } from "shared/Colors";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

const closerOf: { readonly [k: string]: string | undefined } = { ["("]: ")", ["{"]: "}", ["["]: "]" };
const openerOf: { readonly [k: string]: string | undefined } = { [")"]: "(", ["}"]: "{", ["]"]: "[" };

/** Editing behaviour of the IDE's TextBox; display (gutter, size, syntax label) lives in IDEPopup. */
export class CodeEditor extends Control<TextBox> {
	private lastText: string;
	private suppress = false;
	private focused = false;
	private highlightCleanup?: () => void;
	// removed by an on-type dedent, restored if the line grows past the closer ("end" -> "endpoint")
	private dedentRestore?: { lineStart: number; removed: string };
	// the last Ctrl+/ block, so repeated toggles survive the selection being destroyed
	private commentRange?: { from: number; to: number };

	constructor(textbox: TextBox, code: string) {
		super(textbox);

		const initial = code.gsub("\t", INDENT)[0];
		this.lastText = initial;

		this.$onInjectAuto((dataStorage: PlayerDataStorage) => {
			if (dataStorage.config.get().syntaxHighlight) {
				// highlight once shown: the box must be parented for TextBounds to settle
				this.onEnable(() => {
					if (this.highlightCleanup !== undefined) return;
					task.spawn(() => {
						if (this.isDestroyed()) return;
						this.highlightCleanup = Highlighter.highlight(this.gui);
					});
				});
				this.onDestroy(() => this.highlightCleanup?.());
			} else {
				this.gui.TextColor3 = Colors.white;
				this.gui.TextTransparency = 0;
				this.gui.RichText = false;
			}
		});

		this.gui.Text = initial;

		this.event.subscribe(this.gui.GetPropertyChangedSignal("Text"), () => {
			if (this.suppress) return;
			const text = this.gui.Text;
			const cursor = this.gui.CursorPosition;
			if (this.commentHotkey(text)) return;
			this.commentRange = undefined;
			if (this.normalizeTabs(text, cursor)) return;

			const delta = text.size() - this.lastText.size();
			this.lastText = text;

			if (delta === 1 && cursor >= 2 && text.sub(cursor - 1, cursor - 1) === "\n") {
				this.dedentRestore = undefined;
				this.autoIndentNewLine(text, cursor);
			} else if (delta === 1 && cursor >= 1) {
				if (!this.autoCloseBracket(text, cursor) && !this.dedentCloserLine(text, cursor)) {
					this.restoreDedent(text, cursor);
				}
			} else if (delta === -1 && cursor >= 1) {
				this.dedentRestore = undefined;
				this.snapBackspace(text, cursor);
			} else {
				this.dedentRestore = undefined;
			}
		});
		this.event.subscribe(this.gui.Focused, () => (this.focused = true));
		this.event.subscribe(this.gui.FocusLost, () => (this.focused = false));

		// any caret move that isn't the hotkey's own churn invalidates the remembered block
		this.event.subscribe(this.gui.GetPropertyChangedSignal("CursorPosition"), () => {
			if (this.suppress || this.isCommentHotkeyDown()) return;
			this.commentRange = undefined;
		});

		// raw InputBegan fires even while the TextBox is focused; onKeyDown drops gameProcessed events
		this.event.onInputBegin((input) => {
			if (!this.focused) return;

			// plain Tab: the TextBox inserts a native tab which normalizeTabs turns into 4 spaces
			if (input.KeyCode === Enum.KeyCode.Tab) {
				if (
					UserInputService.IsKeyDown(Enum.KeyCode.LeftShift) ||
					UserInputService.IsKeyDown(Enum.KeyCode.RightShift)
				)
					this.dedentCurrentLine();
			}
		});
	}

	// prevent a feedback loop during highlighting
	private setTextSuppressed(newText: string, newCursor: number) {
		this.suppress = true;
		this.gui.Text = newText;
		this.gui.CursorPosition = newCursor;
		this.suppress = false;
		this.lastText = this.gui.Text;
	}

	// typing an opener inserts its closer (if unbalanced); typing a closer over an existing one skips it
	private autoCloseBracket(text: string, cursor: number): boolean {
		const typed = text.sub(cursor - 1, cursor - 1);

		const close = closerOf[typed];
		if (close !== undefined) {
			if (unclosedPairs(text, typed, close) <= 0) return false;
			this.setTextSuppressed(text.sub(1, cursor - 1) + close + text.sub(cursor), cursor);
			return true;
		}

		const open = openerOf[typed];
		if (open !== undefined && text.sub(cursor, cursor) === typed && unclosedPairs(text, open, typed) < 0) {
			this.setTextSuppressed(text.sub(1, cursor - 1) + text.sub(cursor + 1), cursor);
			return true;
		}
		return false;
	}

	// replaces every tab with 4 spaces
	private normalizeTabs(text: string, cursor: number): boolean {
		const [tabPos] = string.find(text, "\t", 1, true);
		if (tabPos === undefined) return false;

		this.dedentRestore = undefined;
		const normalized = text.gsub("\t", INDENT)[0];
		let newCursor = cursor;
		if (cursor >= 1) {
			const tabsBefore = text.sub(1, cursor - 1).gsub("\t", "")[1];
			newCursor = cursor + tabsBefore * (INDENT_LEN - 1);
		}
		this.setTextSuppressed(normalized, newCursor);
		return true;
	}

	private autoIndentNewLine(text: string, cursor: number): boolean {
		const nlIndex = cursor - 1;
		const prevLineStart = lastNewlineBefore(text, nlIndex) + 1;
		const prevLine = text.sub(prevLineStart, nlIndex - 1);
		const code = codePart(prevLine);

		const baseIndent = leadingWhitespace(prevLine);
		const innerIndent = opensBlock(code) ? baseIndent + INDENT : baseIndent;

		// Enter between brackets: move the closer to its own line
		const nextChar = text.sub(cursor, cursor);
		if ((nextChar === "}" || nextChar === ")") && code.sub(code.size()) === (nextChar === "}" ? "{" : "(")) {
			const inserted = innerIndent + "\n" + baseIndent;
			this.setTextSuppressed(text.sub(1, cursor - 1) + inserted + text.sub(cursor), cursor + innerIndent.size());
			return true;
		}

		// fresh unclosed block: indent the caret line and append the closer below
		const closer = endBlockCloser(code);
		if (closer !== undefined && unclosedBlocks(text) > 0) {
			const inserted = innerIndent + "\n" + baseIndent + closer;
			const withClose = text.sub(1, cursor - 1) + inserted + text.sub(cursor);
			this.setTextSuppressed(withClose, cursor + innerIndent.size());
			return true;
		}

		if (innerIndent === "") return false;

		const newText = text.sub(1, cursor - 1) + innerIndent + text.sub(cursor);
		this.setTextSuppressed(newText, cursor + innerIndent.size());
		return true;
	}

	private dedentCloserLine(text: string, cursor: number): boolean {
		const [lineStart, lineEndEx] = lineBounds(text, cursor);
		// already dedented this line; don't remove another level per keystroke
		if (this.dedentRestore?.lineStart === lineStart) return false;

		const line = text.sub(lineStart, lineEndEx - 1);
		if (!isCloserLine(codePart(line))) return false;

		const leading = leadingWhitespace(line);
		const remove = math.min(INDENT_LEN, leading.size());
		if (remove <= 0) return false;

		this.dedentRestore = { lineStart, removed: leading.sub(1, remove) };
		const newText = text.sub(1, lineStart - 1) + line.sub(remove + 1) + text.sub(lineEndEx);
		this.setTextSuppressed(newText, math.max(lineStart, cursor - remove));
		return true;
	}

	// undo an on-type dedent once the line grows past the closer (e.g. "end" typed on into "endpoint")
	private restoreDedent(text: string, cursor: number): boolean {
		const restore = this.dedentRestore;
		if (restore === undefined) return false;

		const [lineStart, lineEndEx] = lineBounds(text, cursor);
		if (lineStart !== restore.lineStart) {
			this.dedentRestore = undefined;
			return false;
		}
		if (isCloserLine(codePart(text.sub(lineStart, lineEndEx - 1)))) return false;

		this.dedentRestore = undefined;
		const newText = text.sub(1, lineStart - 1) + restore.removed + text.sub(lineStart);
		this.setTextSuppressed(newText, cursor + restore.removed.size());
		return true;
	}

	// automatically delete 4 spaces
	private snapBackspace(text: string, cursor: number): boolean {
		const [lineStart] = lineBounds(text, cursor);
		const beforeCaret = text.sub(lineStart, cursor - 1);
		if (beforeCaret.size() === 0 || leadingWhitespace(beforeCaret).size() !== beforeCaret.size()) return false;

		const extra = beforeCaret.size() % INDENT_LEN;
		if (extra === 0) return false;

		const newText = text.sub(1, cursor - 1 - extra) + text.sub(cursor);
		this.setTextSuppressed(newText, cursor - extra);
		return true;
	}

	private dedentCurrentLine() {
		const text = this.gui.Text;
		const cursor = this.gui.CursorPosition;
		if (cursor < 1) return;

		const [lineStart, lineEndEx] = lineBounds(text, cursor);
		const line = text.sub(lineStart, lineEndEx - 1);
		const remove = math.min(INDENT_LEN, leadingWhitespace(line).size());
		if (remove <= 0) return;

		const newText = text.sub(1, lineStart - 1) + line.sub(remove + 1) + text.sub(lineEndEx);
		this.setTextSuppressed(newText, math.max(lineStart, cursor - remove));
	}

	private isCommentHotkeyDown(): boolean {
		return (
			UserInputService.IsKeyDown(Enum.KeyCode.Slash) &&
			(UserInputService.IsKeyDown(Enum.KeyCode.LeftControl) ||
				UserInputService.IsKeyDown(Enum.KeyCode.RightControl))
		);
	}

	// Ctrl+/: the TextBox inserts a literal "/" (replacing any selection) — undo it and toggle instead
	private commentHotkey(text: string): boolean {
		if (!this.isCommentHotkeyDown()) return false;

		const prev = this.lastText;
		const [prefixLen, suffixLen, inserted] = diffSplice(prev, text);
		if (inserted !== "/") return false;

		this.dedentRestore = undefined;
		let from = prefixLen + 1;
		let to = math.max(from, prev.size() - suffixLen);
		// no live selection: reuse the last toggled block if nothing else happened since
		if (to === from && this.commentRange !== undefined) {
			from = this.commentRange.from;
			to = this.commentRange.to;
		}

		const [newText, newCursor, regionStart, regionEnd] = toggleCommentLines(prev, from, to);
		this.commentRange = { from: regionStart, to: regionEnd };
		this.setTextSuppressed(newText, newCursor);
		return true;
	}
}
