import { Players } from "@rbxts/services";
import { PerFrame } from "engine/shared/PerFrame";
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

// GetNetworkPing is the round trip already (Player:GetNetworkPing reference, and it reads below Shift+F3's Data Ping)
const ping = new PerFrame(() => Players.LocalPlayer.GetNetworkPing());

export type { Logic as PingSensorLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		this.onTicc(() => {
			this.output.ping.set("number", ping.get());
		});
		this.unsetOutputsOnDisable();
	}
}

export const PingSensor = {
	...BlockCreation.defaults,
	id: "pingsensor",
	logicPriority: BlockCreation.priority.Sensor,
	displayName: "Ping",
	description: "Outputs your round-trip latency in seconds",

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("ConstLogicBlockPrefab", "PING"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
