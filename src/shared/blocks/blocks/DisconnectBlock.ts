import { RunService } from "@rbxts/services";
import { S2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { t } from "engine/shared/t";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
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

			const newPart = (parent: BasePart) => {
				const part = new Instance("Part");
				part.Name = "deleted";
				part.CFrame = parent.CFrame;
				part.AssemblyLinearVelocity = parent.AssemblyLinearVelocity;
				part.AssemblyAngularVelocity = parent.AssemblyAngularVelocity;
				part.Size = Vector3.zero;
				part.RootPriority = 127;
				part.Parent = parent;

				const weld = new Instance("WeldConstraint");
				weld.Part0 = part;
				weld.Part1 = parent;
				weld.Parent = part;
			};
			newPart(block.instance.FindFirstChild("BottomPart") as BasePart);
			newPart(block.instance.FindFirstChild("TopPart") as BasePart);

			events.disconnect.sendOrBurn({ block: this.instance }, this);
			this.disable();
		});
	}
}

if (RunService.IsClient()) {
	Logic.disconnect2c.invoked.Connect(({ block }) => {
		block.FindFirstChild("BottomPart")?.FindFirstChild("deleted")?.Destroy();
		block.FindFirstChild("TopPart")?.FindFirstChild("deleted")?.Destroy();
	});
}

export const DisconnectBlock = {
	...BlockCreation.defaults,
	id: "disconnectblock",
	displayName: "Disconnector",
	description: "Detaches connected parts",

	logic: { definition, ctor: Logic, events },
} as const satisfies BlockBuilder;
