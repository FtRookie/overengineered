import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

class ArithmeticExpressionEvaluator {
	private str = "";
	private pos = 0;
	private ch = "0";

	evaluate(expression: string, resultIsInteger: boolean = false): number | undefined {
		this.str = expression;
		this.pos = 0;
		const outcome = this.parse();
		if (!outcome) {
			return outcome;
		}

		if (resultIsInteger) {
			return math.round(outcome);
		}
		return outcome;
	}

	private nextChar() {
		this.ch = ++this.pos <= this.str.size() ? this.str.sub(this.pos, this.pos) : "";
	}

	private eat(charToEat: string): boolean {
		while (this.ch === " ") {
			this.nextChar();
		}
		if (this.ch === charToEat) {
			this.nextChar();
			return true;
		}
		return false;
	}

	private parse(): number | undefined {
		this.nextChar();
		const x = this.parseExpression();
		if (this.pos <= this.str.size()) {
			return undefined;
		}

		return x;
	}

	private parseExpression(): number | undefined {
		let x = this.parseTerm();
		if (!x) return x;

		for (;;) {
			if (this.eat("+")) {
				// addition
				const term = this.parseTerm();
				if (!term) return term;
				x += term;
			} else if (this.eat("-")) {
				// subtraction
				const term = this.parseTerm();
				if (!term) return term;
				x -= term;
			} else {
				return x;
			}
		}
	}

	private parseTerm(): number | undefined {
		let x = this.parseFactor();
		if (!x) return x;

		for (;;) {
			if (this.eat("*")) {
				// multiplication
				const factor = this.parseFactor();
				if (!factor) return factor;
				x *= factor;
			} else if (this.eat("/")) {
				// division
				const factor = this.parseFactor();
				if (!factor) return factor;
				x /= factor;
			} else {
				return x;
			}
		}
	}

	private parseFactor(): number | undefined {
		if (this.eat("+")) {
			// unary plus
			return this.parseFactor();
		}
		if (this.eat("-")) {
			// unary minus
			const factor = this.parseFactor();
			if (!factor) return factor;
			return -factor;
		}
		let x: number | undefined = undefined;
		const startPos = this.pos;
		if (this.eat("(")) {
			// parentheses
			x = this.parseExpression();
			this.eat(")");
		} else if ((this.ch >= "0" && this.ch <= "9") || this.ch === ".") {
			// numbers
			while ((this.ch >= "0" && this.ch <= "9") || this.ch === ".") {
				this.nextChar();
			}
			x = tonumber(this.str.sub(startPos, this.pos - 1));
		}
		if (!x) return x;

		if (this.eat("^")) {
			// exponentiation
			const factor = this.parseFactor();
			if (!factor) return undefined;

			x = math.pow(x, factor);
		}
		return x;
	}
}

const inputVars = ["a", "b", "c", "d", "e", "f", "g", "h"];
const definition = {
	inputOrder: ["expression", "input1", "input2", "input3", "input4", "input5", "input6", "input7", "input8"],
	input: {
		expression: {
			displayName: "Expression",
			tooltip: "The expression in string format",
			types: {
				string: {
					config: "a + (b - c)",
				},
			},
		},

		input1: {
			displayName: inputVars[0],
			types: {
				number: { config: 0 },
			},
		},
		input2: {
			displayName: inputVars[1],
			types: {
				number: { config: 1 },
			},
		},
		input3: {
			displayName: inputVars[2],
			types: {
				number: { config: 2 },
			},
		},
		input4: {
			displayName: inputVars[3],
			types: {
				number: { config: 3 },
			},
		},
		input5: {
			displayName: inputVars[4],
			types: {
				number: { config: 4 },
			},
		},
		input6: {
			displayName: inputVars[5],
			types: {
				number: { config: 5 },
			},
		},
		input7: {
			displayName: inputVars[6],
			types: {
				number: { config: 6 },
			},
		},
		input8: {
			displayName: inputVars[7],
			types: {
				number: { config: 7 },
			},
		},
	},
	output: {
		result: {
			displayName: "Result",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		const evaluator = new ArithmeticExpressionEvaluator();
		this.onRecalcInputs(({ expression, input1, input2, input3, input4, input5, input6, input7, input8 }) => {
			// numbers like 3.4359394771105e+18 break the parsing, this makes them always be a normal number
			const tostr = (num: number) => "%.15f".format(num);

			const expr = expression
				.gsub(inputVars[0], tostr(input1))[0]
				.gsub(inputVars[1], tostr(input2))[0]
				.gsub(inputVars[2], tostr(input3))[0]
				.gsub(inputVars[3], tostr(input4))[0]
				.gsub(inputVars[4], tostr(input5))[0]
				.gsub(inputVars[5], tostr(input6))[0]
				.gsub(inputVars[6], tostr(input7))[0]
				.gsub(inputVars[7], tostr(input8))[0];

			const result = evaluator.evaluate(expr);
			if (!result) this.disableAndBurn();
			else this.output.result.set("number", result);
		});
	}
}

export const FunctionBlock = {
	...BlockCreation.defaults,
	id: "functionblock",
	displayName: "Function Block",
	description: "Solves the given expression using the provided variables.",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
