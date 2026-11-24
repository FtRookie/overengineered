import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, BlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["weight", "useSeat"],
	input: {
		weight: {
			displayName: "Weight",
			tooltip: "How likely you are to spawn here, 0 disables it",
			types: {
				number: {
					config: 1,
					clamp: { showAsSlider: false, min: 0, max: 1000 },
				},
			},
			connectorHidden: true,
		},
		useSeat: {
			displayName: "Use Vehicle Seat",
			tooltip: "Whether or not to prioritize the Vehicle Seat over this spawn block",
			types: {
				bool: {
					config: false,
				},
			},
			connectorHidden: true,
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

/** Read by the server when a ride starts; the block does nothing while riding */
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);
	}
}

export const SpawnBlock = {
	...BlockCreation.defaults,
	id: "spawn",
	displayName: "Spawn",
	description: "Choose where to start Ride mode",

	logic: { definition, ctor: Logic },
	search: { partialAliases: ["spawnpoint", "spawnlocation"] },
} as const satisfies BlockBuilder;
