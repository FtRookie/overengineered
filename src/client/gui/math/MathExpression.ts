import { errorResponse } from "engine/shared/Responses";
import { FunctionEnvironment } from "shared/utils/FunctionEnvironment";
import { ImplicitMultiplication } from "shared/utils/ImplicitMultiplication";

/**
 * Parses the subset of Luau the Function Block accepts into a tree the math preview can draw.
 *
 * Precedence mirrors Luau exactly: the preview must never accept what the block rejects, so no liberties.
 * Implicit multiplication is expanded with the same function the block uses, so the two cannot drift.
 * Free of Roblox imports, so it runs outside Studio.
 */
export namespace MathExpression {
	export type Span = { readonly from: number; readonly to: number };

	export type Node =
		| { readonly kind: "number"; readonly value: number; readonly span: Span }
		| { readonly kind: "name"; readonly text: string; readonly span: Span }
		| { readonly kind: "unary"; readonly op: string; readonly operand: Node; readonly span: Span }
		| {
				readonly kind: "binary";
				readonly op: string;
				readonly left: Node;
				readonly right: Node;
				readonly span: Span;
		  }
		| { readonly kind: "call"; readonly callee: string; readonly args: readonly Node[]; readonly span: Span }
		| { readonly kind: "function"; readonly params: readonly string[]; readonly body: Node; readonly span: Span };

	type TokenKind = "number" | "name" | "op" | "eof";
	type Token = { readonly kind: TokenKind; readonly text: string; readonly from: number; readonly to: number };

	/** Longest first, so `<=` is never read as `<` followed by `=`. */
	const operators = [
		"<=",
		">=",
		"==",
		"~=",
		"..",
		"//",
		"+",
		"-",
		"*",
		"/",
		"%",
		"^",
		"(",
		")",
		",",
		"<",
		">",
		"#",
		".",
	];

	/**
	 * `left` is what the operator must bind to be taken; `right` is what its operand is parsed with. A left
	 * associative operator takes `left + 1`, so an equal one behind it stops; a right associative one takes
	 * `left`, so an equal one is folded into the operand. Levels are spaced to leave room for the `+ 1`.
	 */
	const binaryPrecedence: { readonly [op: string]: { readonly left: number; readonly right: number } } = {
		or: { left: 10, right: 11 },
		and: { left: 20, right: 21 },
		"<": { left: 30, right: 31 },
		">": { left: 30, right: 31 },
		"<=": { left: 30, right: 31 },
		">=": { left: 30, right: 31 },
		"~=": { left: 30, right: 31 },
		"==": { left: 30, right: 31 },
		// concat sits below arithmetic in Luau, associates rightwards
		"..": { left: 40, right: 40 },
		"+": { left: 50, right: 51 },
		"-": { left: 50, right: 51 },
		"*": { left: 60, right: 61 },
		"/": { left: 60, right: 61 },
		"//": { left: 60, right: 61 },
		"%": { left: 60, right: 61 },
		// above unary and rightwards, so `-x^2` is `-(x^2)` and `2^3^2` is `2^(3^2)`
		"^": { left: 80, right: 80 },
	};
	/** Binding of the prefix operators, exported for the same paren decision a caller makes for binary ones. */
	export const unaryPrecedence = 70;

	/**
	 * Binding of a binary operator, for a caller deciding which parentheses a tree actually needs. `right`
	 * above `left` means the operator associates leftwards, so an equal operator on its right needs bracketing.
	 */
	export function precedenceOf(op: string): { readonly left: number; readonly right: number } | undefined {
		return binaryPrecedence[op];
	}

	const isDigit = (c: string) => c >= "0" && c <= "9";
	const isNameStart = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
	const isNamePart = (c: string) => isNameStart(c) || isDigit(c);

	function tokenize(text: string): Response<{ readonly tokens: readonly Token[] }> {
		const tokens: Token[] = [];
		const size = text.size();
		let i = 1;
		const at = (index: number) => (index <= size ? text.sub(index, index) : "");

		while (i <= size) {
			const c = at(i);
			if (c === " " || c === "\t" || c === "\n" || c === "\r") {
				i++;
				continue;
			}

			const start = i;

			if (isDigit(c) || (c === "." && isDigit(at(i + 1)))) {
				if (c === "0" && (at(i + 1) === "x" || at(i + 1) === "X")) {
					i += 2;
					while (i <= size && (isDigit(at(i)) || (at(i).lower() >= "a" && at(i).lower() <= "f"))) i++;
				} else {
					while (i <= size && isDigit(at(i))) i++;
					if (at(i) === ".") {
						i++;
						while (i <= size && isDigit(at(i))) i++;
					}
					if (at(i) === "e" || at(i) === "E") {
						i++;
						if (at(i) === "+" || at(i) === "-") i++;
						while (i <= size && isDigit(at(i))) i++;
					}
				}

				const raw = text.sub(start, i - 1);
				if (tonumber(raw) === undefined) {
					return errorResponse(`Malformed number '${raw}' at ${start}`);
				}

				tokens.push({ kind: "number", text: raw, from: start, to: i - 1 });
				continue;
			}

			if (isNameStart(c)) {
				while (i <= size && isNamePart(at(i))) i++;
				tokens.push({ kind: "name", text: text.sub(start, i - 1), from: start, to: i - 1 });
				continue;
			}

			let matched: string | undefined;
			for (const op of operators) {
				if (text.sub(i, i + op.size() - 1) === op) {
					matched = op;
					break;
				}
			}
			if (matched === undefined) {
				return errorResponse(`Unexpected '${c}' at ${start}`);
			}

			i += matched.size();
			tokens.push({ kind: "op", text: matched, from: start, to: i - 1 });
		}

		tokens.push({ kind: "eof", text: "", from: size + 1, to: size });
		return { success: true, tokens };
	}

	/** Thrown internally and caught at the entry point; the parser never surfaces an error to callers. */
	type ParseFailure = { readonly message: string };

	export function parse(text: string): Response<{ readonly node: Node }> {
		// spans are relative to the expanded text; no caller reads them, and parsing the same string the
		// block compiles is what keeps the preview from rejecting what the block accepts
		const lexed = tokenize(ImplicitMultiplication.expand(text, FunctionEnvironment.baseEnv));
		if (!lexed.success) return lexed;

		const tokens = lexed.tokens;
		let pos = 0;

		const peek = () => tokens[pos];
		const advance = () => tokens[pos++];
		const fail = (message: string): never => {
			throw { message } as ParseFailure;
		};
		const expect = (kind: TokenKind, value: string) => {
			const token = peek();
			if (token.kind !== kind || token.text !== value) {
				fail(`Expected '${value}' at ${token.from}`);
			}

			return advance();
		};
		const spanning = (from: Node | Token, to: Node | Token): Span => ({
			from: "span" in from ? from.span.from : from.from,
			to: "span" in to ? to.span.to : to.to,
		});

		function parseFunction(keyword: Token): Node {
			expect("op", "(");

			const params: string[] = [];
			while (peek().text !== ")") {
				const name = peek();
				if (name.kind !== "name") fail(`Expected a parameter name at ${name.from}`);
				advance();
				params.push(name.text);

				if (peek().text !== ",") break;
				advance();
			}
			expect("op", ")");

			// only `function(...) return <expression> end` is modelled; a statement body is not an expression,
			// so the parse fails and the caller shows the raw text
			expect("name", "return");
			const body = parseExpression(0);
			const finish = expect("name", "end");

			return { kind: "function", params, body, span: spanning(keyword, finish) };
		}

		function parsePrimary(): Node {
			const token = advance();

			if (token.kind === "number") {
				return { kind: "number", value: tonumber(token.text)!, span: spanning(token, token) };
			}

			if (token.kind === "op" && token.text === "(") {
				const inner = parseExpression(0);
				expect("op", ")");

				// grouping is not kept: the tree encodes it; the renderer re-derives which parentheses are
				// needed from precedence
				return inner;
			}

			if (token.kind === "name") {
				if (token.text === "function") {
					return parseFunction(token);
				}

				// `a.b` is folded into one name, not indexing; nothing in the block's environment is a
				// table, so it can only be drawn as a plain identifier
				let name = token.text;
				let last = token;
				while (peek().text === "." && tokens[pos + 1]?.kind === "name") {
					advance();
					last = advance();
					name += `.${last.text}`;
				}

				if (peek().text !== "(") {
					return { kind: "name", text: name, span: spanning(token, last) };
				}

				advance();
				const args: Node[] = [];
				while (peek().text !== ")") {
					args.push(parseExpression(0));
					if (peek().text !== ",") break;
					advance();
				}
				const finish = expect("op", ")");

				return { kind: "call", callee: name, args, span: spanning(token, finish) };
			}

			return fail(token.kind === "eof" ? "Unexpected end of expression" : `Unexpected '${token.text}'`);
		}

		function parseUnary(): Node {
			const token = peek();
			const isUnary =
				(token.kind === "op" && (token.text === "-" || token.text === "#")) ||
				(token.kind === "name" && token.text === "not");
			if (!isUnary) return parsePrimary();

			advance();
			const operand = parseExpression(unaryPrecedence);
			return { kind: "unary", op: token.text, operand, span: spanning(token, operand) };
		}

		function parseExpression(minPrecedence: number): Node {
			let left = parseUnary();

			while (true as boolean) {
				const token = peek();
				if (token.kind === "eof") break;

				// `and`/`or` arrive as names, but neither can be an identifier, so the text alone identifies them
				const precedence = binaryPrecedence[token.text];
				if (precedence === undefined || precedence.left < minPrecedence) break;

				advance();
				const right = parseExpression(precedence.right);
				left = { kind: "binary", op: token.text, left, right, span: spanning(left, right) };
			}

			return left;
		}

		const [ok, result] = pcall(() => {
			const node = parseExpression(0);
			const trailing = peek();
			if (trailing.kind !== "eof") {
				fail(`Unexpected '${trailing.text}' at ${trailing.from}`);
			}

			return node;
		});

		if (!ok) {
			const failure = result as ParseFailure | string;
			return errorResponse(typeIs(failure, "table") ? failure.message : tostring(failure));
		}

		return { success: true, node: result as Node };
	}
}
