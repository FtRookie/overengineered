import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

class ArithmeticExpressionEvaluator {
	private str = "1 + ( 2 - 3 )";
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
			x = tonumber(this.str.sub(startPos, this.pos));
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

	private degreesToRadians(degrees: number): number {
		const pi = math.pi;
		return degrees * (pi / 180);
	}
}

const definition = {
	inputOrder: ["equation", "value1", "value2", "value3", "value4", "value5", "value6", "value7", "value8"],
	input: {
		equation: {
			displayName: "Equation",
			tooltip: "The equation in string format",
			types: BlockConfigDefinitions.string,
		},

		value1: {
			displayName: "Value 1",
			types: {
				number: { config: 1 },
			},
		},
		value2: {
			displayName: "Value 2",
			types: {
				number: { config: 2 },
			},
		},
		value3: {
			displayName: "Value 3",
			types: {
				number: { config: 3 },
			},
		},
		value4: {
			displayName: "Value 4",
			types: {
				number: { config: 4 },
			},
		},
		value5: {
			displayName: "Value 5",
			types: {
				number: { config: 5 },
			},
		},
		value6: {
			displayName: "Value 6",
			types: {
				number: { config: 6 },
			},
		},
		value7: {
			displayName: "Value 7",
			types: {
				number: { config: 7 },
			},
		},
		value8: {
			displayName: "Value 8",
			types: {
				number: { config: 8 },
			},
		},
	},
	output: {
		result: {
			displayName: "Output",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		const evaluator = new ArithmeticExpressionEvaluator();
		this.onRecalcInputs(({ equation, value1, value2, value3, value4, value5, value6, value7, value8 }) => {
			const expr = equation
				.gsub("value1", value1)[0]
				.gsub("value2", value2)[0]
				.gsub("value3", value3)[0]
				.gsub("value4", value4)[0]
				.gsub("value5", value5)[0]
				.gsub("value6", value6)[0]
				.gsub("value7", value7)[0]
				.gsub("value8", value8)[0]; // Sorry kid, Readability wasn't part of the deal.
			const result = evaluator.evaluate(expr);
			if (!result) this.output.result.unset();
			else this.output.result.set("number", result);
		});
	}
}

export const FunctionBlock = {
	...BlockCreation.defaults,
	id: "functionblock",
	displayName: "Function Block",
	description: "Solves a given equation with given values",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
