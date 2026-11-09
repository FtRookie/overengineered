import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { inferEnumLogicType } from "shared/blockLogic/BlockLogicTypes";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		impulse: {
			displayName: "Impulse",
			types: {
				bool: {
					config: false,
				},
			},
			configHidden: true, // Because why
		},
		type: {
			displayName: "Type",
			types: {
				enum: inferEnumLogicType({
					config: "rtrig",
					elementOrder: ["rtrig", "ftrig", "both"],
					elements: {
						rtrig: { displayName: "Rise", tooltip: "Detects a rising edge of the input" },
						ftrig: { displayName: "Fall", tooltip: "Detects a falling edge of the input" },
						both: { displayName: "Both", tooltip: "Detects both edges of the input" },
					},
				}),
			},
			connectorHidden: true,
		},
	},
	output: {
		value: {
			displayName: "Output",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as SingleImpulseBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		let wasImpulsedLastTick = false;
		this.onTicc(() => {
			if (!wasImpulsedLastTick) return;
			wasImpulsedLastTick = false;
			this.output.value.set("bool", false);
		});
		this.output.value.set("bool", false);

		this.on(({ impulse, type: trig_side, impulseChanged }) => {
			if (!impulseChanged) return;

			if (trig_side === "both" || (impulse && trig_side === "rtrig") || (!impulse && trig_side === "ftrig")) {
				wasImpulsedLastTick = true;
				this.output.value.set("bool", true);
			}
		});
	}
}
//
export const SingleImpulseBlock = {
	...BlockCreation.defaults,
	id: "singleimpulse",
	displayName: "Signal Edge Detector",
	description: "Generates a single tick pulse from input boolean",
	search: {
		partialAliases: ["edge", "rise", "single", "impulse", "edging", "ambusin"],
	},

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("GenericLogicBlockPrefab", "Edge Detector"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
