import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		key: {
			displayName: "Key",
			types: {
				bool: {
					config: false,
					control: {
						config: {
							enabled: true,
							key: "F",
							switch: false,
							reversed: false,
						},
						canBeSwitch: true,
						canBeReversed: true,
					},
				},
			},
			connectorHidden: true,
		},
		threshold: {
			displayName: "Hold Threshold",
			tooltip: "How long in seconds it takes to activate",
			types: {
				number: {
					config: 0,
					clamp: { min: 0, max: 60, step: 0.01, showAsSlider: true },
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		result: {
			displayName: "Pressed",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as KeySensorBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	private tsk: thread | undefined;
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		this.onkFirstInputs(["key"], ({ key }) => this.output.result.set("bool", key));
		this.on(({ key, threshold }) => {
			if (key) {
				this.tsk = task.delay(threshold, () => this.output.result.set("bool", true));
				return;
			}
			if (this.tsk) task.cancel(this.tsk);
			this.output.result.set("bool", false);
		});
	}
}

export const KeySensorBlock = {
	...BlockCreation.defaults,
	id: "keysensor",
	displayName: "Key Sensor",
	description: "Returns true when the chosen button is pressed",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
