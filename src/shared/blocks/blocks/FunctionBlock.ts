import { ReplicatedStorage } from "@rbxts/services";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const vLuau = require(ReplicatedStorage.Modules.vLuau) as {
	luau_execute: (code: string, env: unknown) => LuaTuple<[start: () => void, close: () => void]>;
};

const baseEnv = { ...math };
delete (baseEnv as Partial<typeof baseEnv>).randomseed;

const safeEnv = setmetatable(
	{},
	{
		__index: baseEnv as never,
		__newindex: (_, key, value) => {
			if (baseEnv[key as never] !== undefined) {
				error("Attempt to overwrite protected key: " + tostring(key), 2);
			}
			rawset(baseEnv, key, value);
		},
	},
);

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

		let func:
			| ((a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number)
			| undefined;
		this.onkFirstInputs(["expression"], ({ expression }) => {
			if (expression.trim().contains("\n")) {
				this.disableAndBurn();
				return;
			}

			expression = `
				return function(${inputVars.join(", ")})
					return ${expression}
				end
			`;

			try {
				const [bytecode] = vLuau.luau_execute(expression, safeEnv);
				func = bytecode() as unknown as typeof func;
			} catch (err) {
				this.disableAndBurn();
				return;
			}
		});

		this.onRecalcInputs(({ input1, input2, input3, input4, input5, input6, input7, input8 }) => {
			if (!func) return;

			const res = func(input1, input2, input3, input4, input5, input6, input7, input8);
			this.output.result.set("number", res);
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
