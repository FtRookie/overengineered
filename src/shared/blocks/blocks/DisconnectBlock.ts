import { RunService } from "@rbxts/services";
import { A2SRemoteEvent, S2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
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

export type disconnectorBlock = BlockModel & {
	BottomPart: Part;
	TopPart: Part;
};

export type { Logic as DisconnectBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, disconnectorBlock> {
	static readonly events = {
		disconnect: new A2SRemoteEvent<{ readonly block: disconnectorBlock }>("b_disconnectblock_disconnect"),
		disconnect2c: new S2CRemoteEvent<{ readonly block: disconnectorBlock }>("b_disconnectblock_disconnect2c"),
	} as const;

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

			Logic.events.disconnect.send({ block: this.instance });
			this.disable();
		});
	}

	static disconnect(block: BlockModel) {
		(block.FindFirstChild("Ejector") as Part | undefined)?.Destroy();
	}
}

if (RunService.IsClient()) {
	Logic.events.disconnect2c.invoked.Connect(({ block }) => {
		block.FindFirstChild("BottomPart")?.FindFirstChild("deleted")?.Destroy();
		block.FindFirstChild("TopPart")?.FindFirstChild("deleted")?.Destroy();
	});
}

export const DisconnectBlock = {
	...BlockCreation.defaults,
	id: "disconnectblock",
	displayName: "Disconnector",
	description: "Detaches connected parts",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
