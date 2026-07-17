// Pure helpers for Lua line/block structure; naive about strings/comments — editor convenience only.
// Surface level parsing, does not guarantee syntax to be parsed correctly

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
