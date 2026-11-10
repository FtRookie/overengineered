import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {
		fps: {
			displayName: "TPS",
			tooltip: "Ticks per second",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as TpsCounterBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		let tps = 0;
		this.onTicc(({ dt }) => {
			tps = (tps + 1 / dt) / 2;

			// if fps is not a normal number, reset
			if (tps === math.huge || tps === -math.huge || tps !== tps) {
				tps = 0;
			}
			if (tps === 0) {
				this.output.fps.unset();
				return;
			}

			this.output.fps.set("number", tps);
		});
	}
}

export const TpsCounterBlock = {
	...BlockCreation.defaults,
	id: "tpscounter",
	logicPriority: BlockCreation.priority.Sensor,
	displayName: "TPS Counter",
	description: "Returns your current Ticks per Second",

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("ConstLogicBlockPrefab", "TPS"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
