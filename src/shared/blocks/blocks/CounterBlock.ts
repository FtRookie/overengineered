import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	stateful: true,
	inputOrder: ["newvalue", "step", "triggerStep", "triggerValue"],
	input: {
		newvalue: {
			displayName: "New value",
			types: {
				number: {
					config: 0,
				},
			},
		},
		step: {
			displayName: "Step value",
			types: {
				number: {
					config: 1,
				},
			},
		},
		triggerStep: {
			displayName: "Step",
			types: {
				bool: {
					config: false,
				},
			},
		},
		triggerValue: {
			//a.k.a. rewrite value
			displayName: "Rewrite",
			types: {
				bool: {
					config: false,
				},
			},
			configHidden: true,
		},
	},
	output: {
		value: {
			displayName: "Output",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as CounterBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		let currentValue = 0;

		this.onkFirstInputs(["newvalue"], ({ newvalue }) => {
			this.output.value.set("number", (currentValue = newvalue));
		});

		this.onAlwaysInputs(({ triggerStep, step, triggerValue, newvalue }) => {
			if (triggerStep) currentValue += step;
			if (triggerValue) currentValue = newvalue;
			this.output.value.set("number", currentValue);
		});
	}
}

export const CounterBlock = {
	...BlockCreation.defaults,
	id: "counter",
	displayName: "Counter",
	description: "Increments value by Step Value, starting with New Value",

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("x4GenericLogicBlockPrefab", "COUNT"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
