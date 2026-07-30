import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, WeaponBlockType } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type CannonBarrelModel = BlockModel & {
	readonly ColBox: BasePart;
	readonly MainPart: BasePart;
	readonly moduleMarkers: Folder;
};

export { Logic as CannonBarrelBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, CannonBarrelModel> {
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
		output1: {}, // generated in the end of the file!
		inputMarker: {},
	},
};

export const CannonBarrels = [
	{
		...BlockCreation.defaults,
		id: "heavycannonbarrel",
		displayName: "Heavy Cannon Barrel",
		description: "",
		limit: WeaponConfig.limits.cannonBarrels,

		weaponConfig: {
			...wc,
			fireRate: 1 / 12, // one shot every 12s
			blast: WeaponConfig.cannonBlast.heavy,
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
		id: "lightcannonbarrel",
		displayName: "Light Cannon Barrel",
		description: "",
		limit: WeaponConfig.limits.cannonBarrels,

		weaponConfig: {
			...wc,
			fireRate: 1 / 6, // one shot every 6s
			blast: WeaponConfig.cannonBlast.light,
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
