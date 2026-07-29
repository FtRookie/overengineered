import { BlockCreation } from "shared/blocks/BlockCreation";
import { MachineGunAmmoBlockLogic } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunAmmoBlocks";
import { MachineGunBarrelBlockLogic } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunBarrels";
import { MachineGunLoaderBlockLogic } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunLoaderBlock";
import { MachineGunMuzzleBlockLogic } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunMuzzleBrakes";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import { Colors } from "shared/Colors";
import type { BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, WeaponBlockType } from "shared/blocks/Block";

// Passive processors (barrel, muzzle, drum) have no inputs of their own.
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

const muzzleWc: BlockBuilder["weaponConfig"] = {
	type: "PROCESSOR" as WeaponBlockType,
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

const drumWc: BlockBuilder["weaponConfig"] = {
	type: "PROCESSOR" as WeaponBlockType,
	modifier: {
		speedModifier: {
			value: 50,
		},
	},
	markers: {},
};

export const heavyMachineGunBlockIds = [
	"heavymachinegunreceiver",
	"heavymachinegunbarrel",
	"heavymachinegunmuzzle",
] as const;

// 400 rpm on every link, receiver included: the firing block takes the slowest rate in the chain, so a
// receiver set below its barrels would cap the whole weapon under the calibre's rate.
const HEAVY_FIRE_RATE = 400 / 60;

export const HeavyMachineGunBlocks = [
	{
		...BlockCreation.defaults,
		id: "heavymachinegunreceiver",
		displayName: "Heavy Machine Gun Receiver",
		description: "Pew pew",
		limit: WeaponConfig.limits.mgLoader,

		weaponConfig: {
			type: "CORE",
			fireRate: HEAVY_FIRE_RATE,
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
					allowedBlockIds: [`heavymachinegundrum`, `heavymachinegunbarrel`, `heavymachinegunmuzzle`],
				},
				upgradeMarker: {},
			},
		},
		logic: { definition: receiverDefinition, ctor: MachineGunLoaderBlockLogic },
	},
	{
		...BlockCreation.defaults,
		id: "heavymachinegunbarrel",
		displayName: "Heavy Machine Gun Barrel",
		description: "",
		limit: WeaponConfig.limits.mgBarrels,

		weaponConfig: {
			...barrelWc,
			fireRate: HEAVY_FIRE_RATE,
			markers: {
				...barrelWc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [...heavyMachineGunBlockIds],
				},
			},
		},
		logic: { definition, ctor: MachineGunBarrelBlockLogic },
	},
	{
		...BlockCreation.defaults,
		id: "heavymachinegunmuzzle",
		displayName: "Heavy Machine Gun Muzzle",
		description: "",
		limit: WeaponConfig.limits.mgLoader,

		weaponConfig: {
			...muzzleWc,
			fireRate: HEAVY_FIRE_RATE,
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
	{
		...BlockCreation.defaults,
		id: "heavymachinegundrum",
		displayName: "Heavy Machine Gun Ammo Drum",
		description: "",
		limit: WeaponConfig.limits.mgAmmo,

		weaponConfig: {
			...drumWc,
			markers: {
				...drumWc.markers,
				upgradeMarker: {
					emitsProjectiles: true,
					allowedBlockIds: [...heavyMachineGunBlockIds],
				},
			},
		},
		logic: { definition, ctor: MachineGunAmmoBlockLogic },
	},
] as const satisfies BlockBuilder[];
