import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as PlasmaShotgunMuzzleBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
	}
}

export const PlasmaShotgunMuzzleBlock = {
	...BlockCreation.defaults,
	id: "plasmashotgunmuzzle",
	displayName: "Plasma Shotgun Muzzle",
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
			output3: {
				emitsProjectiles: true,
			},
			output4: {
				emitsProjectiles: true,
			},
			output5: {
				emitsProjectiles: true,
			},
			output6: {
				emitsProjectiles: true,
			},
			output7: {
				emitsProjectiles: true,
			},
			output8: {
				emitsProjectiles: true,
			},
			output9: {
				emitsProjectiles: true,
			},
		},
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
