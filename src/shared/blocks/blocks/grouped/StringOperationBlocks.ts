import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, BlockCategoryPath, BlockModelSource } from "shared/blocks/Block";

const autoModel = (prefab: BlockCreation.Model.PrefabName, text: string, category: BlockCategoryPath) => {
	return {
		model: BlockCreation.Model.fAutoCreated(prefab, text),
		category: () => category,
	} satisfies BlockModelSource;
};
namespace StringUpperCase {
	const definition = {
		input: {
			value: {
				displayName: "Text",
				types: BlockConfigDefinitions.string,
			},
		},
		output: {
			result: {
				displayName: "Result",
				types: ["string"],
			},
		},
	} satisfies BlockLogicFullBothDefinitions;

	class Logic extends BlockLogic<typeof definition> {
		constructor(block: BlockLogicArgs) {
			super(definition, block);

			this.on(({ value }) => this.output.result.set("string", value.fullUpper()));
		}
	}

	export const block = {
		...BlockCreation.defaults,
		id: "stringuppercase",
		displayName: "String upper case",
		description: "Returns the given string but converted to the upper case.",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "strucase", BlockCreation.Categories.string),

		search: {
			aliases: ["text", "str", "size", "case"],
			partialAliases: ["upper", "big"],
		},

		logic: { definition, ctor: Logic },
	} as const satisfies BlockBuilder;
}
namespace StringLowerCase {
	const definition = {
		input: {
			value: {
				displayName: "Text",
				types: BlockConfigDefinitions.string,
			},
		},
		output: {
			result: {
				displayName: "Result",
				types: ["string"],
			},
		},
	} satisfies BlockLogicFullBothDefinitions;

	class Logic extends BlockLogic<typeof definition> {
		constructor(block: BlockLogicArgs) {
			super(definition, block);

			this.on(({ value }) => this.output.result.set("string", value.fullLower()));
		}
	}

	export const block = {
		...BlockCreation.defaults,
		id: "stringlowercase",
		displayName: "String lower case",
		description: "Returns the given string but converted to the lower case.",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "strlcase", BlockCreation.Categories.string),

		search: {
			aliases: ["text", "str", "size", "case"],
			partialAliases: ["lower"],
		},

		logic: { definition, ctor: Logic },
	} as const satisfies BlockBuilder;
}
namespace StringConcat {
	const definition = {
		inputOrder: ["string1", "string2"],
		input: {
			string1: {
				displayName: "Text 1",
				types: BlockConfigDefinitions.string,
			},
			string2: {
				displayName: "Text 2",
				types: BlockConfigDefinitions.string,
			},
		},
		output: {
			result: {
				displayName: "Result",
				types: ["string"],
			},
		},
	} satisfies BlockLogicFullBothDefinitions;

	class Logic extends BlockLogic<typeof definition> {
		constructor(block: BlockLogicArgs) {
			super(definition, block);

			this.on(({ string1, string2 }) => this.output.result.set("string", string1 + string2));
		}
	}

	export const block = {
		...BlockCreation.defaults,
		id: "stringconcat",
		displayName: "String concatenation",
		description: 'Adds two given strings together. Example: "Ab" + "Cd" = "AbCd".',
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "concat", BlockCreation.Categories.string),

		search: {
			aliases: ["text", "str", "concat", "join", "add"],
		},

		logic: { definition, ctor: Logic },
	} as const satisfies BlockBuilder;
}
namespace StringLength {
	const definition = {
		input: {
			value: {
				displayName: "Text",
				types: BlockConfigDefinitions.string,
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

			this.on(({ value }) => this.output.result.set("number", value.size()));
		}
	}

	export const block = {
		...BlockCreation.defaults,
		id: "stringlength",
		displayName: "String length",
		description: "Returns the length of the given string.",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "strlen", BlockCreation.Categories.string),

		search: {
			aliases: ["text", "str", "size", "len"],
		},

		logic: { definition, ctor: Logic },
	} as const satisfies BlockBuilder;
}
namespace StringSub {
	const definition = {
		inputOrder: ["value", "fromIndex", "toIndex"],
		input: {
			value: {
				displayName: "Text",
				types: BlockConfigDefinitions.string,
			},
			fromIndex: {
				displayName: "Start index",
				types: BlockConfigDefinitions.number,
			},
			toIndex: {
				displayName: "End index",
				types: BlockConfigDefinitions.number,
			},
		},
		output: {
			result: {
				displayName: "Result",
				types: ["string"],
			},
		},
	} satisfies BlockLogicFullBothDefinitions;

	class Logic extends BlockLogic<typeof definition> {
		constructor(block: BlockLogicArgs) {
			super(definition, block);

			const r = () => this.output.result.set("string", "");

			this.on(({ fromIndex, toIndex, value }) => {
				const len = value.size();
				if (len <= 0) return r();
				fromIndex = math.floor(fromIndex);
				toIndex = math.floor(toIndex);
				this.output.result.set("string", value.sub(fromIndex + 1, toIndex + 1));
			});
		}
	}

	export const block = {
		...BlockCreation.defaults,
		id: "stringsub",
		displayName: "Substring",
		description: "Returns a string of the given string at specific start and end indexes.",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "strsub", BlockCreation.Categories.string),

		search: {
			aliases: ["text", "str", "sub", "char", "index"],
		},

		logic: { definition, ctor: Logic },
	} as const satisfies BlockBuilder;
}
namespace StringChar {
	const definition = {
		input: {
			value: {
				displayName: "Text",
				types: BlockConfigDefinitions.string,
				tooltip: "The input text in which you're looking for a character",
			},
			index: {
				displayName: "Index",
				types: BlockConfigDefinitions.number,
				tooltip: "Index of the character you're looking for",
			},
		},
		output: {
			result: {
				displayName: "Result",
				types: ["string"],
			},
		},
	} satisfies BlockLogicFullBothDefinitions;

	class Logic extends BlockLogic<typeof definition> {
		constructor(block: BlockLogicArgs) {
			super(definition, block);

			this.on(({ index, value }) => {
				index = math.floor(index) + 1;
				this.output.result.set("string", value.sub(index, index));
			});
		}
	}

	export const block = {
		...BlockCreation.defaults,
		id: "stringchar",
		displayName: "String character",
		description: "Returns a character of the given string at specified index.",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "strchar", BlockCreation.Categories.string),

		search: {
			aliases: ["text", "str", "char", "find", "index", "symbol"],
		},

		logic: { definition, ctor: Logic },
	} as const satisfies BlockBuilder;
}
namespace StringIncludes {
	const definition = {
		inputOrder: ["value", "lookingFor"],
		input: {
			value: {
				displayName: "Text",
				types: BlockConfigDefinitions.string,
				tooltip: "The input text in which you're looking for a string",
			},
			lookingFor: {
				displayName: "Searched",
				types: BlockConfigDefinitions.string,
				tooltip: "The text you're looking for",
			},
		},
		output: {
			result: {
				displayName: "Result",
				types: ["bool"],
			},
		},
	} satisfies BlockLogicFullBothDefinitions;

	class Logic extends BlockLogic<typeof definition> {
		constructor(block: BlockLogicArgs) {
			super(definition, block);

			this.on(({ lookingFor, value }) => {
				this.output.result.set("bool", value.contains(lookingFor));
			});
		}
	}

	export const block = {
		...BlockCreation.defaults,
		id: "stringincludes",
		displayName: "String includes",
		description: "Returns true if the given text contains the string you're looking for.",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "incl", BlockCreation.Categories.string),

		search: {
			aliases: ["text", "str", "search", "has", "find"],
			partialAliases: ["includes", "contains"],
		},

		logic: { definition, ctor: Logic },
	} as const satisfies BlockBuilder;
}
namespace StringSearch {
	const definition = {
		inputOrder: ["value", "lookingFor"],
		input: {
			value: {
				displayName: "Text",
				types: BlockConfigDefinitions.string,
				tooltip: "The input text in which you're looking for a string",
			},
			lookingFor: {
				displayName: "Searched",
				types: BlockConfigDefinitions.string,
				tooltip: "The text you're looking for",
			},
		},
		output: {
			startIndex: {
				displayName: "Start index",
				types: ["number"],
			},
			endIndex: {
				displayName: "End index",
				types: ["number"],
			},
		},
	} satisfies BlockLogicFullBothDefinitions;

	class Logic extends BlockLogic<typeof definition> {
		constructor(block: BlockLogicArgs) {
			super(definition, block);

			const f = () => {
				this.output.startIndex.set("number", -1);
				this.output.endIndex.set("number", -1);
			};

			this.on(({ lookingFor, value }) => {
				if (value.size() < lookingFor.size()) return f();
				const [i1, i2] = value.find(lookingFor);
				if (i1 === undefined || i2 === undefined) return f();
				this.output.startIndex.set("number", i1 - 1);
				this.output.endIndex.set("number", i2 - 1);
			});
		}
	}

	export const block = {
		...BlockCreation.defaults,
		id: "stringsearch",
		displayName: "String search",
		description: "Returns index of the beginning of the string you're looking for, otherwise returns -1.",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "strfind", BlockCreation.Categories.string),

		search: {
			aliases: ["text", "str", "search", "has", "find"],
			partialAliases: ["includes", "contains", "index"],
		},

		logic: { definition, ctor: Logic },
	} as const satisfies BlockBuilder;
}

namespace StringCast {
	const definition = {
		input: {
			value: {
				displayName: "Value",
				types: BlockConfigDefinitions.any,
				tooltip: "The input data that will be converted to text string",
			},
		},
		output: {
			result: {
				displayName: "Result",
				types: ["string"],
			},
		},
	} satisfies BlockLogicFullBothDefinitions;

	class Logic extends BlockLogic<typeof definition> {
		constructor(block: BlockLogicArgs) {
			super(definition, block);

			this.on(({ value }) => this.output.result.set("string", `${value}`));
		}
	}

	export const block = {
		...BlockCreation.defaults,
		id: "tostring",
		displayName: "To String",
		description: "Returns the given value represented as a text string",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "tostr", BlockCreation.Categories.string),

		search: {
			aliases: ["text", "str"],
			partialAliases: ["tostring"],
		},

		logic: { definition, ctor: Logic },
	} as const satisfies BlockBuilder;
}

namespace StringToNumber {
	const definition = {
		input: {
			value: {
				displayName: "Value",
				types: BlockConfigDefinitions.string,
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

			this.on(({ value }) => {
				const result = tonumber(value);
				if (!result) this.output.result.unset();
				else this.output.result.set("number", result);
			});
		}
	}

	export const block = {
		...BlockCreation.defaults,
		id: "stringtonumber",
		displayName: "String To Number",
		description: "Converts the given string into a number",
		modelSource: autoModel("DoubleGenericLogicBlockPrefab", "tonum", BlockCreation.Categories.string),

		search: {
			aliases: ["text", "num"],
			partialAliases: ["tonumber"],
		},

		logic: { definition, ctor: Logic },
	} as const satisfies BlockBuilder;
}

export const StringOperationBlocks = [
	StringSub.block,
	StringChar.block,
	StringLength.block,
	StringConcat.block,
	StringIncludes.block,
	StringSearch.block,
	StringUpperCase.block,
	StringLowerCase.block,
	StringCast.block,
	StringToNumber.block,
];
