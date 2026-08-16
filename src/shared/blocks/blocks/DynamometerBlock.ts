import { CalculatableBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type {
	AllInputKeysToObject,
	AllOutputKeysToObject,
	BlockLogicArgs,
	BlockLogicFullBothDefinitions,
} from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import type { PowerUnit } from "shared/data/GameDefinitions";

const definition = {
	inputOrder: ["torque", "angularSpeed", "unit"],
	input: {
		torque: {
			displayName: "Torque",
			tooltip: "Roblox torque, as configured on a motor or servo",
			types: {
				number: { config: 0 as number },
			},
		},
		angularSpeed: {
			displayName: "Angular Speed",
			tooltip: "Radians per second, the default unit of the Speedometer",
			types: {
				number: { config: 0 as number },
			},
		},
		unit: {
			displayName: "Unit",
			types: {
				enum: {
					config: "hp",
					elementOrder: ["hp", "kw", "w"],
					elements: {
						hp: { displayName: "Horsepower", tooltip: "Mechanical horsepower, 550 pound-feet per second" },
						kw: { displayName: "Kilowatts", tooltip: "Thousands of watts" },
						w: { displayName: "Watts", tooltip: "Newton-meters per second" },
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		result: {
			displayName: "Power",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as DynamometerBlockLogic };
class Logic extends CalculatableBlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);
	}

	protected override calculate({
		torque,
		angularSpeed,
		unit,
	}: AllInputKeysToObject<(typeof definition)["input"]>): AllOutputKeysToObject<(typeof definition)["output"]> {
		return {
			result: {
				type: "number",
				value: torque * angularSpeed * GameDefinitions.POWER_TO[unit as PowerUnit],
			},
		};
	}
}

export const DynamometerBlock = {
	...BlockCreation.defaults,
	id: "dynamometer",
	displayName: "Dynamometer",
	description: "Calculates power from torque and angular speed.",
	search: { aliases: ["dyno"] },

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("DoubleGenericLogicBlockPrefab", "DYNO"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
