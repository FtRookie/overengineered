import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, weaponBlockType } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as CannonBaseBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
	}
}

const wc: BlockBuilder["weaponConfig"] = {
	type: "PROCESSOR" as weaponBlockType,
	modifier: {
		speedModifier: {
			value: 1000,
		},
	},
	markers: {
		output1: {},
		inputMarker: {},
	},
};

export const CannonBases = [
	{
		...BlockCreation.defaults,
		id: "heavycannonbase",
		displayName: "Heavy Cannon Base",
		description: "",

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [`heavycannonbarrel`, `heavycannonbase`],
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
	{
		...BlockCreation.defaults,
		id: "mediumcannonbase",
		displayName: "Medium Cannon Base",
		description: "",

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [`mediumcannonbarrel`, `mediumcannonbase`],
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
	{
		...BlockCreation.defaults,
		id: "lightcannonbase",
		displayName: "Light Cannon Base",
		description: "",

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [`lightcannonbarrel`, `lightcannonbase`],
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
] as const satisfies BlockBuilder[];
