import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as PlasmaGunBarrelBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
	}
}

export const PlasmaGunBarrelBlock = {
	...BlockCreation.defaults,
	id: "plasmagunbarrel",
	displayName: "Plasma Gun Barrel",
	description: "",

	weaponConfig: {
		type: "PROCESSOR",
		modifier: {
			speedModifier: {
				value: 1.01,
				isRelative: true,
			},
		},
		markers: {
			inputMarker: {},
			output1: {
				emitsProjectiles: true,
				allowedBlockIds: ["plasmagunbarrel", "plasmaseparatormuzzle", "plasmashotgunmuzzle"],
			},
		},
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
