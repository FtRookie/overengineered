import { BlockCreation } from "shared/blocks/BlockCreation";
import { MachineGunBarrels } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunBarrels";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import { Colors } from "shared/Colors";
import type { BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, weaponBlockType } from "shared/blocks/Block";
import type { Logic } from "shared/blocks/blocks/MotorBlock";

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

const definition = {
	input: {
		projectileColor: {
			displayName: "Tracer Color",
			types: {
				color: {
					config: Colors.yellow,
				},
			},
		},
		fireTrigger: {
			displayName: "Fire",
			types: {
				bool: {
					config: false,
					control: {
						config: {
							enabled: true,
							key: "F",
							switch: false,
							reversed: false,
						},
						canBeReversed: false,
						canBeSwitch: false,
					},
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

const list = {
	mediummuzzlebrake: {
		...BlockCreation.defaults,
		displayName: "Medium Machine Gun Muzzle",
		description: "",
		limit: WeaponConfig.limits.mgLoader,

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
	mediummgbarrel: {
		...BlockCreation.defaults,
		displayName: "Medium Machine Gun Barrel",
		description: "",
		limit: WeaponConfig.limits.mgBarrels,

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
	armoredmediummgbarrel: {
		...BlockCreation.defaults,

		displayName: "Armored Medium Machine Gun Barrel",
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
};
export const MediumMachineGunBlocks = BlockCreation.arrayFromObject(list);
