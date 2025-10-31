import { Players } from "@rbxts/services";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {
		ping: {
			displayName: "Ping",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as PingSensorLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		this.onTicc(() => {
			this.output.ping.set("number", Players.LocalPlayer.GetNetworkPing() * 2);
		});
	}
}

export const PingSensor = {
	...BlockCreation.defaults,
	id: "pingsensor",
	displayName: "Ping",
	description: "Outputs your latency",

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("ConstLogicBlockPrefab", "PING"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
