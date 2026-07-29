import { BlockCreation } from "shared/blocks/BlockCreation";
import { CannonBarrelBlockLogic } from "shared/blocks/blocks/Weaponry/Cannon/CannonBarrels";
import { CannonBreechBlockLogic } from "shared/blocks/blocks/Weaponry/Cannon/CannonBreechBlock";
import { WeaponConfig } from "shared/blocks/blocks/Weaponry/WeaponConfig";
import { Colors } from "shared/Colors";
import type { BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, WeaponBlockType } from "shared/blocks/Block";

// Passive processors (barrel, muzzle) have no inputs of their own.
const definition = {
	input: {},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

// The breech is the firing CORE — same firing inputs as the original Cannon Breech.
const breechDefinition = {
	input: {
		projectileColor: {
			displayName: "Projectile Color",
			types: {
				color: {
					config: Colors.pink,
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

const barrelAllowedBlockIds = [
	`mediumcannonbreech`,
	`mediumcannonbarrel`,
	`mediumcannonboreevacuator`,
	`mediumcannonmuzzle`,
];

export const MediumCannonBlocks = [
	{
		...BlockCreation.defaults,
		id: "mediumcannonbreech",
		displayName: "Medium Cannon Breech",
		description: "Medium boom",
		limit: WeaponConfig.limits.cannon,

		weaponConfig: {
			type: "CORE",
			fireRate: 1 / 8, // one shot every 8s
			blast: WeaponConfig.cannonBlast.medium,
			modifier: {
				speedModifier: {
					value: 1000,
				},
			},
			markers: {
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [`mediumcannonbarrel`, `mediumcannonboreevacuator`, `mediumcannonmuzzle`],
				},
				inputMarker: {},
			},
		},
		logic: { definition: breechDefinition, ctor: CannonBreechBlockLogic },
	},
	{
		...BlockCreation.defaults,
		id: "mediumcannonbarrel",
		displayName: "Medium Cannon Barrel",
		description: "",
		limit: WeaponConfig.limits.cannonBarrels,

		weaponConfig: {
			...barrelWc,
			fireRate: 1 / 8, // one shot every 8s
			blast: WeaponConfig.cannonBlast.medium,
			markers: {
				...barrelWc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: barrelAllowedBlockIds,
				},
			},
		},
		logic: { definition, ctor: CannonBarrelBlockLogic },
	},
	{
		...BlockCreation.defaults,
		id: "mediumcannonboreevacuator",
		displayName: "Medium Cannon Bore Evacuator",
		description: "",
		limit: WeaponConfig.limits.cannonBarrels,

		weaponConfig: {
			...barrelWc,
			fireRate: 1 / 8, // one shot every 8s
			blast: WeaponConfig.cannonBlast.medium,
			// Scavenges propellant gas rather than adding muzzle velocity, so it carries no speed of its
			// own — it is a barrel fitting, not a barrel extension.
			modifier: {},
			markers: {
				...barrelWc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: barrelAllowedBlockIds,
				},
			},
		},
		logic: { definition, ctor: CannonBarrelBlockLogic },
	},
	{
		...BlockCreation.defaults,
		id: "mediumcannonmuzzle",
		displayName: "Medium Cannon Muzzle",
		description: "",
		limit: WeaponConfig.limits.cannon,

		weaponConfig: {
			...muzzleWc,
			fireRate: 1 / 8, // one shot every 8s
			blast: WeaponConfig.cannonBlast.medium,
			markers: {
				...muzzleWc.markers,
				output1: {
					emitsProjectiles: true,
					allowedBlockIds: [],
				},
			},
		},
		logic: { definition, ctor: CannonBarrelBlockLogic },
	},
] as const satisfies BlockBuilder[];
