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

/** Distinct bare identifiers that are used but never defined — nor a keyword/builtin/field, which the
 * lexer classifies as their own token types — in order of first appearance. */
export function findUnidentifiedTokens(src: string): string[] {
	const defined = collectDefinedNames(src);
	const seen = new Set<string>();
	const unknown: string[] = [];
	for (const [token, content] of Lexer.scan(src)) {
		if (token !== "iden") continue;

		const name = content.gsub("%s", "")[0];
		if (seen.has(name) || defined.has(name)) continue;
		// the lexer's catch-all rule can emit a lone non-identifier char; only warn on real names
		const [isName] = string.find(name, "^[%a_][%w_]*$");
		if (isName === undefined) continue;

		seen.add(name);
		unknown.push(name);
	}
	return unknown;
}
