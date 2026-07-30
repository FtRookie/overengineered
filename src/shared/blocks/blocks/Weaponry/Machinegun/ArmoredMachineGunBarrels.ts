import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { MachineGunBarrels } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunBarrels";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, WeaponBlockType } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type ArmoredMachineGunBarrelModel = BlockModel & {
	readonly ColBox: BasePart;
	readonly MainPart: BasePart;
	readonly moduleMarkers: Folder;
};

export { Logic as ArmoredMachineGunBarrelBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, ArmoredMachineGunBarrelModel> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
	}
}

const wc: BlockBuilder["weaponConfig"] = {
	type: "PROCESSOR" as WeaponBlockType,
	modifier: {
		speedModifier: {
			value: 1.02,
			isRelative: true,
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
		id: "armoredlightmgbarrel",
		displayName: "Armored Light Machine Gun Barrel",
		description: "",
		limit: WeaponConfig.limits.armoredMgBarrels,

		weaponConfig: {
			...wc,
			fireRate: 800 / 60, // rpm
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
] as const satisfies BlockBuilder[];
