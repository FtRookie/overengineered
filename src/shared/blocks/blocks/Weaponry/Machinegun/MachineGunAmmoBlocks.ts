import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { MachineGunBarrels } from "shared/blocks/blocks/Weaponary/Machinegun/MachineGunBarrels";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, weaponBlockType } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as MachineGunAmmoBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
	}
}

const wc: BlockBuilder["weaponConfig"] = {
	type: "PROCESSOR" as weaponBlockType,
	modifier: {},
	markers: {},
};

export const MachineGunAmmoBlocks = [
	{
		...BlockCreation.defaults,
		id: "apammo",
		displayName: "Machine Gun AP Ammo Box",
		description: "",

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				upgradeMarker: {
					emitsProjectiles: true,
					allowedBlockIds: MachineGunBarrels[0].weaponConfig.markers.output1.allowedBlockIds,
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
	{
		...BlockCreation.defaults,
		id: "ammunitionblock",
		displayName: "Machine Gun Ammo Box",
		description: "",

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				upgradeMarker: {
					emitsProjectiles: true,
					allowedBlockIds: MachineGunBarrels[1].weaponConfig.markers.output1.allowedBlockIds,
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
	{
		...BlockCreation.defaults,
		id: "incendiaryammunition",
		displayName: "Machine Gun Ammo Box",
		description: "",

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				upgradeMarker: {
					emitsProjectiles: true,
					allowedBlockIds: MachineGunBarrels[2].weaponConfig.markers.output1.allowedBlockIds,
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
] as const satisfies BlockBuilder[];
