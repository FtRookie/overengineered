import { RunService } from "@rbxts/services";
import { S2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { t } from "engine/shared/t";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { notifyAssemblySplit } from "shared/blocks/blocks/MassSensorBlock";
import { PartUtils } from "shared/utils/PartUtils";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		disconnect: {
			displayName: "Disconnect",
			types: {
				bool: {
					config: false,
					control: {
						config: {
							enabled: true,
							key: "F",
							reversed: false,
							switch: false,
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

export type DisconnectorBlock = BlockModel & {
	BottomPart: Part;
	TopPart: Part;
};

const disconnectEventType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<DisconnectorBlock>(),
});
type DisconnectData = t.Infer<typeof disconnectEventType>;

/** Client-visible half; the server destroys the ejector authoritatively in DisconnectBlockServerLogic. */
const disconnect = ({ block }: DisconnectData) => {
	block.FindFirstChild("Ejector")?.Destroy();
};

const events = {
	disconnect: new BlockSynchronizer("b_disconnectblock_disconnect", disconnectEventType, disconnect),
} as const;

export type { Logic as DisconnectBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, DisconnectorBlock> {
	static readonly events = events;

	// Kept off `events`: the controller registers block-validity middleware on every entry there, and an
	// S2C event has no such method. The server is the only sender, so there is nothing to validate anyway.
	static readonly disconnect2c = new S2CRemoteEvent<{ readonly block: DisconnectorBlock }>(
		"b_disconnectblock_disconnect2c",
	);

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		this.onk(["disconnect"], ({ disconnect }) => {
			if (!disconnect) return;

			PartUtils.pinAssemblyVelocity(block.instance.FindFirstChild("BottomPart") as BasePart);
			PartUtils.pinAssemblyVelocity(block.instance.FindFirstChild("TopPart") as BasePart);

			events.disconnect.sendOrBurn({ block: this.instance }, this);
			notifyAssemblySplit(this.instance);
			this.disable();
		});
	}
}

if (RunService.IsClient()) {
	Logic.disconnect2c.invoked.Connect(({ block }) => {
		PartUtils.unpinAssemblyVelocity(block.FindFirstChild("BottomPart"));
		PartUtils.unpinAssemblyVelocity(block.FindFirstChild("TopPart"));
	});
}

export const DisconnectBlock = {
	...BlockCreation.defaults,
	id: "disconnectblock",
	displayName: "Disconnector",
	description: "Detaches connected parts",

	logic: { definition, ctor: Logic, events },
} as const satisfies BlockBuilder;
