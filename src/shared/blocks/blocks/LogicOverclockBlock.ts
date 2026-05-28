import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { SharedMachine } from "shared/blockLogic/SharedMachine";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["type", "multiplier"],
	input: {
		type: {
			displayName: "Type",
			connectorHidden: true,
			types: {
				enum: {
					config: "speedup",
					elementOrder: ["speedup", "slowdown"],
					elements: {
						speedup: { displayName: "Speedup" },
						slowdown: { displayName: "Slowdown" },
					},
				},
			},
		},
		multiplier: {
			displayName: "Multiplier",
			types: {
				number: {
					config: 1,
					clamp: {
						showAsSlider: false,
						min: 1,
						max: 1000000,
						step: 1,
					},
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as LogicOverclockBlockLogic };
@injectable
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs, @inject machine: SharedMachine) {
		super(definition, block);

		this.onk(["type", "multiplier"], ({ type: t, multiplier }) => {
			machine.runner.overclock.set({ type: t as "speedup" | "slowdown", multiplier });
		});
	}
}

export const LogicOverclockBlock = {
	...BlockCreation.defaults,
	id: "logicoverclock",
	displayName: "Logic overclock",
	description: "Speeds up or slows down the logic processing",
	limit: 1,

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("DoubleGenericLogicBlockPrefab", "OVER"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
