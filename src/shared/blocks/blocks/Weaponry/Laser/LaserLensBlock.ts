import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as LaserLensBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
	}
}

export const LaserLensBlock = {
	...BlockCreation.defaults,
	id: "laserlens",
	displayName: "Laser Lens",
	description: "Like a magnifying glass to an ant hill",
	limit: WeaponConfig.limits.laserLens,
	weaponConfig: {
		type: "PROCESSOR",
		modifier: {
			speedModifier: {
				value: 1.01,
				isRelative: true,
			},
			heatDamage: {
				value: 1.25, // Yes multiplier kinda busted
				isRelative: true,
			},
		},
		markers: {
			inputMarker: {
				allowedBlockIds: [],
			},
			marker1: {
				emitsProjectiles: true,
				allowedBlockIds: ["laserlens"],
			},
		},
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
