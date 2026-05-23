import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { AllInputKeysToObject, BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["target", "p", "i", "d", "now", "imin", "imax"],
	input: {
		target: {
			displayName: "Target value",
			types: {
				number: {
					config: 0,
				},
			},
		},
		p: {
			displayName: "Proportional",
			tooltip: "Direct response",
			types: {
				number: {
					config: 0,
				},
			},
		},
		i: {
			displayName: "Integral",
			tooltip: "Change over time / drift",
			types: {
				number: {
					config: 0,
				},
			},
		},
		d: {
			displayName: "Derivative",
			tooltip: "Prevent overshoot",
			types: {
				number: {
					config: 0,
				},
			},
		},
		now: {
			displayName: "Current Value",
			types: {
				number: {
					config: 0,
				},
			},
		},
		imin: {
			displayName: "Min Integral border",
			types: {
				number: {
					config: 0,
				},
			},
			connectorHidden: true,
		},
		imax: {
			displayName: "Max Integral border",
			types: {
				number: {
					config: 0,
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		output: {
			displayName: "Output",
			types: ["number"],
		},
		integral: {
			displayName: "integral",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as PIDControllerBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		let inputValues: AllInputKeysToObject<(typeof definition)["input"]> | undefined;

		this.on((data) => (inputValues = data));

		let errorPrev = 0;
		let integral = 0;
		this.onTicc(({ dt }) => {
			if (dt === 0 || inputValues === undefined) return;
			const errorCost = inputValues.target - inputValues.now;
			// clamp integral, since the error during the delay will accumulate infinitely
			integral = math.clamp(integral + errorCost * dt, inputValues.imin, inputValues.imax);
			const derivative = (errorCost - errorPrev) / dt;
			const output = inputValues.p * errorCost + inputValues.i * integral + inputValues.d * derivative;

			errorPrev = errorCost;

			this.output.integral.set("number", integral);
			this.output.output.set("number", output);
		});
	}
}

export const PIDControllerBlock = {
	...BlockCreation.defaults,
	id: "pidcontrollerblock",
	displayName: "Pid Controller",
	description: "Controller: P/I/D - Proportional-Integral-Derivative",
	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("x4GenericLogicBlockPrefab", "PID"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
