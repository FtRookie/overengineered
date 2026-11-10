import { Objects } from "engine/shared/fixes/Objects";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	stateful: true,
	input: {
		set: {
			displayName: "Set",
			types: {
				bool: {
					config: false,
				},
			},
			configHidden: true,
		},
		value: {
			displayName: "Value",
			types: BlockConfigDefinitions.any,
			group: "1",
		},
	},
	output: {
		result: {
			displayName: "Result",
			types: Objects.keys(BlockConfigDefinitions.any),
			group: "1",
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as LogicMemoryLegacyBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		this.onk(["value", "set"], ({ value, valueType, set }) => {
			if (!set) return;
			this.output.result.set(valueType, value);
		});
	}
}

/** Logic memory without the initial value. Created to simplify the process of updating saves pre-v25 (calculating the type for `defaultValue` is hard and would take a lot of time each update) */
export const LogicMemoryLegacyBlock = {
	...BlockCreation.defaults,
	id: "logicmemorylegacy",
	displayName: "Memory Cell (legacy)",
	description: "Stores the value you gave it",
	hidden: true,

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("DoubleGenericLogicBlockPrefab", "MEMORY\nLEGACY"),
		category: () => BlockCreation.Categories.memory,
	},
} as const satisfies BlockBuilder;
