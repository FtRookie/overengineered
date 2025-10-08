import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

class ArithmeticExpressionEvaluator {
	static INVALID_NUMBER = 2147483647;
	str = "1 + ( 2 - 3 )";
	pos = 0;
	ch = "0";

	evaluate(expression: string): number {
		return this.evaluateAll(expression, false);
	}

	evaluateAll(expression: string, resultIsInteger: boolean): number {
		this.str = expression;
		this.pos = 0;
		const outcome = this.parse();
		if (resultIsInteger) {
			return math.round(outcome);
		}
		return outcome;
	}

	nextChar() {
		this.ch = ++this.pos <= this.str.size() ? this.str.sub(this.pos, this.pos) : "";
	}

	eat(charToEat: string): boolean {
		while (this.ch === " ") {
			this.nextChar();
		}
		if (this.ch === charToEat) {
			this.nextChar();
			return true;
		}
		return false;
	}

	parse(): number {
		this.nextChar();
		const x = this.parseExpression();
		if (this.pos <= this.str.size()) {
			return ArithmeticExpressionEvaluator.INVALID_NUMBER;
		}
		return x;
	}

	parseExpression(): number {
		let x = this.parseTerm();
		for (;;) {
			if (this.eat("+")) {
				// addition
				x += this.parseTerm();
			} else if (this.eat("-")) {
				// subtraction
				x -= this.parseTerm();
			} else {
				return x;
			}
		}
	}

	parseTerm(): number {
		let x = this.parseFactor();
		for (;;) {
			if (this.eat("*")) {
				// multiplication
				x *= this.parseFactor();
			} else if (this.eat("/")) {
				// division
				x /= this.parseFactor();
			} else {
				return x;
			}
		}
	}

	parseFactor(): number {
		if (this.eat("+")) {
			// unary plus
			return this.parseFactor();
		}
		if (this.eat("-")) {
			// unary minus
			return -this.parseFactor();
		}
		let x = 0;
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
			x = tonumber(this.str.sub(startPos, this.pos)) ?? ArithmeticExpressionEvaluator.INVALID_NUMBER;
		} else {
			return ArithmeticExpressionEvaluator.INVALID_NUMBER;
		}
		if (this.eat("^")) {
			// exponentiation
			x = math.pow(x, this.parseFactor());
		}
		return x;
	}

	degreesToRadians(degrees: number): number {
		const pi = math.pi;
		return degrees * (pi / 180);
	}
}

const definition = {
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

		this.on(({ equation, value1, value2, value3 }) => {
			const evaluator = new ArithmeticExpressionEvaluator();
			const expr = equation.gsub("value1", value1)[0].gsub("value2", value2)[0].gsub("value3", value3)[0];
			const result = evaluator.evaluate(expr);
			if (result === 2147483647) this.output.result.unset();
			else this.output.result.set("number", result);
		});
	}
}

export const FunctionBlock = {
	...BlockCreation.defaults,
	id: "function",
	displayName: "Function Block",
	description: "Solves a given equation with given values",
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("DoubleGenericLogicBlockPrefab", "func"),
		category: () => BlockCreation.Categories.math,
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
