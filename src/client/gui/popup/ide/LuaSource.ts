// Pure helpers for Lua line/block structure; naive about strings/comments — editor convenience only.
// Surface level parsing, does not guarantee syntax to be parsed correctly
import { Lexer } from "client/gui/popup/ide/highlighter/Lexer";

export const INDENT = "    "; // literal \t renders wider than 4 spaces
export const INDENT_LEN = INDENT.size();

const blockOpenerWords = ["then", "do", "repeat", "else"] as const; // a trailing one adds an indent
const blockCloserLines = ["end", "until", "}", ")"] as const; // a line that is only one of these dedents

/** Index of the last "\n" strictly before `pos` (1-based), or 0 if none. */
export function lastNewlineBefore(text: string, pos: number): number {
	for (let i = pos - 1; i >= 1; i--) {
		if (text.sub(i, i) === "\n") return i;
	}
	return 0;
}

/** Start (1-based) and exclusive end of the line containing `cursor`. */
export function lineBounds(text: string, cursor: number): LuaTuple<[start: number, endExclusive: number]> {
	const start = lastNewlineBefore(text, cursor) + 1;
	const [nl] = string.find(text, "\n", cursor, true);
	const endEx = (nl as number | undefined) ?? text.size() + 1;
	return $tuple(start, endEx);
}

export function leadingWhitespace(line: string): string {
	let i = 0;
	while (i < line.size()) {
		const c = line.sub(i + 1, i + 1);
		if (c !== " " && c !== "\t") break;
		i++;
	}
	return line.sub(1, i);
}

/** Code portion of a line: trailing line comment stripped and trimmed (ignores "--" inside strings). */
export function codePart(line: string): string {
	const [commentPos] = string.find(line, "--", 1, true);
	const code = commentPos !== undefined ? line.sub(1, (commentPos as number) - 1) : line;
	return code.trim();
}

/** True if this (comment-stripped) line opens a block, so the next line should gain a level. */
export function opensBlock(code: string): boolean {
	if (code === "") return false;

	const last = code.sub(code.size());
	if (last === "(" || last === "{") {
		return true;
	}
	const [functionPos] = string.find(code, "%f[%w]function%f[%W]");
	if (last === ")" && functionPos !== undefined && countWord(code, "end") === 0) return true;
	for (const word of blockOpenerWords) {
		if (endsWithWord(code, word)) return true;
	}
	return false;
}

/** The token that closes the block this line opens, if it opens a fresh end-closed block. */
export function endBlockCloser(code: string): string | undefined {
	if (code === "") return undefined;
	// else / elseif continue an existing block and reuse its end
	if (startsWithWord(code, "else") || startsWithWord(code, "elseif")) return undefined;
	if (startsWithWord(code, "if") && endsWithWord(code, "then")) return "end";
	if (endsWithWord(code, "do")) return "end";
	// only auto-close a function declaration, not a callback like map(function() — that needs "end)"
	const isFunctionDef = startsWithWord(code, "function") || code.startsWith("local function");
	if (isFunctionDef && code.sub(code.size()) === ")") return "end";
	return undefined;
}

/** Naive block-balance: each function/if/do pairs with one end; positive = missing closers. */
export function unclosedBlocks(text: string): number {
	return countWord(text, "function") + countWord(text, "if") + countWord(text, "do") - countWord(text, "end");
}

/** Count of `open` minus `close` occurrences; positive = unclosed. */
export function unclosedPairs(text: string, open: string, close: string): number {
	return text.gsub("%" + open, "")[1] - text.gsub("%" + close, "")[1];
}

/** Longest common prefix/suffix split of an edit: returns (prefixLen, suffixLen, insertedMiddle). */
export function diffSplice(prev: string, current: string): LuaTuple<[number, number, string]> {
	const prevSize = prev.size();
	const currentSize = current.size();

	let p = 0;
	const maxP = math.min(prevSize, currentSize);
	while (p < maxP && prev.sub(p + 1, p + 1) === current.sub(p + 1, p + 1)) p++;

	let s = 0;
	const maxS = math.min(prevSize, currentSize) - p;
	while (s < maxS && prev.sub(prevSize - s, prevSize - s) === current.sub(currentSize - s, currentSize - s)) s++;

	return $tuple(p, s, current.sub(p + 1, currentSize - s));
}

/** Toggles "-- " on the lines spanned by [from, to] (1-based); returns new text, caret and region bounds. */
export function toggleCommentLines(
	text: string,
	from: number,
	to: number,
): LuaTuple<[newText: string, newCursor: number, regionStart: number, regionEnd: number]> {
	const [firstStart] = lineBounds(text, from);

	const lines: string[] = [];
	let regionEndEx = firstStart;
	let pos = firstStart;
	while (true as boolean) {
		const [s, e] = lineBounds(text, pos);
		lines.push(text.sub(s, e - 1));
		regionEndEx = e;
		if (to <= e || e > text.size()) break;
		pos = e + 1;
	}

	// blank lines don't count toward (or receive) the toggle, unless the whole range is blank
	let considered = 0;
	let commented = 0;
	for (const line of lines) {
		if (line.trim() === "") continue;
		considered++;
		if (line.sub(leadingWhitespace(line).size() + 1).startsWith("--")) commented++;
	}
	const uncomment = considered > 0 && commented === considered;
	const skipBlanks = considered > 0;

	let firstDelta = 0;
	const toggled: string[] = [];
	for (let i = 0; i < lines.size(); i++) {
		const line = lines[i];
		if (skipBlanks && line.trim() === "") {
			toggled.push(line);
			continue;
		}

		let delta: number;
		if (!uncomment) {
			// marker goes at column 0 so indentation stays readable after it
			toggled.push("-- " + line);
			delta = 3;
		} else {
			const leading = leadingWhitespace(line);
			const rest = line.sub(leading.size() + 1);
			let newRest: string;
			if (rest.startsWith("-- ")) {
				newRest = rest.sub(4);
				delta = -3;
			} else {
				newRest = rest.sub(3);
				delta = -2;
			}
			toggled.push(leading + newRest);
		}
		if (i === 0) firstDelta = delta;
	}

	const region = toggled.join("\n");
	const newText = text.sub(1, firstStart - 1) + region + text.sub(regionEndEx);

	let newCursor: number;
	if (lines.size() !== 1) {
		newCursor = firstStart + region.size();
	} else if (!uncomment) {
		newCursor = from + firstDelta;
	} else {
		// the marker sits at the first non-whitespace column; only shift a caret at/after it
		const markerCol = firstStart + leadingWhitespace(lines[0]).size();
		newCursor = from <= markerCol ? from : math.max(markerCol, from + firstDelta);
	}
	return $tuple(newText, newCursor, firstStart, math.max(firstStart, firstStart + region.size() - 1));
}

/** Adds or removes one indent level on the lines spanned by [from, to]; returns new text, caret and region bounds. */
export function indentLines(
	text: string,
	from: number,
	to: number,
	dedent: boolean,
): LuaTuple<[newText: string, newCursor: number, regionStart: number, regionEnd: number]> {
	const [firstStart] = lineBounds(text, from);

	const lines: string[] = [];
	let regionEndEx = firstStart;
	let pos = firstStart;
	while (true as boolean) {
		const [s, e] = lineBounds(text, pos);
		lines.push(text.sub(s, e - 1));
		regionEndEx = e;
		if (to <= e || e > text.size()) break;
		pos = e + 1;
	}

	let firstDelta = 0;
	const changed: string[] = [];
	for (let i = 0; i < lines.size(); i++) {
		const line = lines[i];
		// blank lines neither gain nor lose indentation
		if (line.trim() === "") {
			changed.push(line);
			continue;
		}

		let delta: number;
		if (!dedent) {
			changed.push(INDENT + line);
			delta = INDENT_LEN;
		} else {
			const remove = math.min(INDENT_LEN, leadingWhitespace(line).size());
			changed.push(line.sub(remove + 1));
			delta = -remove;
		}
		if (i === 0) firstDelta = delta;
	}

	const region = changed.join("\n");
	const newText = text.sub(1, firstStart - 1) + region + text.sub(regionEndEx);

	const newCursor = lines.size() !== 1 ? firstStart + region.size() : math.max(firstStart, from + firstDelta);
	return $tuple(newText, newCursor, firstStart, math.max(firstStart, firstStart + region.size() - 1));
}

const blockOpenerKeywords = new Set<string>(["function", "if", "do", "repeat"]);

/** Innermost `function` block containing `caretLine`, via the lexer (so strings/comments don't confuse it). */
export function findFunctionBlock(src: string, caretLine: number): { headerLine: number; endLine: number } | undefined {
	const stack: { word: string; line: number }[] = [];
	let best: { headerLine: number; endLine: number } | undefined;

	let line = 1;
	for (const [token, content] of Lexer.scan(src)) {
		if (token === "keyword") {
			const word = content.gsub("[%s%c]+", "")[0];
			// the token's leading whitespace can contain newlines, shifting the keyword's actual line
			const [leading] = content.match("^[%s%c]*");
			const keywordLine = line + tostring(leading).gsub("\n", "")[1];

			if (blockOpenerKeywords.has(word)) {
				stack.push({ word, line: keywordLine });
			} else if (word === "end" || word === "until") {
				const open = stack.pop();
				if (
					open !== undefined &&
					open.word === "function" &&
					open.line <= caretLine &&
					caretLine <= keywordLine &&
					(best === undefined || open.line > best.headerLine)
				) {
					best = { headerLine: open.line, endLine: keywordLine };
				}
			}
		}
		line += content.gsub("\n", "")[1];
	}
	return best;
}

/** Converts each leading group of 4 spaces to "\t" for saving — 1 byte per level instead of 4.
 * Lines continuing a multiline string/comment are untouched: their leading whitespace is content. */
export function compressIndentation(src: string): string {
	const protectedLines = new Set<number>();
	let line = 1;
	for (const [, content] of Lexer.scan(src)) {
		// newlines inside the trimmed content are structural: a multiline string/comment spanning lines
		const [leadingWs] = content.match("^[%s%c]*");
		const innerNewlines = content.trim().gsub("\n", "")[1];
		if (innerNewlines > 0) {
			const startLine = line + tostring(leadingWs).gsub("\n", "")[1];
			for (let l = startLine + 1; l <= startLine + innerNewlines; l++) {
				protectedLines.add(l);
			}
		}
		line += content.gsub("\n", "")[1];
	}

	const lines = src.split("\n");
	for (let i = 0; i < lines.size(); i++) {
		if (protectedLines.has(i + 1)) continue;

		const tabs = math.floor(leadingWhitespace(lines[i]).size() / INDENT_LEN);
		if (tabs === 0) continue;
		lines[i] = string.rep("\t", tabs) + lines[i].sub(tabs * INDENT_LEN + 1);
	}
	return lines.join("\n");
}

export function isCloserLine(code: string): boolean {
	for (const closer of blockCloserLines) {
		if (code === closer) return true;
	}
	return false;
}

function countWord(text: string, word: string): number {
	let count = 0;
	let from = 1;
	const pattern = `%f[%w]${word}%f[%W]`;
	while (true as boolean) {
		const [start, finish] = string.find(text, pattern, from);
		if (start === undefined) break;
		count++;
		from = (finish as number) + 1;
	}
	return count;
}

function startsWithWord(s: string, word: string): boolean {
	if (!s.startsWith(word)) return false;
	if (s.size() === word.size()) return true;
	// destructure: comparing the LuaTuple return of string.match directly compiles to `{...} == nil`
	const [boundary] = string.match(s.sub(word.size() + 1, word.size() + 1), "[%w_]");
	return boundary === undefined;
}

function endsWithWord(s: string, word: string): boolean {
	if (s.size() < word.size()) return false;
	if (s.sub(s.size() - word.size() + 1) !== word) return false;
	if (s.size() === word.size()) return true;
	const [boundary] = string.match(s.sub(s.size() - word.size(), s.size() - word.size()), "[%w_]");
	return boundary === undefined;
}
