import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as PlasmaSeparatorMuzzleBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
	}
}

export const PlasmaSeparatorMuzzleBlock = {
	...BlockCreation.defaults,
	id: "plasmaseparatormuzzle",
	displayName: "Plasma Separator Muzzle",
	description: "",

	weaponConfig: {
		type: "PROCESSOR",
		modifier: {},
		markers: {
			inputMarker: {},
			output1: {
				emitsProjectiles: true,
			},
			output2: {
				emitsProjectiles: true,
			},
		},
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
