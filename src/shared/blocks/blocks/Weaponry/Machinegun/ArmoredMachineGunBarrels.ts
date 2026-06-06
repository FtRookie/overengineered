import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { MachineGunBarrels } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunBarrels";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, weaponBlockType } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export { Logic as ArmoredMachineGunBarrelBlockLogic };
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

export const ArmoredMachineGunBarrels = [
	{
		...BlockCreation.defaults,
		id: "armoredheavymgbarrel",
		displayName: "Armored Heavy Machine Gun Barrel",
		description: "",
		limit: WeaponConfig.limits.armoredMgBarrels,

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: MachineGunBarrels[0].weaponConfig.markers.output1.allowedBlockIds,
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
	{
		...BlockCreation.defaults,
		id: "armoredlightmgbarrel",
		displayName: "Armored Light Machine Gun Barrel",
		description: "",
		limit: WeaponConfig.limits.armoredMgBarrels,

		weaponConfig: {
			...wc,
			markers: {
				...wc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: MachineGunBarrels[1].weaponConfig.markers.output1.allowedBlockIds,
				},
			},
		},
		logic: { definition, ctor: Logic },
	},
] as const satisfies BlockBuilder[];
