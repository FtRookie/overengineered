// Identifier analysis for the IDE: which names are defined, and which used names are unaccounted for.
// Naive by design (matches inside strings/comments too) — over-collecting definitions only suppresses
// warnings, it never invents false ones.
import { Lexer } from "client/gui/popup/ide/highlighter/Lexer";

/** Every name that appears in a defining position — locals, params, loop vars, function names and
 * assignment targets. Used both to color declared variables and to decide what counts as unidentified. */
export function collectDefinedNames(src: string): Set<string> {
	const names = new Set<string>();
	const addWords = (raw: unknown) => {
		for (const [name] of tostring(raw).gmatch("[%a_][%w_]*")) {
			names.add(tostring(name));
		}
	};

	// local a, b = ... / local a / local function f
	for (const [list] of src.gmatch("local%s+([%w_%s,]-)%s*=")) addWords(list);
	for (const [name] of src.gmatch("local%s+([%w_]+)")) names.add(tostring(name));
	for (const [name] of src.gmatch("local%s+function%s+([%w_]+)")) names.add(tostring(name));

	// function name / function a.b / function a:b — the base name is a definition
	for (const [name] of src.gmatch("function%s+([%w_]+)")) names.add(tostring(name));
	// parameters of named, anonymous and method functions (%b matches the balanced paren group)
	for (const [params] of src.gmatch("function[^%(]*(%b())")) addWords(params);

	// for i = ...  and  for k, v in ...
	for (const [name] of src.gmatch("for%s+([%w_]+)%s*=")) names.add(tostring(name));
	for (const [list] of src.gmatch("for%s+([%w_%s,]-)%s+in%s")) addWords(list);

	// assignment targets: NAME = (the trailing [^=] rejects ==, ~=, <=, >=)
	for (const [name] of src.gmatch("([%a_][%w_]*)%s*=[^=]")) names.add(tostring(name));

	return names;
}

export interface UnidentifiedToken {
	readonly name: string;
	readonly line: number; // 1-based, of the first occurrence
}

/** Distinct bare identifiers that are used but never defined — nor a keyword/builtin/field, which the
 * lexer classifies as their own token types — each with the line of its first appearance, in order. */
export function findUnidentifiedTokens(src: string): UnidentifiedToken[] {
	const defined = collectDefinedNames(src);
	const seen = new Set<string>();
	const unknown: UnidentifiedToken[] = [];

	let line = 1;
	for (const [token, content] of Lexer.scan(src)) {
		if (token === "iden") {
			const name = content.gsub("%s", "")[0];
			// the lexer's catch-all rule can emit a lone non-identifier char; only warn on real names
			const [isName] = string.find(name, "^[%a_][%w_]*$");
			if (isName !== undefined && !seen.has(name) && !defined.has(name)) {
				// the token merges its leading whitespace, which may span newlines before the name itself
				const [leading] = content.match("^[%s%c]*");
				seen.add(name);
				unknown.push({ name, line: line + tostring(leading).gsub("\n", "")[1] });
			}
		}
		line += content.gsub("\n", "")[1];
	}
	return unknown;
}
