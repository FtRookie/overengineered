import { ImplicitMultiplication } from "shared/utils/ImplicitMultiplication";

export namespace Expression {
	const isNumberChar = (c: string) => (c >= "0" && c <= "9") || c === ".";

	/**
	 * Evaluates a basic arithmetic expression — `+ - * /`, parentheses and unary signs — so a value box can
	 * take `2*3` or `1/4` instead of a pre-computed number. Implicit multiplication is expanded first, so
	 * `2(3+4)` works too. Returns undefined for a malformed expression or a non-finite result (`1/0`, `0/0`).
	 */
	export function evaluate(input: string): number | undefined {
		// expand runs on the stripped text and separates with spaces, which this parser does not skip
		const text = ImplicitMultiplication.expand(input.gsub("%s+", "")[0], {}).gsub("%s+", "")[0];
		if (text.size() === 0) return undefined;

		let pos = 1;
		let failed = false;
		const peek = () => (pos <= text.size() ? text.sub(pos, pos) : "");

		function parseNumber(): number {
			const start = pos;
			while (isNumberChar(peek())) pos++;

			const parsed = pos > start ? tonumber(text.sub(start, pos - 1)) : undefined;
			if (parsed === undefined) failed = true;
			return parsed ?? 0;
		}

		function parseFactor(): number {
			const c = peek();
			if (c === "-") {
				pos++;
				return -parseFactor();
			}
			if (c === "+") {
				pos++;
				return parseFactor();
			}
			if (c === "(") {
				pos++;
				const value = parseExpr();
				if (peek() === ")") {
					pos++;
				} else {
					failed = true;
				}
				return value;
			}
			return parseNumber();
		}

		function parseTerm(): number {
			let value = parseFactor();
			while (true as boolean) {
				const c = peek();
				if (c === "*") {
					pos++;
					value *= parseFactor();
				} else if (c === "/") {
					pos++;
					value /= parseFactor();
				} else {
					break;
				}
			}
			return value;
		}

		function parseExpr(): number {
			let value = parseTerm();
			while (true as boolean) {
				const c = peek();
				if (c === "+") {
					pos++;
					value += parseTerm();
				} else if (c === "-") {
					pos++;
					value -= parseTerm();
				} else {
					break;
				}
			}
			return value;
		}

		const result = parseExpr();

		// A leftover position means characters the grammar could not consume (`2)`, `2 3`, `abc`).
		if (failed || pos <= text.size()) return undefined;
		// nan (0/0) fails self-comparison; huge is ±inf (1/0).
		if (result !== result || result === math.huge || result === -math.huge) return undefined;
		return result;
	}
}
