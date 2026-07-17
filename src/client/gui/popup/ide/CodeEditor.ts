import { UserInputService } from "@rbxts/services";
import { Highlighter } from "client/gui/popup/ide/highlighter/Highlighter";
import {
	codePart,
	diffSplice,
	endBlockCloser,
	findFunctionBlock,
	INDENT,
	INDENT_LEN,
	indentLines,
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
	// the last Ctrl+/ or Tab block, so repeated toggles survive the selection being destroyed
	private blockRange?: { from: number; to: number };
	// folded function bodies; the marker comment on the header line anchors each fold in the text
	private readonly folds = new Map<number, { marker: string; body: string; hiddenReal: number }>();
	private nextFoldId = 1;
	private foldStamp = 0;
	private inFoldOp = false;
	private inFoldMaintenance = false;
	// Tab is handled from whichever event arrives first, InputBegan or the native "\t" text change;
	// these two flags stop the other path from double-applying the same keystroke
	private swallowTab = false;
	private tabConsumed = false;
	// fold toggles once per physical press; key repeat only consumes the re-inserted character
	private foldLatch = false;
	private lastSetCursor = 0;
	// tracked from input events, not IsKeyDown: polling shift state proved unreliable for distinguishing
	// Shift+Tab (dedent) from Tab (indent) on some platforms
	private shiftHeld = false;

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
			// the suppress flag misses echoes of our own writes under deferred signals or when another
			// handler wrote in between; lastText is synced on every programmatic write, so equality
			// means "not a real edit" regardless of signal timing
			if (text === this.lastText) return;
			const cursor = this.gui.CursorPosition;
			const swallowTab = this.swallowTab;
			this.swallowTab = false;
			if (this.commentHotkey(text)) return;
			if (this.tabHotkey(text, swallowTab)) return;
			this.blockRange = undefined;
			if (this.foldHotkey(text)) return;
			const prev = this.lastText;
			if (this.maintainFolds(prev)) return;
			if (this.normalizeTabs(text, cursor)) return;

			const delta = text.size() - prev.size();
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
		this.event.subscribe(this.gui.Focused, () => {
			this.focused = true;
			this.blockRange = undefined; // (re-)entering the box starts fresh
		});
		this.event.subscribe(this.gui.FocusLost, () => {
			this.focused = false;
			this.shiftHeld = false; // a shift release can be missed while unfocused; never carry it stale
		});

		// track shift from the input stream itself (same source that reliably delivers our Tab events),
		// before the focus guard so a shift pressed just before focusing is still seen
		const isShift = (input: InputObject) =>
			input.KeyCode === Enum.KeyCode.LeftShift || input.KeyCode === Enum.KeyCode.RightShift;
		this.event.onInputEnd((input) => {
			if (isShift(input)) this.shiftHeld = false;
		});

		// any caret move that isn't the hotkey's own churn invalidates the remembered block
		this.event.subscribe(this.gui.GetPropertyChangedSignal("CursorPosition"), () => {
			if (this.suppress || this.gui.CursorPosition === this.lastSetCursor) return;
			if (this.isCommentHotkeyDown() || UserInputService.IsKeyDown(Enum.KeyCode.Tab)) return;
			this.blockRange = undefined;
		});

		// raw InputBegan fires even while the TextBox is focused; onKeyDown drops gameProcessed events
		this.event.onInputBegin((input) => {
			if (isShift(input)) this.shiftHeld = true;
			if (!this.focused) return;

			// a click re-anchors the caret deliberately — even one landing on the same position, which
			// fires no CursorPosition change for the invalidator above to catch
			if (
				input.UserInputType === Enum.UserInputType.MouseButton1 ||
				input.UserInputType === Enum.UserInputType.Touch
			) {
				this.blockRange = undefined;
			}

			if (input.KeyCode === Enum.KeyCode.Slash || input.KeyCode === Enum.KeyCode.LeftBracket) {
				this.foldLatch = false; // a real press, not key repeat: the next fold hotkey may toggle
			}

			if (input.KeyCode === Enum.KeyCode.Tab) {
				if (this.shiftHeld) {
					this.dedentBlockOrLine();
					// the native tab that may trail the dedent must vanish, independent of key state
					this.swallowTab = true;
				} else if (this.tabConsumed) {
					this.tabConsumed = false; // the native "\t" text change already handled this keystroke
				} else {
					this.swallowTab = false; // a stale window from a tab that never arrived must not eat this one
					this.indentBlockIfAny();
				}
			}
		});
	}

	// prevent a feedback loop during highlighting
	private setTextSuppressed(newText: string, newCursor: number) {
		const prev = this.gui.Text;
		this.suppress = true;
		this.gui.Text = newText;
		this.gui.CursorPosition = newCursor;
		// a selection surviving the rewrite is a stale span over the NEW text — the native keystroke
		// that triggered us would replace it, deleting real code
		this.gui.SelectionStart = -1;
		this.suppress = false;
		this.lastText = this.gui.Text;
		this.lastSetCursor = newCursor;
		// every programmatic edit funnels through here, so folds it touched can reopen
		if (!this.inFoldOp) this.maintainFolds(prev);
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
		if (to === from && this.blockRange !== undefined) {
			from = this.blockRange.from;
			to = this.blockRange.to;
		}

		const [newText, newCursor, regionStart, regionEnd] = toggleCommentLines(prev, from, to);
		this.blockRange = { from: regionStart, to: regionEnd };
		this.setTextSuppressed(newText, newCursor);
		return true;
	}

	// the document never contains real tabs (normalizeTabs invariant), so a lone inserted "\t" can
	// only be the Tab key — no key-state check needed
	private tabHotkey(text: string, swallow: boolean): boolean {
		const prev = this.lastText;
		const [prefixLen, suffixLen, inserted] = diffSplice(prev, text);
		// within the swallow window, the native tab may arrive already converted to spaces by the highlighter
		const isTabChar = inserted === "\t";
		if (!isTabChar && !(swallow && inserted === INDENT)) return false;

		const removed = prev.size() - suffixLen - prefixLen;
		if (swallow && removed <= 0) {
			// the indent already ran on InputBegan; discard the native tab that followed
			this.setTextSuppressed(prev, prefixLen + 1);
			return true;
		}
		if (!isTabChar) return false;

		// Shift+Tab dedents from onInputBegin; discard the stray native tab if this platform inserts one
		if (this.shiftHeld) {
			this.setTextSuppressed(prev, prefixLen + 1);
			return true;
		}

		let from = prefixLen + 1;
		let to = math.max(from, prev.size() - suffixLen);
		if (removed <= 0) {
			if (this.blockRange === undefined) {
				// plain tab, no selection/block: turn the inserted "\t" into INDENT at the same spot,
				// computed from prev so a deferred highlighter conversion can't skew the caret
				this.dedentRestore = undefined;
				this.setTextSuppressed(
					prev.sub(1, prefixLen) + INDENT + prev.sub(prefixLen + 1),
					prefixLen + 1 + INDENT_LEN,
				);
				this.tabConsumed = true;
				return true;
			}
			from = this.blockRange.from;
			to = this.blockRange.to;
		}

		this.dedentRestore = undefined;
		const [newText, newCursor, regionStart, regionEnd] = indentLines(prev, from, to, false);
		this.blockRange = { from: regionStart, to: regionEnd };
		this.setTextSuppressed(newText, newCursor);
		this.tabConsumed = true;
		return true;
	}

	// Tab from onInputBegin: indent the selection/block, or insert one indent at the caret. Deterministic
	// here (before the native tab mutates anything), so a deferred highlighter conversion can't skew it;
	// the native tab that follows is swallowed by tabHotkey.
	private indentBlockIfAny() {
		const text = this.gui.Text;
		const cursor = this.gui.CursorPosition;
		const selection = this.gui.SelectionStart;

		let from: number;
		let to: number;
		if (selection !== -1 && selection !== cursor) {
			from = math.min(selection, cursor);
			to = math.max(from, math.max(selection, cursor) - 1);
		} else if (this.blockRange !== undefined) {
			from = this.blockRange.from;
			to = this.blockRange.to;
		} else {
			if (cursor < 1) return; // no caret to insert at; leave it for the native path
			this.dedentRestore = undefined;
			this.setTextSuppressed(text.sub(1, cursor - 1) + INDENT + text.sub(cursor), cursor + INDENT_LEN);
			this.swallowTab = true;
			return;
		}

		this.dedentRestore = undefined;
		const [newText, newCursor, regionStart, regionEnd] = indentLines(text, from, to, false);
		this.blockRange = { from: regionStart, to: regionEnd };
		this.setTextSuppressed(newText, newCursor);
		this.swallowTab = true;
	}

	// Shift+Tab: dedent the selected lines, the last toggled block, or just the caret line
	private dedentBlockOrLine() {
		const text = this.gui.Text;
		const cursor = this.gui.CursorPosition;
		const selection = this.gui.SelectionStart;

		let from: number;
		let to: number;
		if (selection !== -1 && selection !== cursor) {
			from = math.min(selection, cursor);
			to = math.max(from, math.max(selection, cursor) - 1);
		} else if (this.blockRange !== undefined) {
			from = this.blockRange.from;
			to = this.blockRange.to;
		} else {
			this.dedentCurrentLine();
			return;
		}

		this.dedentRestore = undefined;
		const [newText, newCursor, regionStart, regionEnd] = indentLines(text, from, to, true);
		this.blockRange = { from: regionStart, to: regionEnd };
		this.setTextSuppressed(newText, newCursor);
	}

	// Ctrl+Shift+/ (same physical key as the comment toggle) or Ctrl+[
	private isFoldHotkeyDown(): boolean {
		const ctrl =
			UserInputService.IsKeyDown(Enum.KeyCode.LeftControl) ||
			UserInputService.IsKeyDown(Enum.KeyCode.RightControl);
		if (!ctrl) return false;
		if (UserInputService.IsKeyDown(Enum.KeyCode.LeftBracket)) return true;
		return UserInputService.IsKeyDown(Enum.KeyCode.Slash) && this.shiftHeld;
	}

	// the TextBox inserts the literal "?" (or "[") — undo it and toggle the fold at the caret instead
	private foldHotkey(text: string): boolean {
		if (!this.isFoldHotkeyDown()) return false;

		const prev = this.lastText;
		const [prefixLen, , inserted] = diffSplice(prev, text);
		if (inserted !== "?" && inserted !== "[") return false;

		this.dedentRestore = undefined;
		this.inFoldOp = true;
		this.setTextSuppressed(prev, prefixLen + 1);
		this.inFoldOp = false;

		// key repeat re-inserts the character while held: consume it, but toggle only once per press
		if (this.foldLatch) return true;
		this.foldLatch = true;
		this.toggleFoldAt(prefixLen + 1);
		return true;
	}

	private toggleFoldAt(cursor: number) {
		const text = this.gui.Text;
		const caretLine = 1 + text.sub(1, cursor - 1).gsub("\n", "")[1];

		for (const [id, fold] of this.folds) {
			const [pos] = string.find(text, fold.marker, 1, true);
			if (pos === undefined) continue;
			if (1 + text.sub(1, pos - 1).gsub("\n", "")[1] === caretLine) {
				this.unfold(id);
				return;
			}
		}

		const block = findFunctionBlock(text, caretLine);
		// keeping the header AND the end visible keeps the visible text block-balanced for auto-indent
		if (block === undefined || block.endLine - block.headerLine < 2) return;
		this.fold(block.headerLine, block.endLine);
	}

	private fold(headerLine: number, endLine: number) {
		const lines = this.gui.Text.split("\n");
		const body: string[] = [];
		for (let i = headerLine + 1; i <= endLine - 1; i++) {
			body.push(lines[i - 1]);
		}
		const bodyStr = body.join("\n");

		// markers of already-folded inner functions travel inside the body; count their hidden lines too
		let hiddenReal = body.size();
		for (const [, other] of this.folds) {
			const [inBody] = string.find(bodyStr, other.marker, 1, true);
			if (inBody !== undefined) hiddenReal += other.hiddenReal;
		}

		const id = this.nextFoldId++;
		const marker = ` --[[ folded ${hiddenReal} lines #${id} ]]`;
		this.folds.set(id, { marker, body: bodyStr, hiddenReal });

		const out: string[] = [];
		for (let i = 1; i <= headerLine; i++) {
			out.push(lines[i - 1]);
		}
		const headerEnd = out.join("\n").size();
		out[headerLine - 1] += marker;
		for (let i = endLine; i <= lines.size(); i++) {
			out.push(lines[i - 1]);
		}

		this.foldStamp++;
		this.inFoldOp = true;
		this.setTextSuppressed(out.join("\n"), headerEnd + 1);
		this.inFoldOp = false;
	}

	private unfold(id: number) {
		const fold = this.folds.get(id);
		if (fold === undefined) return;
		const text = this.gui.Text;
		const [pos] = string.find(text, fold.marker, 1, true);
		if (pos === undefined) return;

		this.folds.delete(id);
		this.foldStamp++;

		const restored = text.sub(1, pos - 1) + "\n" + fold.body + text.sub(pos + fold.marker.size());
		this.inFoldOp = true;
		this.setTextSuppressed(restored, pos);
		this.inFoldOp = false;
	}

	// any edit that lands on a fold's header line reopens that fold; returns whether anything reopened
	private maintainFolds(prev: string): boolean {
		if (this.folds.size() === 0 || this.inFoldMaintenance) return false;
		if (prev === this.gui.Text) return false;
		this.inFoldMaintenance = true;

		const [prefixLen, suffixLen] = diffSplice(prev, this.gui.Text);
		const editFrom = prefixLen + 1;
		const editTo = math.max(editFrom, prev.size() - suffixLen);

		let changed = false;
		for (const [id, fold] of this.folds.clone()) {
			const [prevPos] = string.find(prev, fold.marker, 1, true);
			if (prevPos === undefined) continue; // hidden inside another fold

			const [lineStart, lineEndEx] = lineBounds(prev, prevPos);
			if (editTo < lineStart || editFrom > lineEndEx) continue;

			changed = true;
			const [curPos] = string.find(this.gui.Text, fold.marker, 1, true);
			if (curPos === undefined) {
				// the edit destroyed the marker: revert it so the fold can be located and restored
				this.inFoldOp = true;
				this.setTextSuppressed(prev, math.min(editFrom, prev.size() + 1));
				this.inFoldOp = false;
			}
			this.unfold(id);
		}

		this.inFoldMaintenance = false;
		return changed;
	}

	/** Flag these identifiers red in the highlighter — called from the debounced syntax check so names
	 * aren't reddened mid-type. No-op when highlighting is off. */
	setUnknownTokens(tokens: ReadonlySet<string>) {
		Highlighter.setUnknownTokens(this.gui, tokens);
	}

	/** The code with all folds expanded — what must be saved and syntax-checked. */
	getFullText(): string {
		let text = this.gui.Text;
		if (this.folds.size() === 0) return text;

		let expanded = true;
		while (expanded) {
			expanded = false;
			for (const [, fold] of this.folds) {
				const [pos] = string.find(text, fold.marker, 1, true);
				if (pos === undefined) continue;
				text = text.sub(1, pos - 1) + "\n" + fold.body + text.sub(pos + fold.marker.size());
				expanded = true;
			}
		}
		return text;
	}

	/** Bumped on every fold/unfold, so the popup knows to rebuild the gutter. */
	getFoldStamp(): number {
		return this.foldStamp;
	}

	/** Visible fold markers: display line and the number of real lines hidden after it, sorted. */
	getFoldOffsets(): { line: number; hidden: number }[] {
		const out: { line: number; hidden: number }[] = [];
		if (this.folds.size() === 0) return out;

		const text = this.gui.Text;
		for (const [, fold] of this.folds) {
			const [pos] = string.find(text, fold.marker, 1, true);
			if (pos === undefined) continue;
			out.push({ line: 1 + text.sub(1, pos - 1).gsub("\n", "")[1], hidden: fold.hiddenReal });
		}
		out.sort((a, b) => a.line < b.line);
		return out;
	}
}
