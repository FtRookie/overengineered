export namespace ImplicitMultiplication {
	// Longest first: "2e5" must scan as one number, or the exponent becomes the input variable e.
	const numberPatterns = ["^0[xX][%x_]+", "^%d+%.?%d*[eE][%+%-]?%d+", "^%.%d+[eE][%+%-]?%d+", "^%d+%.?%d*", "^%.%d+"];
	const NAME = "^[%a_][%w_]*";

	// a keyword neither ends nor starts a value, so "function(i)" stays a call and "return a" stays a return
	const keywords: { readonly [word: string]: true } = {
		and: true,
		break: true,
		do: true,
		else: true,
		elseif: true,
		end: true,
		false: true,
		for: true,
		function: true,
		if: true,
		in: true,
		local: true,
		nil: true,
		not: true,
		or: true,
		repeat: true,
		return: true,
		then: true,
		true: true,
		until: true,
		while: true,
	};

	type Kind = "number" | "name" | "other";
	type Token = { readonly kind: Kind; readonly text: string };

	const scan = (source: string): Token[] => {
		const tokens: Token[] = [];
		let pos = 1;

		while (pos <= source.size()) {
			let matched = false;

			for (const pattern of numberPatterns) {
				const [start, finish] = string.find(source, pattern, pos);
				if (start === undefined) continue;

				tokens.push({ kind: "number", text: source.sub(start, finish as number) });
				pos = (finish as number) + 1;
				matched = true;
				break;
			}
			if (matched) continue;

			const [nameStart, nameFinish] = string.find(source, NAME, pos);
			if (nameStart !== undefined) {
				tokens.push({ kind: "name", text: source.sub(nameStart, nameFinish as number) });
				pos = (nameFinish as number) + 1;
				continue;
			}

			tokens.push({ kind: "other", text: source.sub(pos, pos) });
			pos++;
		}

		return tokens;
	};

	const isSplittable = (name: string) => {
		if (name.size() < 2) return false;

		for (let i = 1; i <= name.size(); i++) {
			const c = name.sub(i, i);
			if (c < "a" || c > "h") return false;
		}

		return true;
	};

	/**
	 * Inserts the multiplication the Function Block's Luau grammar requires but a player writing maths would
	 * leave out: `2a`, `3(a+b)`, `(a+b)(c-d)` and `ab`.
	 *
	 * `reserved` is the block's environment. A name in it keeps its call parentheses, so `sin(x)` is a call
	 * while `a(x)` is a product, and it is never split into single letters, which is what keeps `deg` — the
	 * one environment name spelled entirely from the input variables a..h — intact.
	 */
	export function expand(expression: string, reserved: { readonly [name: string]: unknown }): string {
		const tokens = scan(expression);
		const out: string[] = [];

		let previous: Token | undefined;
		let afterDot = false;

		for (const token of tokens) {
			const previousKeyword = previous?.kind === "name" && keywords[previous.text] !== undefined;
			const tokenKeyword = token.kind === "name" && keywords[token.text] !== undefined;
			const endsValue =
				previous !== undefined &&
				!previousKeyword &&
				(previous.kind === "number" || previous.kind === "name" || previous.text === ")");
			const startsValue =
				!tokenKeyword && (token.kind === "number" || token.kind === "name" || token.text === "(");

			// a call keeps its parentheses; anything else adjacent to "(" is a product
			const isCall =
				token.text === "(" && previous?.kind === "name" && (afterDot || reserved[previous.text] !== undefined);

			if (
				previous !== undefined &&
				endsValue &&
				startsValue &&
				!isCall &&
				previous.text !== "." &&
				token.text !== "."
			) {
				out.push(" * ");
			}

			if (token.kind === "name" && !afterDot && reserved[token.text] === undefined && isSplittable(token.text)) {
				const letters: string[] = [];
				for (let i = 1; i <= token.text.size(); i++) {
					letters.push(token.text.sub(i, i));
				}
				out.push(letters.join(" * "));
			} else {
				out.push(token.text);
			}

			afterDot = token.text === ".";
			previous = token;
		}

		return out.join("");
	}
}
