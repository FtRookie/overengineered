import { RunService } from "@rbxts/services";
import { Colors } from "engine/shared/Colors";
import { MathUtils } from "engine/shared/fixes/MathUtils";
import { CalculatableBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockLogicValueResults } from "shared/blockLogic/BlockLogicValueStorage";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type {
	BlockLogicBothDefinitions,
	BlockLogicArgs,
	AllInputKeysToObject,
	AllOutputKeysToObject,
	BlockLogicFullBothDefinitions,
	BlockLogicFullInputDef,
} from "shared/blockLogic/BlockLogic";
import type {
	BlockBuildersWithoutIdAndDefaults,
	BlockCategoryPath,
	BlockLogicInfo,
	BlockModelSource,
} from "shared/blocks/Block";

type CalcFunc<TDef extends BlockLogicBothDefinitions> = (
	inputs: AllInputKeysToObject<TDef["input"]>,
	block: AutoCalculatableBlock<TDef>,
) => AllOutputKeysToObject<TDef["output"]> | BlockLogicValueResults;

class AutoCalculatableBlock<TDef extends BlockLogicBothDefinitions> extends CalculatableBlockLogic<TDef> {
	constructor(
		definition: TDef,
		args: BlockLogicArgs,
		private readonly calcfunc: CalcFunc<TDef>,
	) {
		super(definition, args);
	}

	protected override calculate(
		inputs: AllInputKeysToObject<TDef["input"]>,
	): AllOutputKeysToObject<TDef["output"]> | BlockLogicValueResults {
		return this.calcfunc(inputs, this);
	}
}
const logic = <TDef extends BlockLogicFullBothDefinitions>(definition: TDef, calcfunc: CalcFunc<TDef>) => {
	class ctor extends AutoCalculatableBlock<TDef> {
		constructor(args: BlockLogicArgs) {
			super(definition, args, calcfunc);
		}
	}

	return { definition, ctor } satisfies BlockLogicInfo;
};

const autoModel = (prefab: BlockCreation.Model.PrefabName, text: string, category: BlockCategoryPath) => {
	return {
		model: BlockCreation.Model.fAutoCreated(prefab, text),
		category: () => category,
	} satisfies BlockModelSource;
};

const categories = BlockCreation.Categories;

//

type BLFID = Partial<Omit<BlockLogicFullInputDef, "displayName" | "types">>;
const defpartsf = {
	any: (name: string, rest?: BLFID) => ({
		displayName: name,
		types: BlockConfigDefinitions.any,
		...(rest ?? {}),
	}),
	number: (name: string, rest?: BLFID) => ({
		displayName: name,
		types: BlockConfigDefinitions.number,
		...(rest ?? {}),
	}),
	string: (name: string, rest?: BLFID) => ({
		displayName: name,
		types: BlockConfigDefinitions.string,
		...(rest ?? {}),
	}),
	bool: (name: string, rest?: BLFID) => ({
		displayName: name,
		types: BlockConfigDefinitions.bool,
		...(rest ?? {}),
	}),
	byte: (name: string, rest?: BLFID) => ({
		displayName: name,
		types: BlockConfigDefinitions.byte,
		...(rest ?? {}),
	}),
	vector3: (name: string, rest?: BLFID) => ({
		displayName: name,
		types: BlockConfigDefinitions.vector3,
		...(rest ?? {}),
	}),
	color: (name: string, rest?: BLFID) => ({
		displayName: name,
		types: BlockConfigDefinitions.color,
		...(rest ?? {}),
	}),
	numberOrByte: (name: string, rest?: BLFID) => ({
		displayName: name,
		types: {
			...BlockConfigDefinitions.number,
			...BlockConfigDefinitions.byte,
		},
		...(rest ?? {}),
	}),
} as const satisfies {
	readonly [k in string]: (name: string, rest?: BLFID) => BlockLogicFullInputDef;
};
const defs = {
	equality: {
		inputOrder: ["value1", "value2"],
		input: {
			value1: {
				displayName: "Value 1",
				types: {
					number: { config: 0 },
					bool: { config: false },
					byte: { config: 0 },
					string: { config: "" },
					vector3: { config: Vector3.zero },
					color: { config: new Color3() },
				},
				group: "0",
			},
			value2: {
				displayName: "Value 2",
				types: {
					number: { config: 0 },
					bool: { config: false },
					byte: { config: 0 },
					string: { config: "" },
					vector3: { config: Vector3.zero },
					color: { config: new Color3() },
				},
				group: "0",
			},
		},
		output: {
			result: {
				displayName: "Result",
				types: ["bool"],
			},
		},
	},
	num2_bool: {
		inputOrder: ["value1", "value2"],
		input: {
			value1: defpartsf.number("Value 1"),
			value2: defpartsf.number("Value 2"),
		},
		output: {
			result: {
				displayName: "Result",
				types: ["bool"],
			},
		},
	},
	num1_num: {
		input: {
			value: defpartsf.number("Value"),
		},
		output: {
			result: {
				displayName: "Result",
				types: ["number"],
			},
		},
	},
	numOrVec1_numOrVec: {
		input: {
			value: {
				displayName: "Value",
				group: "1",
				types: {
					vector3: {
						config: Vector3.zero,
					},
					number: {
						config: 0,
					},
				},
			},
		},
		output: {
			result: {
				displayName: "Result",
				group: "1",
				types: ["number", "vector3"],
			},
		},
	},
	num2_num: {
		inputOrder: ["value1", "value2"],
		input: {
			value1: defpartsf.number("Value 1"),
			value2: defpartsf.number("Value 2"),
		},
		output: {
			result: {
				displayName: "Result",
				types: ["number"],
			},
		},
	},
	numvec2_numvec: {
		inputOrder: ["value1", "value2"],
		input: {
			value1: {
				displayName: "Value 1",
				types: {
					number: { config: 0 },
					vector3: { config: Vector3.zero },
				},
				group: "0",
			},
			value2: {
				displayName: "Value 2",
				types: {
					number: { config: 0 },
					vector3: { config: Vector3.zero },
				},
				group: "0",
			},
		},
		output: {
			result: {
				displayName: "Result",
				types: ["number", "vector3"],
				group: "0",
			},
		},
	},
	byte1_byte: {
		input: {
			value: defpartsf.byte("Value"),
		},
		output: {
			result: {
				displayName: "Result",
				types: ["byte"],
			},
		},
	},
	byte2_byte: {
		inputOrder: ["value1", "value2"],
		input: {
			value1: defpartsf.byte("Value 1"),
			value2: defpartsf.byte("Value 2"),
		},
		output: {
			result: {
				displayName: "Result",
				types: ["byte"],
			},
		},
	},
	byteshift: {
		inputOrder: ["value1", "value2"],
		input: {
			value1: defpartsf.byte("Value"),
			value2: defpartsf.byte("Shift"),
		},
		output: {
			result: {
				displayName: "Result",
				types: ["byte"],
			},
		},
	},
	constnum: {
		input: {},
		output: {
			value: {
				displayName: "Value",
				types: ["number"],
			},
		},
	},
} as const satisfies { readonly [k in string]: BlockLogicFullBothDefinitions };

//

const constants = {
	constant: {
		displayName: "Constant",
		description: "Returns the configured value, forever",
		modelSource: autoModel("ConstLogicBlockPrefab", "CONST", BlockCreation.Categories.other),
		logic: logic(
			{
				input: {
					value: {
						displayName: "Value",
						group: "0",
						types: BlockConfigDefinitions.any,
						connectorHidden: true,
					},
				},
				output: {
					result: {
						displayName: "Result",
						group: "0",
						types: asMap(BlockConfigDefinitions.any).keys(),
					},
				},
			},
			(input) => ({ result: { type: input.valueType, value: input.value } }),
		),
	},
	pi: {
		displayName: "Pi",
		description: `So called "free thinkers" will make a thousand Pie jokes as soon as they'll see the Pi constant..`,
		modelSource: autoModel("ConstLogicBlockPrefab", "π", BlockCreation.Categories.other),
		logic: logic(defs.constnum, () => ({ value: { type: "number", value: math.pi } })),
	},
	e: {
		displayName: "Euler's number (e)",
		description: "Very useful constant you'll probably never use if you doesn't already know what it is",
		modelSource: autoModel("ConstLogicBlockPrefab", "e", BlockCreation.Categories.other),
		logic: logic(defs.constnum, () => ({ value: { type: "number", value: MathUtils.e } })),
	},
} as const satisfies BlockBuildersWithoutIdAndDefaults;

const maths = {
	negate: {
		displayName: "Negate",
		description: "Converts negative numbers to positive and vice versa",
		modelSource: autoModel("GenericLogicBlockPrefab", "NEG", categories.math),
		search: {
			aliases: ["neg"],
		},
		logic: logic(
			{
				input: {
					value: {
						displayName: "Value",
						types: {
							number: { config: 0 },
							vector3: { config: Vector3.zero },
						},
						group: "0",
					},
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number", "vector3"],
						group: "0",
					},
				},
			},
			({ value, valueType }) => ({
				result: { type: valueType, value: typeIs(value, "number") ? -value : value.mul(-1) },
			}),
		),
	},
	abs: {
		displayName: "Absolute",
		description: "Removes the minus from your number",
		search: { aliases: ["||"] },
		modelSource: autoModel("GenericLogicBlockPrefab", "ABS", categories.math),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value: valueType === "number" ? math.abs(value as number) : (value as Vector3).Abs(),
			},
		})),
	},
	round: {
		displayName: "Round",
		description: "Returns rounded value with a given precision",
		modelSource: autoModel("GenericLogicBlockPrefab", "ROUND", categories.math),
		logic: logic(
			{
				inputOrder: ["value", "precision"],
				input: {
					value: {
						displayName: "Value",
						group: "1",
						types: {
							number: {
								config: 1,
							},
							vector3: {
								config: new Vector3(),
							},
						},
					},
					precision: {
						displayName: "Precision",
						types: {
							number: {
								config: 1,
							},
						},
					},
				},
				output: {
					result: {
						displayName: "Result",
						group: "1",
						types: ["number", "vector3"],
					},
				},
			},
			({ value, precision }) => {
				if (typeIs(value, "number")) {
					return { result: { type: "number", value: MathUtils.round(value, precision) } };
				}
				return { result: { type: "vector3", value: value.apply((v) => MathUtils.round(v, precision)) } };
			},
		),
	},
	floor: {
		displayName: "Floor",
		description: "Rounds down the input number",
		modelSource: autoModel("GenericLogicBlockPrefab", "FLOOR", categories.math),
		logic: logic(defs.numOrVec1_numOrVec, ({ value }) => {
			if (typeIs(value, "number")) {
				return { result: { type: "number", value: math.floor(value) } };
			}

			return { result: { type: "vector3", value: value.apply(math.floor) } };
		}),
	},
	ceil: {
		displayName: "Ceil",
		description: "Rounds up the input number",
		modelSource: autoModel("GenericLogicBlockPrefab", "CEIL", categories.math),
		logic: logic(defs.numOrVec1_numOrVec, ({ value }) => {
			if (typeIs(value, "number")) {
				return { result: { type: "number", value: math.ceil(value) } };
			}

			return { result: { type: "vector3", value: value.apply(math.ceil) } };
		}),
	},
	sign: {
		displayName: "Sign",
		description: "Returns -1 if the value is under 0, 1 if greater than zero, and 0 if value is zero",
		modelSource: autoModel("GenericLogicBlockPrefab", "SIGN", categories.math),
		logic: logic(defs.numOrVec1_numOrVec, ({ value }) => {
			if (typeIs(value, "number")) {
				return { result: { type: "number", value: math.sign(value) } };
			}

			return { result: { type: "vector3", value: value.apply(math.sign) } };
		}),
	},
	sqrt: {
		displayName: "Square Root",
		description: "Square the root out of input value",
		search: { aliases: ["sqrt"] },
		modelSource: autoModel("GenericLogicBlockPrefab", "SQRT", categories.math),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value: valueType === "number" ? math.sqrt(value as number) : (value as Vector3).apply(math.sqrt),
			},
		})),
	},

	lerp: {
		displayName: "Lerp",
		description: "Applies a linear gradient between two values using alpha",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "LERP", categories.math),
		logic: logic(
			{
				inputOrder: ["value1", "value2", "alpha"],
				input: {
					value1: {
						displayName: "Value 1",
						types: {
							number: { config: 0 },
							vector3: { config: Vector3.zero },
							color: { config: Colors.white },
						},
						group: "0",
					},
					value2: {
						displayName: "Value 2",
						types: {
							number: { config: 1 },
							vector3: { config: Vector3.one },
							color: { config: Colors.black },
						},
						group: "0",
					},
					alpha: {
						displayName: "Alpha",
						unit: "0-1",
						types: {
							number: { config: 0 },
						},
					},
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number", "vector3", "color"],
						group: "0",
					},
				},
			},
			({ value1, value2, alpha }, logic) => {
				if (typeIs(value1, "number") && typeIs(value2, "number")) {
					return {
						result: { type: "number", value: new Vector3(value1).Lerp(new Vector3(value2), alpha).X },
					};
				}
				if (typeIs(value1, "Vector3") && typeIs(value2, "Vector3")) {
					return { result: { type: "vector3", value: value1.Lerp(value2, alpha) } };
				}
				if (typeIs(value1, "Color3") && typeIs(value2, "Color3")) {
					return { result: { type: "color", value: value1.Lerp(value2, alpha) } };
				}

				logic.disableAndBurn();
				return BlockLogicValueResults.garbage;
			},
		),
	},

	add: {
		displayName: "Addition",
		description: "What does this block do? I don't know, you guess.",
		search: { aliases: ["+"], partialAliases: ["+="] },
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "ADD", categories.math),
		logic: logic(
			{
				inputOrder: ["value1", "value2"],
				input: {
					value1: {
						displayName: "Value 1",
						types: {
							number: { config: 0 },
							vector3: { config: Vector3.zero },
						},
						group: "0",
					},
					value2: {
						displayName: "Value 2",
						types: {
							number: { config: 0 },
							vector3: { config: Vector3.zero },
						},
						group: "0",
					},
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number", "vector3"],
						group: "0",
					},
				},
			},
			({ value1, value2 }, logic) => {
				if (typeIs(value1, "Vector3") && typeIs(value2, "Vector3")) {
					return { result: { type: "vector3", value: value1.add(value2) } };
				}
				if (typeIs(value1, "Vector3") || typeIs(value2, "Vector3")) {
					logic.disableAndBurn();
					return BlockLogicValueResults.garbage;
				}

				return { result: { type: "number", value: value1 + value2 } };
			},
		),
	},
	sub: {
		displayName: "Subtraction",
		description: "do you realy not know what subtraction is? bruh",
		search: { aliases: ["-", "-="] },
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "SUB", categories.math),
		logic: logic(
			{
				inputOrder: ["value1", "value2"],
				input: {
					value1: {
						displayName: "Value",
						types: {
							number: { config: 0 },
							vector3: { config: Vector3.zero },
						},
						group: "0",
					},
					value2: {
						displayName: "Subtrahend",
						types: {
							number: { config: 0 },
							vector3: { config: Vector3.zero },
						},
						group: "0",
					},
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number", "vector3"],
						group: "0",
					},
				},
			},
			({ value1, value2 }, logic) => {
				if (typeIs(value1, "Vector3") && typeIs(value2, "Vector3")) {
					return { result: { type: "vector3", value: value1.sub(value2) } };
				}
				if (typeIs(value1, "Vector3") || typeIs(value2, "Vector3")) {
					logic.disableAndBurn();
					return BlockLogicValueResults.garbage;
				}

				return { result: { type: "number", value: value1 - value2 } };
			},
		),
	},
	mul: {
		displayName: "Multiplication",
		description: "Returns the result of multiplication of two given values",
		search: { aliases: ["*"] },
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "MUL", categories.math),
		logic: logic(
			{
				inputOrder: ["value1", "value2"],
				input: {
					value1: {
						displayName: "Value 1",
						types: {
							number: { config: 0 },
							vector3: { config: Vector3.zero },
						},
						group: "0",
					},
					value2: {
						displayName: "Value 2",
						types: {
							number: { config: 0 },
							vector3: { config: Vector3.zero },
						},
						group: "0",
					},
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number", "vector3"],
						group: "0",
					},
				},
			},
			({ value1, value2 }) => {
				if (typeIs(value1, "Vector3")) {
					return { result: { type: "vector3", value: value1.mul(value2) } };
				}
				if (typeIs(value2, "Vector3")) {
					return { result: { type: "vector3", value: value2.mul(value1) } };
				}

				return { result: { type: "number", value: value1 * value2 } };
			},
		),
	},
	div: {
		displayName: "Division",
		description: "Returns the result of division of two given values",
		search: { aliases: ["/"], partialAliases: ["frac"] },
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "DIV", categories.math),
		logic: logic(
			{
				inputOrder: ["value1", "value2"],
				input: {
					value1: {
						displayName: "Value",
						types: {
							number: { config: 0 },
							vector3: { config: Vector3.zero },
						},
						group: "0",
					},
					value2: {
						displayName: "Divider",
						types: {
							number: { config: 0 },
							vector3: { config: Vector3.zero },
						},
						group: "0",
					},
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number", "vector3"],
						group: "0",
					},
				},
			},
			({ value1, value2 }, logic) => {
				if (value2 === 0) {
					logic.disableAndBurn();
					return BlockLogicValueResults.garbage;
				}
				if (typeIs(value2, "Vector3") && (value2.X === 0 || value2.Y === 0 || value2.Z === 0)) {
					logic.disableAndBurn();
					return BlockLogicValueResults.garbage;
				}

				if (typeIs(value1, "Vector3")) {
					return { result: { type: "vector3", value: value1.div(value2) } };
				}

				// while we can't mix types easily
				assert(!typeIs(value2, "Vector3"));

				return { result: { type: "number", value: value1 / value2 } };
			},
		),
	},
	mod: {
		displayName: "Mod",
		description: "Returns the remainder of a division",
		search: { aliases: ["%"] },
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "MOD", categories.math),
		logic: logic(defs.num2_num, (inputs, logic) => {
			if (inputs.value2 === 0) {
				logic.disableAndBurn();
				return BlockLogicValueResults.garbage;
			}

			return { result: { type: "number", value: inputs.value1 % inputs.value2 } };
		}),
	},

	nsqrt: {
		displayName: "Custom Degree Root",
		description: "Same as the square root but you're allowed to change the degree of it",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "NSQRT", categories.math),
		logic: logic(
			{
				inputOrder: ["value", "root"],
				input: {
					value: defpartsf.number("Value"),
					root: defpartsf.number("Degree"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number"],
					},
				},
			},
			({ value, root }) => ({
				result: { type: "number", value: value ** (1 / root) },
			}),
		),
	},
	pow: {
		displayName: "Power",
		description: "Buffs input values",
		search: { aliases: ["^"] },
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "POW", categories.math),
		logic: logic(
			{
				inputOrder: ["value", "power"],
				input: {
					value: defpartsf.number("Value"),
					power: defpartsf.number("Power"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number"],
					},
				},
			},
			({ value, power }) => ({
				result: { type: "number", value: math.pow(value, power) },
			}),
		),
	},
	clamp: {
		displayName: "Clamp",
		description: "Limits the output between min and max.",
		search: { aliases: ["><"] },
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "CLAMP", categories.math),
		logic: logic(
			{
				inputOrder: ["value", "min", "max"],
				input: {
					value: {
						displayName: "Value",
						types: {
							number: { config: 0 },
							vector3: { config: Vector3.zero },
						},
						group: "0",
					},
					min: {
						displayName: "Min",
						types: {
							number: { config: 0 },
							vector3: { config: Vector3.zero },
						},
						group: "0",
					},
					max: {
						displayName: "Max",
						types: {
							number: { config: 0 },
							vector3: { config: Vector3.zero },
						},
						group: "0",
					},
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number", "vector3"],
						group: "0",
					},
				},
			},
			({ value, min, max }) => {
				if (typeIs(min, "number") && typeIs(max, "number")) {
					if (min > max) {
						return BlockLogicValueResults.garbage;
					}
				} else if (typeIs(min, "Vector3") && typeIs(max, "Vector3")) {
					if (min.X > max.X || min.Y > max.Y || min.Z > max.Z) {
						return BlockLogicValueResults.garbage;
					}
				} else if (typeIs(min, "number") && typeIs(max, "Vector3")) {
					if (min > max.X || min > max.Y || min > max.Z) {
						return BlockLogicValueResults.garbage;
					}
				} else if (typeIs(min, "Vector3") && typeIs(max, "number")) {
					if (min.X > max || min.Y > max || min.Z > max) {
						return BlockLogicValueResults.garbage;
					}
				}

				if (typeIs(value, "number")) {
					if (!typeIs(min, "number") || !typeIs(max, "number")) {
						return BlockLogicValueResults.garbage;
					}

					return { result: { type: "number", value: math.clamp(value, min, max) } };
				}

				let ret = value;
				if (typeIs(min, "number")) {
					ret = ret.apply((n) => math.max(n, min));
				} else {
					ret = ret.apply((n, ax) => math.max(n, min[ax]));
				}

				if (typeIs(max, "number")) {
					ret = ret.apply((n) => math.min(n, max));
				} else {
					ret = ret.apply((n, ax) => math.min(n, max[ax]));
				}

				return { result: { type: "vector3", value: ret } };
			},
		),
	},

	min: {
		displayName: "Min",
		description: "Outputs the smallest input from the two given ones.",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "MIN", categories.math),
		logic: logic(
			{
				inputOrder: ["value", "min"],
				input: {
					value: {
						displayName: "Value",
						types: { number: { config: 0 }, vector3: { config: Vector3.zero } },
						group: "0",
					},
					min: {
						displayName: "Minimum",
						types: { number: { config: 0 }, vector3: { config: Vector3.zero } },
						group: "0",
					},
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number", "vector3"],
						group: "0",
					},
				},
			},
			({ value, min }) => {
				if (typeIs(value, "number") && typeIs(min, "number")) {
					return { result: { type: "number", value: math.min(value, min) } };
				}

				if (typeIs(value, "Vector3") && typeIs(min, "Vector3")) {
					return { result: { type: "vector3", value: value.apply((n, ax) => math.min(n, min[ax])) } };
				}

				if (typeIs(value, "Vector3") && typeIs(min, "number")) {
					return { result: { type: "vector3", value: value.apply((n) => math.min(n, min)) } };
				}

				return BlockLogicValueResults.garbage;
			},
		),
	},
	max: {
		displayName: "Max",
		description: "Outputs the biggest input from the two given ones.",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "MAKS", categories.math),
		logic: logic(
			{
				inputOrder: ["value", "max"],
				input: {
					value: {
						displayName: "Value",
						types: { number: { config: 0 }, vector3: { config: Vector3.zero } },
						group: "0",
					},
					max: {
						displayName: "Maximum",
						types: { number: { config: 0 }, vector3: { config: Vector3.zero } },
						group: "0",
					},
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number", "vector3"],
						group: "0",
					},
				},
			},
			({ value, max }) => {
				if (typeIs(value, "number") && typeIs(max, "number")) {
					return { result: { type: "number", value: math.max(value, max) } };
				}

				if (typeIs(value, "Vector3") && typeIs(max, "Vector3")) {
					return { result: { type: "vector3", value: value.apply((n, ax) => math.max(n, max[ax])) } };
				}

				if (typeIs(value, "Vector3") && typeIs(max, "number")) {
					return { result: { type: "vector3", value: value.apply((n) => math.max(n, max)) } };
				}

				return BlockLogicValueResults.garbage;
			},
		),
	},

	equals: {
		displayName: "Equals",
		description: "Returns true if inputs are the same",
		search: { partialAliases: ["="] },
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "=", categories.math),
		logic: logic(defs.equality, ({ value1, value2 }) => ({
			result: { type: "bool", value: value1 === value2 },
		})),
	},
	notequals: {
		displayName: "Not Equals",
		description: "Returns true if inputs are not the same",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "≠", categories.math),
		search: { aliases: ["!=", "!==", "~="] },
		logic: logic(defs.equality, ({ value1, value2 }) => ({
			result: { type: "bool", value: value1 !== value2 },
		})),
	},

	greaterthan: {
		displayName: "Greater Than",
		description: "Returns true if first value is greater than second",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", ">", categories.math),
		search: {
			aliases: ["mor", "more", "gre", "grea", "greater", ">"],
		},
		logic: logic(defs.num2_bool, ({ value1, value2 }) => ({
			result: { type: "bool", value: value1 > value2 },
		})),
	},
	lessthan: {
		displayName: "Less Than",
		description: "Returns true if first value lesser than second",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "<", categories.math),
		search: {
			aliases: ["les", "less", "under", "<"],
		},
		logic: logic(defs.num2_bool, ({ value1, value2 }) => ({
			result: { type: "bool", value: value1 < value2 },
		})),
	},
	greaterthanorequals: {
		displayName: "Greater Than or Equals",
		description: "Returns true if first value is greater than or equals to second",
		search: {
			aliases: [">="],
			partialAliases: ["more"],
		},
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "≥", categories.math),
		logic: logic(defs.num2_bool, ({ value1, value2 }) => ({
			result: { type: "bool", value: value1 >= value2 },
		})),
	},
	lessthanorequals: {
		displayName: "Less Than or Equals",
		description: "Returns true if first value lesser than or equals to second",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "≤", categories.math),
		search: { aliases: ["<="] },
		logic: logic(defs.num2_bool, ({ value1, value2 }) => ({
			result: { type: "bool", value: value1 <= value2 },
		})),
	},
	increment: {
		displayName: "Increment",
		description: "Adds 1 to the number",
		modelSource: autoModel("GenericLogicBlockPrefab", "INC", categories.math),
		search: { aliases: ["++", "+="] },
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value: valueType === "number" ? (value as number) + 1 : (value as Vector3).add(Vector3.one),
			},
		})),
	},
	decrement: {
		displayName: "Decrement",
		description: "Subtracts 1 from the number",
		search: { aliases: ["--", "-="] },
		modelSource: autoModel("GenericLogicBlockPrefab", "DEC", categories.math),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value: valueType === "number" ? (value as number) - 1 : (value as Vector3).sub(Vector3.one),
			},
		})),
	},

	log: {
		displayName: "Logarithm",
		description: "Calculates a logarithm of the input value with selected base",
		modelSource: autoModel("GenericLogicBlockPrefab", "LOG", categories.math),
		logic: logic(
			{
				input: {
					value: defpartsf.number("Value"),
					base: defpartsf.number("Base"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number"],
					},
				},
			},
			({ value, base }) => ({
				result: { type: "number", value: math.log(value, base) },
			}),
		),
	},
	log10: {
		displayName: "Logarithm (10 base)",
		description: "Calculates a base 10 logarithm of the input value",
		modelSource: autoModel("GenericLogicBlockPrefab", "LOG(10)", categories.math),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value: valueType === "number" ? math.log10(value as number) : (value as Vector3).apply(math.log10),
			},
		})),
	},
	loge: {
		displayName: "Logarithm (Natural)",
		description: "Returns a natural Logarithm of inputed value. Unlike it's evil artificial counterparts..",
		modelSource: autoModel("GenericLogicBlockPrefab", "LOG(E)", categories.math),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value:
					valueType === "number" ? math.log(value as number) : (value as Vector3).apply((n) => math.log(n)),
			},
		})),
	},
} as const satisfies BlockBuildersWithoutIdAndDefaults;

const trigonometry = {
	sin: {
		displayName: "Sine",
		description: "Calculates a sine of input",
		modelSource: autoModel("GenericLogicBlockPrefab", "SIN", categories.trigonometry),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value: valueType === "number" ? math.sin(value as number) : (value as Vector3).apply(math.sin),
			},
		})),
	},
	cos: {
		displayName: "Cosine",
		description: "Calculates a cosine of input",
		modelSource: autoModel("GenericLogicBlockPrefab", "COS", categories.trigonometry),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value: valueType === "number" ? math.cos(value as number) : (value as Vector3).apply(math.cos),
			},
		})),
	},
	tan: {
		displayName: "Tangent",
		description: "Calculates a tangent of input",
		modelSource: autoModel("GenericLogicBlockPrefab", "TAN", categories.trigonometry),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value: valueType === "number" ? math.tan(value as number) : (value as Vector3).apply(math.tan),
			},
		})),
	},
	asin: {
		displayName: "Arcsine",
		description: "The inverse of Sine",
		modelSource: autoModel("GenericLogicBlockPrefab", "ASIN", categories.trigonometry),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value: valueType === "number" ? math.asin(value as number) : (value as Vector3).apply(math.asin),
			},
		})),
	},
	acos: {
		displayName: "Arccosine",
		description: "The inverse of Cosine",
		modelSource: autoModel("GenericLogicBlockPrefab", "ACOS", categories.trigonometry),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value: valueType === "number" ? math.acos(value as number) : (value as Vector3).apply(math.acos),
			},
		})),
	},
	atan: {
		displayName: "Arctangent",
		description: "The inverse of Tangent",
		modelSource: autoModel("GenericLogicBlockPrefab", "ATAN", categories.trigonometry),
		search: {
			aliases: ["ata"],
		},
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value: valueType === "number" ? math.atan(value as number) : (value as Vector3).apply(math.atan),
			},
		})),
	},
	deg: {
		displayName: "To degrees",
		description: "Converts input value given in radians, into degrees",
		modelSource: autoModel("GenericLogicBlockPrefab", "DEG", categories.trigonometry),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value: valueType === "number" ? math.deg(value as number) : (value as Vector3).apply(math.deg),
			},
		})),
	},
	rad: {
		displayName: "To radians",
		description: "Converts input value given in degreees, into radians",
		modelSource: autoModel("GenericLogicBlockPrefab", "RAD", categories.trigonometry),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value: valueType === "number" ? math.rad(value as number) : (value as Vector3).apply(math.rad),
			},
		})),
	},

	atan2: {
		displayName: "Arctangent 2",
		description: "No way they made a sequel",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "ATAN2", categories.trigonometry),
		search: {
			aliases: ["atan 2"],
			partialAliases: ["atan"],
		},
		logic: logic(
			{
				inputOrder: ["y", "x"],
				input: {
					y: defpartsf.number("Y"),
					x: defpartsf.number("X"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number"],
					},
				},
			},
			({ y, x }) => ({
				result: { type: "number", value: math.atan2(y, x) },
			}),
		),
	},
	ilcos: {
		displayName: "Inverse Law of Cosines",
		description: "Calculates angle C given triangle abc, AVAILATER if the triangle is invalid",
		search: {
			aliases: ["ik", "arm", "leg", "ilcos"],
			partialAliases: ["law"],
		},
		logic: logic(
			{
				inputOrder: ["a", "b", "c"],
				input: {
					a: defpartsf.number("a"),
					b: defpartsf.number("b"),
					c: defpartsf.number("c"),
				},
				output: {
					result: {
						displayName: "C",
						types: ["number"],
					},
				},
			},
			({ a, b, c }) => {
				const [a2, b2, c2] = [a ** 2, b ** 2, c ** 2];
				const check = (a2 + b2 - c2) / (2 * a * b);
				if (math.abs(check) > 1 || check !== check) return BlockLogicValueResults.availableLater;
				return {
					result: { type: "number", value: math.acos(check) },
				};
			},
		),
	},
	signedangle: {
		displayName: "To signed",
		description: "Converts 0-360° to ±180°",
		search: { aliases: ["180", "360", "azimuth"] },
		modelSource: autoModel("GenericLogicBlockPrefab", "±180°", categories.trigonometry),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => {
			const toSignedAngle = (n: number) => {
				const deg = math.fmod(n, 360);
				return deg > 180 ? deg - 360 : deg < -180 ? deg + 360 : deg;
			};
			return {
				result: {
					type: valueType,
					value:
						valueType === "number"
							? toSignedAngle(value as number)
							: (value as Vector3).apply(toSignedAngle),
				},
			};
		}),
	},
	unsignedangle: {
		displayName: "To unsigned",
		description: "Converts ±180° to 0-360°",
		modelSource: autoModel("GenericLogicBlockPrefab", "360°", categories.trigonometry),
		search: { aliases: ["180", "360", "heading", "reflex"] },
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => {
			const toUnsignedAngle = (n: number) => {
				const deg = math.fmod(n, 360);
				return deg < 0 ? deg + 360 : deg;
			};
			return {
				result: {
					type: valueType,
					value:
						valueType === "number"
							? toUnsignedAngle(value as number)
							: (value as Vector3).apply(toUnsignedAngle),
				},
			};
		}),
	},
} as const satisfies BlockBuildersWithoutIdAndDefaults;

const vec3 = {
	vec3combiner: {
		displayName: "Vector3 Combiner",
		description: "Returns a vector combined from input values",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "VEC3 COMB", categories.converterVector),
		logic: logic(
			{
				inputOrder: ["value_x", "value_y", "value_z"],
				input: {
					value_x: defpartsf.number("X"),
					value_y: defpartsf.number("Y"),
					value_z: defpartsf.number("Z"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["vector3"],
					},
				},
			},
			({ value_x, value_y, value_z }) => ({
				result: { type: "vector3", value: new Vector3(value_x, value_y, value_z) },
			}),
		),
	},
	vec3splitter: {
		displayName: "Vector3 Splitter",
		description: "Splits a vector into three numbers",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "VEC3 SPLIT", categories.converterVector),
		logic: logic(
			{
				outputOrder: ["result_x", "result_y", "result_z"],
				input: {
					value: defpartsf.vector3("Value"),
				},
				output: {
					result_x: {
						displayName: "X",
						types: ["number"],
					},
					result_y: {
						displayName: "Y",
						types: ["number"],
					},
					result_z: {
						displayName: "Z",
						types: ["number"],
					},
				},
			},
			({ value }) => ({
				result_x: { type: "number", value: value.X },
				result_y: { type: "number", value: value.Y },
				result_z: { type: "number", value: value.Z },
			}),
		),
	},

	vec3magnitude: {
		displayName: "Vector3 Magnitude",
		description: "Returns length of the given vector",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "VEC3 MAG", categories.converterVector),
		logic: logic(
			{
				input: {
					value: defpartsf.vector3("Value"),
				},
				output: {
					result: {
						displayName: "Magnitude",
						types: ["number"],
					},
				},
			},
			({ value }) => ({
				result: { type: "number", value: value.Magnitude },
			}),
		),
	},
	vec3normalize: {
		displayName: "Vector3 Normalize",
		description: "Creates a unit vector with the direction of the given vector",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "VEC3 NORM", categories.converterVector),
		search: {
			aliases: ["unit"],
		},
		logic: logic(
			{
				input: {
					value: defpartsf.vector3("Value"),
				},
				output: {
					result: {
						displayName: "Normalized",
						types: ["vector3"],
					},
				},
			},
			({ value }) => ({
				result: { type: "vector3", value: value.Unit },
			}),
		),
	},

	vec3objectworldtransformer: {
		displayName: "Vector3 Object/World Transformer",
		description: "Converts a vector into the world/object coordinate space of the other vector",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "VEC3 OBJ/WLD", categories.converterVector),
		logic: logic(
			{
				inputOrder: ["toobject", "originpos", "originrot", "inposition"],
				input: {
					toobject: {
						displayName: "To object?",
						types: BlockConfigDefinitions.bool,
					},
					originpos: {
						displayName: "Origin position",
						types: BlockConfigDefinitions.vector3,
					},
					originrot: {
						displayName: "Origin rotation",
						types: BlockConfigDefinitions.vector3,
					},
					inposition: {
						displayName: "Position",
						types: BlockConfigDefinitions.vector3,
					},
				},
				output: {
					position: {
						displayName: "Result",
						types: ["vector3"],
					},
				},
			},
			({ toobject, originpos, originrot, inposition }) => {
				const origin = new CFrame(originpos).mul(CFrame.fromOrientation(originrot.X, originrot.Y, originrot.Z));
				const result = toobject ? origin.PointToObjectSpace(inposition) : origin.PointToWorldSpace(inposition);

				return { position: { type: "vector3", value: result } };
			},
		),
	},

	vec3crossproduct: {
		displayName: "Vector3 Cross product",
		description: "Calculates the cross product of the two vectors",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "VEC3 CROSS", categories.converterVector),
		search: {
			aliases: ["unit"],
		},
		logic: logic(
			{
				input: {
					value1: defpartsf.vector3("Value1"),
					value2: defpartsf.vector3("Value2"),
				},
				output: {
					result: {
						displayName: "Cross",
						types: ["vector3"],
					},
				},
			},
			({ value1, value2 }) => ({
				result: { type: "vector3", value: value1.Cross(value2) },
			}),
		),
	},

	vec3dotproduct: {
		displayName: "Vector3 Dot product",
		description: "Calculates the dot product of the given vector",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "VEC3 DOT", categories.converterVector),
		search: {
			aliases: ["unit"],
		},
		logic: logic(
			{
				input: {
					value1: defpartsf.vector3("Value1"),
					value2: defpartsf.vector3("Value2"),
				},
				output: {
					result: {
						displayName: "Dot",
						types: ["number"],
					},
				},
			},
			({ value1, value2 }) => ({
				result: { type: "number", value: value1.Dot(value2) },
			}),
		),
	},

	vec3rottodirection: {
		displayName: "Orientation To Direction",
		description: "Calculates the direction vector from an orientation",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "ROT->DIR", categories.converterVector),
		search: {
			partialAliases: ["rotation"],
		},
		logic: logic(
			{
				input: {
					rotation: defpartsf.vector3("Orientation", { unit: "Radians" }),
				},
				output: {
					result: {
						displayName: "Direction",
						types: ["vector3"],
					},
				},
			},
			({ rotation }) => ({
				result: {
					type: "vector3",
					value: CFrame.fromOrientation(rotation.X, rotation.Y, rotation.Z).LookVector,
				},
			}),
		),
	},

	vec3directiontorot: {
		displayName: "Direction To Orientation",
		description: "Calculates the orientation vector from a direction",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "DIR->ROT", categories.converterVector),
		search: {
			partialAliases: ["rotation"],
		},
		logic: logic(
			{
				input: {
					direction: defpartsf.vector3("Direction", { unit: "Normal Vector" }),
				},
				output: {
					result: {
						displayName: "Orientation",
						types: ["vector3"],
					},
				},
			},
			({ direction }) => {
				const [x, y, z] = CFrame.lookAlong(new Vector3(), direction).ToOrientation();
				return { result: { type: "vector3", value: new Vector3(x, y, z) } };
			},
		),
	},
	vec3distance: {
		displayName: "Vector Distance",
		description: "Calculates the numeric distance between two vectors",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "VEC3 DISTANCE", categories.converterVector),
		search: {
			partialAliases: ["distance", "far", "range"],
		},
		logic: logic(
			{
				input: {
					p1: defpartsf.vector3("P1"),
					p2: defpartsf.vector3("P2"),
				},
				output: {
					result: {
						displayName: "Distance",
						types: ["number"],
					},
				},
			},
			({ p1, p2 }) => {
				return { result: { type: "number", value: p1.sub(p2).Magnitude } };
			},
		),
	},
	vec3rearrange: {
		displayName: "Vector Rearrange",
		description: "Converts XYZ to ZYX, or any other configured form",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "VEC3 REARRANGE", categories.converterVector),
		search: {
			partialAliases: ["rearrange", "shuffle"],
		},
		logic: logic(
			{
				input: {
					input: defpartsf.vector3("Input", { unit: "XYZ" }),
					order: {
						displayName: "Axis Order",
						tooltip: "Output structure",
						types: {
							enum: {
								config: "xyz",
								elementOrder: ["xyz", "xzy", "yxz", "yzx", "zxy", "zyx"],
								elements: {
									xyz: { displayName: "XYZ" },
									xzy: { displayName: "XZY" },
									yxz: { displayName: "YXZ" },
									yzx: { displayName: "YZX" },
									zxy: { displayName: "ZXY" },
									zyx: { displayName: "ZYX" },
								},
							},
						},
						connectorHidden: true,
					},
				},
				output: {
					result: {
						displayName: "Result",
						types: ["vector3"],
					},
				},
			},
			({ input, order }) => {
				const axes: Record<string, number> = { x: input.X, y: input.Y, z: input.Z };
				return {
					result: {
						type: "vector3",
						value: new Vector3(axes[order.sub(1, 1)], axes[order.sub(2, 2)], axes[order.sub(3, 3)]),
					},
				};
			},
		),
	},
} as const satisfies BlockBuildersWithoutIdAndDefaults;

const color = {
	colorcombiner: {
		displayName: "Color Combiner",
		description: "Returns a color combined from three numbers (0-255)",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "CLR COMB", categories.converterColor),
		logic: logic(
			{
				inputOrder: ["value_r", "value_g", "value_b"],
				input: {
					value_r: defpartsf.numberOrByte("R"),
					value_g: defpartsf.numberOrByte("G"),
					value_b: defpartsf.numberOrByte("B"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["color"],
					},
				},
			},
			({ value_r, value_g, value_b }) => ({
				result: {
					type: "color",
					value: Color3.fromRGB(
						math.clamp(value_r, 0, 255),
						math.clamp(value_g, 0, 255),
						math.clamp(value_b, 0, 255),
					),
				},
			}),
		),
	},
	colorfromvec: {
		displayName: "Color From Vector",
		description: "Converts a vector (0-255) to color",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "VEC3->CLR", categories.converterColor),
		logic: logic(
			{
				input: {
					input: defpartsf.vector3("Input"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["color"],
					},
				},
			},
			({ input }) => ({
				result: {
					type: "color",
					value: Color3.fromRGB(
						math.clamp(input.X, 0, 255),
						math.clamp(input.Y, 0, 255),
						math.clamp(input.Z, 0, 255),
					),
				},
			}),
		),
	},

	colorsplitter: {
		displayName: "Color Splitter",
		description: "Splits a color into three numbers (0-255)",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "CLR SPLIT", categories.converterColor),
		logic: logic(
			{
				outputOrder: ["result_r", "result_g", "result_b"],
				input: {
					value: defpartsf.color("Value"),
				},
				output: {
					result_r: {
						displayName: "R",
						types: ["number"],
					},
					result_g: {
						displayName: "G",
						types: ["number"],
					},
					result_b: {
						displayName: "B",
						types: ["number"],
					},
				},
			},
			({ value }) => ({
				result_r: { type: "number", value: math.floor(value.R * 255) },
				result_g: { type: "number", value: math.floor(value.G * 255) },
				result_b: { type: "number", value: math.floor(value.B * 255) },
			}),
		),
	},
	colortovec: {
		displayName: "Color To Vector",
		description: "Convert a color to vector (0-255)",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "CLR->VEC3", categories.converterColor),
		logic: logic(
			{
				input: {
					value: defpartsf.color("Value"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["vector3"],
					},
				},
			},
			({ value }) => ({
				result: {
					type: "vector3",
					value: new Vector3(math.floor(value.R * 255), math.floor(value.G * 255), math.floor(value.B * 255)),
				},
			}),
		),
	},

	colorfromhex: {
		displayName: "Color From HEX String",
		description: "Converts a HEX string (#FA1298) to color",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "HEX->CLR", categories.converterColor),
		logic: logic(
			{
				input: {
					input: defpartsf.string("HEX"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["color"],
					},
				},
			},
			({ input }) => ({
				result: { type: "color", value: Color3.fromHex(input) },
			}),
		),
	},
	colortohex: {
		displayName: "Color To HEX String",
		description: "Converts a color to a HEX string (#FA1298)",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "CLR->HEX", categories.converterColor),
		logic: logic(
			{
				input: {
					input: defpartsf.color("HEX"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["string"],
					},
				},
			},
			({ input }) => ({
				result: { type: "string", value: input.ToHex() },
			}),
		),
	},

	colorfromhsvvec: {
		displayName: "Color From HSV Vector",
		description: "Converts an HSV vector (0-1) to color",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "HSV->CLR", categories.converterColor),
		logic: logic(
			{
				input: {
					input: defpartsf.vector3("Input"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["color"],
					},
				},
			},
			({ input }) => ({
				result: {
					type: "color",
					value: Color3.fromHSV(
						math.clamp(input.X, 0, 1),
						math.clamp(input.Y, 0, 1),
						math.clamp(input.Z, 0, 1),
					),
				},
			}),
		),
	},
	colortohsvvec: {
		displayName: "Color To HSV Vector",
		description: "Converts a color to an HSV vector (0-1)",
		modelSource: autoModel("TripleGenericLogicBlockPrefab", "CLR->HSV", categories.converterColor),
		logic: logic(
			{
				input: {
					input: defpartsf.color("Input"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["vector3"],
					},
				},
			},
			({ input }) => {
				const [h, s, v] = input.ToHSV();
				return {
					result: { type: "vector3", value: new Vector3(h, s, v) },
				};
			},
		),
	},
} as const satisfies BlockBuildersWithoutIdAndDefaults;

const bool = {
	numbertobool: {
		displayName: "Number to Bool",
		description: "Converts 0 into false and everything else into true",
		modelSource: autoModel("GenericLogicBlockPrefab", "NUM -> BOOL", categories.converter),
		logic: logic(
			{
				input: {
					value: defpartsf.number("Value"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["bool"],
					},
				},
			},
			({ value }) => ({
				result: { type: "bool", value: value !== 0 },
			}),
		),
	},
	booltonumber: {
		displayName: "Bool to Number",
		description: "Converts true into 1 and false into 0",
		modelSource: autoModel("GenericLogicBlockPrefab", "BOOL -> NUM", categories.converter),
		logic: logic(
			{
				input: {
					value: defpartsf.bool("Value"),
					trueValue: {
						displayName: "True Value",
						types: { number: { config: 1 } },
					},
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number"],
					},
				},
			},
			({ value, trueValue }) => ({
				result: { type: "number", value: value ? trueValue : 0 },
			}),
		),
	},
} as const satisfies BlockBuildersWithoutIdAndDefaults;

const byte = {
	numbertobyte: {
		displayName: "Number to Byte",
		description: "Converts number value to the byte value! It's like clamping number between 0 and 255.",
		modelSource: autoModel("ByteLogicBlockPrefab", "NUM TO BYTE", categories.converterByte),
		logic: logic(
			{
				input: {
					value: defpartsf.number("Value"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["byte"],
					},
				},
			},
			({ value }) => ({
				result: { type: "byte", value: value >= 0 ? value % 256 : 256 - (-value % 256) },
			}),
		),
	},
	bytetonumber: {
		displayName: "Byte To Number",
		description: "Numbers the bytes! Oh, wait.. no.. It converts Bytes to numbers!",
		modelSource: autoModel("ByteLogicBlockPrefab", "BYTE TO NUM", categories.converterByte),
		logic: logic(
			{
				input: {
					value: defpartsf.byte("Value"),
				},
				output: {
					result: {
						displayName: "Result",
						types: ["number"],
					},
				},
			},
			({ value }) => ({
				result: { type: "number", value: value },
			}),
		),
	},
	bytemaker: {
		displayName: "Byte Maker",
		description: "Makes bytes from bits and pieces",
		logic: logic(
			{
				inputOrder: ["1", "2", "4", "8", "16", "32", "64", "128"],
				input: {
					"1": defpartsf.bool("1"),
					"2": defpartsf.bool("2"),
					"4": defpartsf.bool("4"),
					"8": defpartsf.bool("8"),
					"16": defpartsf.bool("16"),
					"32": defpartsf.bool("32"),
					"64": defpartsf.bool("64"),
					"128": defpartsf.bool("128"),
				},
				output: {
					value: {
						displayName: "Result",
						types: ["byte"],
					},
				},
			},
			(inputs) => {
				const byte =
					((inputs["1"] ? 1 : 0) << 0) |
					((inputs["2"] ? 1 : 0) << 1) |
					((inputs["4"] ? 1 : 0) << 2) |
					((inputs["8"] ? 1 : 0) << 3) |
					((inputs["16"] ? 1 : 0) << 4) |
					((inputs["32"] ? 1 : 0) << 5) |
					((inputs["64"] ? 1 : 0) << 6) |
					((inputs["128"] ? 1 : 0) << 7);

				return {
					value: { type: "byte", value: byte },
				};
			},
		),
	},
	bytesplitter: {
		displayName: "Byte Splitter",
		description: "Another one bytes to bits",
		logic: logic(
			{
				outputOrder: ["1", "2", "4", "8", "16", "32", "64", "128"],
				input: {
					value: defpartsf.byte("Byte"),
				},
				output: {
					"1": {
						displayName: "1",
						types: ["bool"],
					},
					"2": {
						displayName: "2",
						types: ["bool"],
					},
					"4": {
						displayName: "4",
						types: ["bool"],
					},
					"8": {
						displayName: "8",
						types: ["bool"],
					},
					"16": {
						displayName: "16",
						types: ["bool"],
					},
					"32": {
						displayName: "32",
						types: ["bool"],
					},
					"64": {
						displayName: "64",
						types: ["bool"],
					},
					"128": {
						displayName: "128",
						types: ["bool"],
					},
				},
			},
			({ value }) => {
				return {
					"1": { type: "bool", value: ((value >> 0) & 1) === 1 },
					"2": { type: "bool", value: ((value >> 1) & 1) === 1 },
					"4": { type: "bool", value: ((value >> 2) & 1) === 1 },
					"8": { type: "bool", value: ((value >> 3) & 1) === 1 },
					"16": { type: "bool", value: ((value >> 4) & 1) === 1 },
					"32": { type: "bool", value: ((value >> 5) & 1) === 1 },
					"64": { type: "bool", value: ((value >> 6) & 1) === 1 },
					"128": { type: "bool", value: ((value >> 7) & 1) === 1 },
				};
			},
		),
	},

	bytenot: {
		displayName: "Byte NOT",
		description: "It's the same NOT operation but for each bit of input bytes.",
		modelSource: autoModel("DoubleByteLogicBlockPrefab", "BNOT", categories.byte),
		logic: logic(defs.byte1_byte, ({ value }) => ({
			result: { type: "byte", value: ~value & 0xff },
		})),
	},
	byteneg: {
		displayName: "Byte NEGATE",
		description: "Negates the input byte.",
		modelSource: autoModel("ByteLogicBlockPrefab", "BNEG", categories.byte),
		logic: logic(defs.byte1_byte, ({ value }) => ({
			result: { type: "byte", value: -value & 0xff },
		})),
	},

	bytexor: {
		displayName: "Byte XOR",
		description: "It's the same XOR operation but for each bit of input bytes.",
		modelSource: autoModel("DoubleByteLogicBlockPrefab", "BXOR", categories.byte),
		logic: logic(defs.byte2_byte, ({ value1, value2 }) => ({
			result: { type: "byte", value: value1 ^ value2 },
		})),
	},
	bytexnor: {
		displayName: "Byte XNOR",
		description: "It's the same XNOR operation but for each bit of input bytes.",
		modelSource: autoModel("DoubleByteLogicBlockPrefab", "BXNOR", categories.byte),
		logic: logic(defs.byte2_byte, ({ value1, value2 }) => ({
			result: { type: "byte", value: ~(value1 ^ value2) & 0xff },
		})),
	},
	byteand: {
		displayName: "Byte AND",
		description: "It's the same AND operation but for each bit of input bytes.",
		modelSource: autoModel("DoubleByteLogicBlockPrefab", "BAND", categories.byte),
		logic: logic(defs.byte2_byte, ({ value1, value2 }) => ({
			result: { type: "byte", value: value1 & value2 },
		})),
	},
	bytenand: {
		displayName: "Byte NAND",
		description: "It's the same NAND operation but for each bit of input bytes.",
		modelSource: autoModel("DoubleByteLogicBlockPrefab", "BNAND", categories.byte),
		logic: logic(defs.byte2_byte, ({ value1, value2 }) => ({
			result: { type: "byte", value: ~(value1 & value2) & 0xff },
		})),
	},
	byteor: {
		displayName: "Byte OR",
		description: "It's the same OR operation but for each bit of input bytes.",
		modelSource: autoModel("DoubleByteLogicBlockPrefab", "BOR", categories.byte),
		logic: logic(defs.byte2_byte, ({ value1, value2 }) => ({
			result: { type: "byte", value: value1 | value2 },
		})),
	},
	bytenor: {
		displayName: "Byte NOR",
		description: "It's the same NOR operation but for each bit of input bytes.",
		modelSource: autoModel("DoubleByteLogicBlockPrefab", "BNOR", categories.byte),
		logic: logic(defs.byte2_byte, ({ value1, value2 }) => ({
			result: { type: "byte", value: ~(value1 | value2) & 0xff },
		})),
	},
	byterotateright: {
		displayName: "Byte Rotate Right",
		description: "It rotates the byte right! Don't ask me, don't know either",
		modelSource: autoModel("DoubleByteLogicBlockPrefab", "BRR", categories.byte),
		logic: logic(defs.byteshift, ({ value1: num, value2: shift }) => ({
			result: { type: "byte", value: ((num >>> shift) | (num << (8 - shift))) & 0xff },
		})),
	},
	byterotateleft: {
		displayName: "Byte Rotate Left",
		description: "It rotates the left! Don't ask me, don't know either",
		modelSource: autoModel("DoubleByteLogicBlockPrefab", "BRL", categories.byte),
		logic: logic(defs.byteshift, ({ value1: num, value2: shift }) => ({
			result: { type: "byte", value: ((num << shift) | (num >>> (8 - shift))) & 0xff },
		})),
	},
	byteshiftright: {
		displayName: "Byte Shift Right",
		description: "Shifts bits to right!",
		modelSource: autoModel("DoubleByteLogicBlockPrefab", "BSHR", categories.byte),
		logic: logic(defs.byteshift, ({ value1: num, value2: shift }) => ({
			result: { type: "byte", value: (num >> shift) & 0xff },
		})),
	},
	byteshiftleft: {
		displayName: "Byte Shift Left",
		description: "Shifts bits to left!",
		modelSource: autoModel("DoubleByteLogicBlockPrefab", "BSHL", categories.byte),
		logic: logic(defs.byteshift, ({ value1: num, value2: shift }) => ({
			result: { type: "byte", value: (num << shift) & 0xff },
		})),
	},
	bytearithmeticshiftright: {
		displayName: "Byte Arithmetic Shift Right",
		description: "Honestly, I have ZERO idea what it does, Maks made it.",
		modelSource: autoModel("DoubleByteLogicBlockPrefab", "BASHR", categories.byte),
		logic: logic(defs.byteshift, ({ value1: num, value2: shift }) => ({
			result: { type: "byte", value: (num >> shift) | ((num & 0x80) !== 0 ? 0xff << (8 - shift) : 0) },
		})),
	},
} as const satisfies BlockBuildersWithoutIdAndDefaults;

const units = {
	studstometers: {
		displayName: "Studs to Meters",
		description: "Converts studs to meters.",
		modelSource: autoModel("ConstLogicBlockPrefab", "ST -> M", categories.converterUnits),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value:
					valueType === "number"
						? (value as number) * GameDefinitions.STUDS_TO_METERS
						: (value as Vector3).mul(GameDefinitions.STUDS_TO_METERS),
			},
		})),
	},
	meterstostuds: {
		displayName: "Meters to Studs",
		description: "Converts meters to studs.",
		modelSource: autoModel("ConstLogicBlockPrefab", "M -> ST", categories.converterUnits),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value:
					valueType === "number"
						? (value as number) / GameDefinitions.STUDS_TO_METERS
						: (value as Vector3).div(GameDefinitions.STUDS_TO_METERS),
			},
		})),
	},
	rmustokg: {
		displayName: "RMU to KG",
		description: "Converts Roblox Mass Units to Kilogramms.",
		modelSource: autoModel("ConstLogicBlockPrefab", "RMU -> KG", categories.converterUnits),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value:
					valueType === "number"
						? (value as number) * GameDefinitions.RMU_TO_KG
						: (value as Vector3).mul(GameDefinitions.RMU_TO_KG),
			},
		})),
	},
	kgtormu: {
		displayName: "KG to RMU",
		description: "Converts Kilogramms to Roblox Mass Units.",
		modelSource: autoModel("ConstLogicBlockPrefab", "KG -> RMU", categories.converterUnits),
		logic: logic(defs.numOrVec1_numOrVec, ({ value, valueType }) => ({
			result: {
				type: valueType,
				value:
					valueType === "number"
						? (value as number) / GameDefinitions.RMU_TO_KG
						: (value as Vector3).div(GameDefinitions.RMU_TO_KG),
			},
		})),
	},
};

const other = {
	buffer: {
		displayName: "Buffer",
		description: "Returns input value as output, useful for logic organization",
		logic: logic(
			{
				input: {
					value: defpartsf.any("Value", { group: "1", configHidden: true }),
				},
				output: {
					result: {
						displayName: "Result",
						types: asMap(BlockConfigDefinitions.any).keys(),
						group: "1",
					},
				},
			},
			({ value, valueType }) => ({
				result: { type: valueType, value },
			}),
		),
	},
	switch: {
		displayName: "Switch",
		description: "Toggleable buffer",
		modelSource: autoModel("GenericLogicBlockPrefab", "SWITCH", categories.other),
		logic: logic(
			{
				inputOrder: ["value", "enable"],
				input: {
					enable: defpartsf.bool("Enabled"),
					value: defpartsf.any("Value", { group: "1" }),
				},
				output: {
					result: {
						displayName: "Result",
						types: asMap(BlockConfigDefinitions.any).keys(),
						group: "1",
					},
				},
			},
			({ value, valueType, enable }) =>
				enable ? { result: { type: valueType, value: value } } : BlockLogicValueResults.availableLater,
		),
	},
	unixtime: {
		displayName: "UNIX Time",
		description: "Returns the amount of seconds since January 1st, 1970 at 00:00 UTC",
		modelSource: autoModel("ConstLogicBlockPrefab", "UNIX", BlockCreation.Categories.other),
		logic: logic(
			{
				input: {},
				output: {
					result: {
						displayName: "Time",
						types: ["number"],
					},
				},
			},
			() => ({
				result: { type: "number", value: DateTime.now().UnixTimestampMillis / 1000 },
			}),
		),
	},
} as const satisfies BlockBuildersWithoutIdAndDefaults;

const test: {} = !RunService.IsStudio()
	? {}
	: ({
			testblock: {
				displayName: "TEST BLOCK",
				description: "Test block to test the block; Studio only",
				modelSource: {
					model: BlockCreation.Model.fAutoCreated("DoubleGenericLogicBlockPrefab", "TEST"),
					category: () => [],
				},
				logic: logic(
					{
						input: {
							value: {
								displayName: "Value",
								types: {
									number: {
										config: 0,
										control: {
											min: 0.15,
											max: 10,
											config: {
												enabled: true,
												startValue: 0,
												mode: {
													type: "smooth",
													instant: {
														mode: "onRelease",
													},
													smooth: {
														speed: 1,
														mode: "stopOnRelease",
													},
												},
												keys: [
													{ key: "R", value: 10 },
													{ key: "F", value: 0.15 },
												],
											},
										},
									},
								},
							},
						},
						output: {
							result: {
								displayName: "Result",
								types: ["number"],
							},
						},
					},
					({ value, valueType }) => ({
						result: { type: valueType, value },
					}),
				),
			},
		} as const satisfies BlockBuildersWithoutIdAndDefaults);

//

const list: BlockBuildersWithoutIdAndDefaults = {
	...maths,
	...constants,
	...trigonometry,
	...vec3,
	...color,
	...bool,
	...byte,
	...other,
	...units,
	...test,
};
export const BasicOperationBlocks = BlockCreation.arrayFromObject(list);
