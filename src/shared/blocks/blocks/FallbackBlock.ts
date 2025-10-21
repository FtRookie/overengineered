import { Objects } from "engine/shared/fixes/Objects";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["value", "fallback"],
	input: {
		value: {
			displayName: "Value",
			types: BlockConfigDefinitions.any,
			group: "1",
		},
		fallback: {
			displayName: "Fallback value",
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

export type { Logic as FallbackBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		let valueSet = false;
		let cfallbackValue: BlockLogicTypes.TypeListOfType<typeof definition.input.value.types> | undefined;
		let cfallbackType: BlockLogicTypes.IdListOfType<typeof definition.input.value.types> | undefined;

		const setFallback = () => {
			valueSet = false;
			if (cfallbackType !== undefined && cfallbackValue !== undefined) {
				this.output.result.set(cfallbackType, cfallbackValue);
			}
		};

		this.onkRecalcInputs(
			["value"],
			({ value, valueType }) => {
				if (value !== value) {
					setFallback();
					return;
				}
				valueSet = true;
				this.output.result.set(valueType, value);
			},
			setFallback,
		);

		this.onkRecalcInputs(["fallback"], ({ fallback, fallbackType }) => {
			if (valueSet) return;

			[cfallbackValue, cfallbackType] = [fallback, fallbackType];
			this.output.result.set(fallbackType, fallback);
		});
	}
}

export const FallbackBlock = {
	...BlockCreation.defaults,
	id: "fallback",
	displayName: "Fallback",
	description: "Returns the fallback value if the input is AVAILABLELATER",

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("DoubleGenericLogicBlockPrefab", "FALLBACK"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
