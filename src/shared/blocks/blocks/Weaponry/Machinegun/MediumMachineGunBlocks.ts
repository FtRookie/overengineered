import { BlockCreation } from "shared/blocks/BlockCreation";
import { ArmoredMachineGunBarrelBlockLogic } from "shared/blocks/blocks/Weaponry/Machinegun/ArmoredMachineGunBarrels";
import { MachineGunBarrelBlockLogic } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunBarrels";
import { MachineGunLoaderBlockLogic } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunLoaderBlock";
import { MachineGunMuzzleBlockLogic } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunMuzzleBrakes";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import { Colors } from "shared/Colors";
import type { BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, weaponBlockType } from "shared/blocks/Block";

// Passive processors (barrels, muzzle) have no inputs of their own.
const definition = {
	input: {},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

// The receiver is the firing CORE — same firing inputs as the Machine Gun Loader.
const receiverDefinition = {
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

const barrelWc: BlockBuilder["weaponConfig"] = {
	type: "PROCESSOR" as weaponBlockType,
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

const armoredBarrelWc: BlockBuilder["weaponConfig"] = {
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

const muzzleWc: BlockBuilder["weaponConfig"] = {
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

const barrelAllowedBlockIds = [`mediumreceiver`, `mediummgbarrel`, `armoredmediummgbarrel`, `mediummuzzlebrake`];

export const MediumMachineGunBlocks = [
	{
		...BlockCreation.defaults,
		id: "mediumreceiver",
		displayName: "Medium Machine Gun Receiver",
		description: "Pew pew",
		limit: WeaponConfig.limits.mgLoader,

		weaponConfig: {
			type: "CORE",
			fireRate: 5.3,
			modifier: {
				impactDamage: {
					value: 130,
				},
				speedModifier: {
					value: 1000,
				},
			},
			markers: {
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [`mediummgbarrel`, `armoredmediummgbarrel`, `mediummuzzlebrake`],
				},
				upgradeMarker: {},
			},
		},
		logic: { definition: receiverDefinition, ctor: MachineGunLoaderBlockLogic },
	},
	{
		...BlockCreation.defaults,
		id: "mediummgbarrel",
		displayName: "Medium Machine Gun Barrel",
		description: "",
		limit: WeaponConfig.limits.mgBarrels,

		weaponConfig: {
			...barrelWc,
			markers: {
				...barrelWc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: barrelAllowedBlockIds,
				},
			},
		},
		logic: { definition, ctor: MachineGunBarrelBlockLogic },
	},
	{
		...BlockCreation.defaults,
		id: "armoredmediummgbarrel",
		displayName: "Armored Medium Machine Gun Barrel",
		description: "",
		limit: WeaponConfig.limits.armoredMgBarrels,

		weaponConfig: {
			...armoredBarrelWc,
			markers: {
				...armoredBarrelWc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: barrelAllowedBlockIds,
				},
			},
		},
		logic: { definition, ctor: ArmoredMachineGunBarrelBlockLogic },
	},
	{
		...BlockCreation.defaults,
		id: "mediummuzzlebrake",
		displayName: "Medium Machine Gun Muzzle",
		description: "",
		limit: WeaponConfig.limits.mgLoader,

		weaponConfig: {
			...muzzleWc,
			markers: {
				...muzzleWc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [],
				},
			},
		},
		logic: { definition, ctor: MachineGunMuzzleBlockLogic },
	},
] as const satisfies BlockBuilder[];
