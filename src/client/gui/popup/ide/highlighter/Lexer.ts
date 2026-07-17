// Lua token scanner, ported from the vendored boatbomber Highlighter lexer.
// Tokens: iden, keyword, builtin, field, method, string, number, comment, operator.
import { Language } from "client/gui/popup/ide/highlighter/Language";

const Prefix = "^[%c%s]*";
const Suffix = "[%c%s]*";
const Cleaner = "[%c%s]+";
// string.char: high-byte TS literals would be UTF-8 re-encoded into two bytes
const UNICODE = `[%z${string.char(0x01)}-${string.char(0x7f)}${string.char(0xc2)}-${string.char(0xf4)}][${string.char(0x80)}-${string.char(0xbf)}]+`;
const NUMBER_A = "0[xX][%da-fA-F_]+";
const NUMBER_B = "0[bB][01_]+";
const NUMBER_C = "%d+%.?%d*[eE][%+%-]?%d+";
const NUMBER_D = "%d+[%._]?[%d_eE]*";
const OPERATORS = "[:;<>/~%*%(%)%-={},%.#%^%+%%]+";
const BRACKETS = "[%[%]]+"; // needs to be separate from other operators or it'll mess up multiline strings
const IDEN = "[%a_][%w_]*";
// string.char(34): mixed-quote literals are emitted as raw long-bracket strings, breaking escapes
const QUOTE_CLASS = "(['" + string.char(34) + "])";
const STRING_EMPTY = QUOTE_CLASS + "%1";
const STRING_PLAIN = QUOTE_CLASS + "[^\n]-([^\\]%1)";
const STRING_INTER = "`[^\n]-`";
const STRING_INCOMP_A = QUOTE_CLASS + ".-\n";
const STRING_INCOMP_B = QUOTE_CLASS + "[^\n]*";
const STRING_MULTI = "%[(=*)%[.-%]%1%]";
const STRING_MULTI_INCOMP = "%[=*%[.-.*";
const COMMENT_MULTI = "%-%-%[(=*)%[.-%]%1%]";
const COMMENT_MULTI_INCOMP = "%-%-%[=*%[.-.*";
const COMMENT_PLAIN = "%-%-.-\n";
const COMMENT_INCOMP = "%-%-.*";

const luaMatches: ReadonlyArray<readonly [pattern: string, token: string]> = [
	[Prefix + IDEN + Suffix, "var"],

	[Prefix + NUMBER_A + Suffix, "number"],
	[Prefix + NUMBER_B + Suffix, "number"],
	[Prefix + NUMBER_C + Suffix, "number"],
	[Prefix + NUMBER_D + Suffix, "number"],

	[Prefix + STRING_EMPTY + Suffix, "string"],
	[Prefix + STRING_PLAIN + Suffix, "string"],
	[Prefix + STRING_INCOMP_A + Suffix, "string"],
	[Prefix + STRING_INCOMP_B + Suffix, "string"],
	[Prefix + STRING_MULTI + Suffix, "string"],
	[Prefix + STRING_MULTI_INCOMP + Suffix, "string"],
	[Prefix + STRING_INTER + Suffix, "string_inter"],

	[Prefix + COMMENT_MULTI + Suffix, "comment"],
	[Prefix + COMMENT_MULTI_INCOMP + Suffix, "comment"],
	[Prefix + COMMENT_PLAIN + Suffix, "comment"],
	[Prefix + COMMENT_INCOMP + Suffix, "comment"],

	[Prefix + OPERATORS + Suffix, "operator"],
	[Prefix + BRACKETS + Suffix, "operator"],

	[Prefix + UNICODE + Suffix, "iden"],

	["^.", "iden"],
];

export namespace Lexer {
	/** Token iterator over `s`; yields (token, content) pairs. */
	export function scan(s: string): IterableFunction<LuaTuple<[token: string, content: string]>> {
		let index = 1;
		const size = s.size();
		let previousContent1 = "";
		let previousContent2 = "";
		let previousContent3 = "";
		let previousToken = "";

		const thread = coroutine.create(() => {
			while (index <= size) {
				let matched = false;
				for (const [pattern, rawToken] of luaMatches) {
					const [start, finish] = string.find(s, pattern, index);
					if (start === undefined) continue;

					index = (finish as number) + 1;
					matched = true;

					const content = s.sub(start, finish as number);
					let processedToken: string | undefined = rawToken;

					if (rawToken === "var") {
						// spaces are merged into the token, so remove them to check the actual word
						const cleanContent = content.gsub(Cleaner, "")[0];

						const [afterIndexer] = string.find(previousContent1, "[%.:][%s%c]*$");
						// not a double operator: .. (concat) / ... (vararg) / :: (label/cast) aren't indexing
						const [afterDouble] = string.find(previousContent1, "[%.:][%.:][%s%c]*$");

						if (Language.keyword[cleanContent] !== undefined) {
							processedToken = "keyword";
						} else if (Language.builtin[cleanContent] !== undefined) {
							processedToken = "builtin";
						} else if (
							afterIndexer !== undefined &&
							afterDouble === undefined &&
							previousToken !== "comment"
						) {
							const [afterColon] = string.find(previousContent1, ":[%s%c]*$");
							if (afterColon !== undefined) {
								// indexing via ':' is a method
								processedToken = "method";
							} else {
								const parent = previousContent2.gsub(Cleaner, "")[0];
								const lib = Language.libraries[parent];
								const [chained] = string.find(previousContent3, "[%.:][%s%c]*$");
								if (lib !== undefined && lib[cleanContent] !== undefined && chained === undefined) {
									// indexing a builtin lib with an existing item, treat as a builtin
									processedToken = "builtin";
								} else {
									// indexing anything else: color as a member field
									processedToken = "field";
								}
							}
						} else {
							processedToken = "iden";
						}
					} else if (rawToken === "string_inter") {
						const [hasInters] = string.find(content, "[^\\]{");
						if (hasInters === undefined) {
							// this inter string doesn't actually have any inters
							processedToken = "string";
						} else {
							// yield a mix of string and whatever is inside the inters ourselves
							processedToken = undefined;

							let isString = true;
							let subIndex = 1;
							const subSize = content.size();
							while (subIndex <= subSize) {
								const [subStart, subFinish] = string.find(content, "^.-[^\\][{}]", subIndex);
								if (subStart === undefined) {
									// no more braces, all string
									coroutine.yield("string", content.sub(subIndex));
									break;
								}

								if (isString) {
									subIndex = (subFinish as number) + 1;
									coroutine.yield("string", content.sub(subStart, subFinish as number));
									isString = false;
								} else {
									subIndex = subFinish as number;
									const subContent = content.sub(subStart, (subFinish as number) - 1);
									for (const [innerToken, innerContent] of scan(subContent)) {
										coroutine.yield(innerToken, innerContent);
									}
									isString = true;
								}
							}
						}
					}

					// record the last 3 tokens for the indexing context check
					previousContent3 = previousContent2;
					previousContent2 = previousContent1;
					previousContent1 = content;
					previousToken = processedToken ?? rawToken;
					if (processedToken !== undefined) {
						coroutine.yield(processedToken, content);
					}
					break;
				}

				if (!matched) return;
			}
		});

		return (() => {
			if (coroutine.status(thread) === "dead") return undefined;

			const [success, token, content] = coroutine.resume(thread) as LuaTuple<
				[boolean, string | undefined, string | undefined]
			>;
			if (success && token !== undefined) return $tuple(token, content as string);
			return undefined;
		}) as IterableFunction<LuaTuple<[token: string, content: string]>>;
	}
}
