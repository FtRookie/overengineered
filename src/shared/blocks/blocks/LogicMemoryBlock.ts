import { Objects } from "engine/shared/fixes/Objects";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["set", "value", "defaultValue", "reset"],
	input: {
		set: {
			displayName: "Set",
			types: {
				bool: {
					config: false,
				},
			},
		},
		value: {
			displayName: "Value",
			types: BlockConfigDefinitions.any,
			group: "1",
		},
		defaultValue: {
			displayName: "Default value",
			types: BlockConfigDefinitions.any,
			group: "1",
			connectorHidden: true,
		},
		reset: {
			displayName: "Reset",
			tooltip: "Reset the value to the default one",
			types: BlockConfigDefinitions.bool,
			configHidden: true,
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

export type { Logic as LogicMemoryBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		this.onk(["defaultValue"], ({ defaultValue, defaultValueType, defaultValueChanged }) => {
			if (!defaultValueChanged) return;
			this.output.result.set(defaultValueType, defaultValue);
		});
		this.onk(["value", "set"], ({ value, valueType, set }) => {
			if (!set) return;
			this.output.result.set(valueType, value);
		});

		this.onk(["reset", "defaultValue"], ({ reset, resetChanged, defaultValue, defaultValueType }) => {
			if (resetChanged && reset) {
				this.output.result.set(defaultValueType, defaultValue);
			}
		});
	}
}

export const LogicMemoryBlock = {
	...BlockCreation.defaults,
	id: "logicmemory",
	displayName: "Memory Cell",
	description: "Stores the value you gave it",
	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("DoubleGenericLogicBlockPrefab", "MEMORY"),
		category: () => BlockCreation.Categories.memory,
	},
	search: {
		partialAliases: ["D Flip-Flop", "D-Latch", "D Latch"],
	},
} as const satisfies BlockBuilder;
