import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		p: {
			displayName: "p",
			types: {
				number: {
					config: 0,
				},
			},
		},
		i: {
			displayName: "i",
			types: {
				number: {
					config: 0,
				},
			},
		},
		d: {
			displayName: "d",
			types: {
				number: {
					config: 0,
				},
			},
		},
		target: {
			displayName: "target",
			types: {
				number: {
					config: 0,
				},
			},
		},
		now: {
			displayName: "now",
			types: {
				number: {
					config: 0,
				},
			},
		},
	},
	output: {
		output: {
			displayName: "output",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as PidControllerBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		const inputValues = {
			p: 0,
			i: 0,
			d: 0,
			target: 0,
			now: 0,
		};

		this.on((data) => {
			for (const [k, v] of pairs(inputValues)) {
				inputValues[k] = data[k];
			}
		});

		let errorPrev = 0;
		let integral = 0;
		this.onTicc(({ dt }) => {
			const errorCost = inputValues.target - inputValues.now;
			integral = integral + errorCost * dt;
			const derivative = (errorCost - errorPrev) / dt;
			const output = inputValues.p * errorCost + inputValues.i * integral + inputValues.d * derivative;

			errorPrev = errorCost;

			this.output.output.set("number", output);
		});
	}
}

export const PidControllerBlock = {
	...BlockCreation.defaults,
	id: "pidcontrollerblock",
	displayName: "Pid Controller",
	description:
		"A regulator that controls the system's deviation from targets, the sum of past errors, and the change in speed",

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("x4GenericLogicBlockPrefab", "PID"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
