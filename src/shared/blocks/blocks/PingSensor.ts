import { Players } from "@rbxts/services";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {
		ping: {
			displayName: "PING",
			tooltip: "Server lanency",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as PingSensorLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		let ping = 0;
		this.onTicc(({ dt }) => {
			ping = Players.LocalPlayer.GetNetworkPing() * 2;
			this.output.ping.set("number", ping);
		});
	}
}

export const PingSensor = {
	...BlockCreation.defaults,
	id: "pingsensor",
	displayName: "Ping",
	description: "Ping latency",

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("ConstLogicBlockPrefab", "PING"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
