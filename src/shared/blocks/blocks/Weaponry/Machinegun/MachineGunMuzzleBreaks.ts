import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, weaponBlockType } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as MachineGunMuzzleBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
	}
}

const wc: BlockBuilder["weaponConfig"] = {
	type: "PROCESSOR" as weaponBlockType,
	modifier: {
		speedModifier: {
			value: 1.5,
		},
	},
	markers: {
		output1: {},
		inputMarker: {},
	},
};

export const MachineGunMuzzleBreaks = [
	{
		...BlockCreation.defaults,
		id: "heavymuzzlebreak",
		displayName: "Heavy Machine Gun Muzzle",
		description: "",

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [],
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
	{
		...BlockCreation.defaults,
		id: "mediummuzzlebreak",
		displayName: "Medium Machine Gun Muzzle",
		description: "",

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [],
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
	{
		...BlockCreation.defaults,
		id: "lightmuzzlebreak",
		displayName: "Light Machine Gun Muzzle",
		description: "",

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [],
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
] as const satisfies BlockBuilder[];
