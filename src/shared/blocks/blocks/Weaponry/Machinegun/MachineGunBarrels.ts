import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, weaponBlockType } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as MachineGunBarrelBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
	}
}

const wc: BlockBuilder["weaponConfig"] = {
	type: "PROCESSOR" as weaponBlockType,
	modifier: {
		speedModifier: {
			value: 1.02,
		},
	},
	markers: {
		output1: {},
		inputMarker: {},
	},
};

export const MachineGunBarrels = [
	{
		...BlockCreation.defaults,
		id: "heavymgbarrel",
		displayName: "Heavy Machine Gun Barrel",
		description: "",

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [`mgloader`, `heavymgbarrel`, "armoredheavymgbarrel", `heavymuzzlebrake`],
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
	{
		...BlockCreation.defaults,
		id: "mediummgbarrel",
		displayName: "Medium Machine Gun Barrel",
		description: "",

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [`mgloader`, `armoredmediummgbarrel`, `heavymgbarrel`, `heavymuzzlebrake`],
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
	{
		...BlockCreation.defaults,
		id: "lightmgbarrel",
		displayName: "Light Machine Gun Barrel",
		description: "",

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [`mgloader`, `armoredlightmgbarrel`, `lightmgbarrel`, `lightmuzzlebrake`],
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
] as const satisfies BlockBuilder[];
