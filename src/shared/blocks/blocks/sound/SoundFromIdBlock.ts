import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		id: {
			displayName: "Asset ID",
			types: {
				string: {
					config: "584691395",
				},
				number: {
					config: 584691395,
				},
			},
		},
	},
	output: {
		sound: {
			displayName: "Sound",
			types: ["sound"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		this.onk(["id"], ({ id }) => {
			if (typeIs(id, "string") && id.startsWith("rbxassetid://")) {
				this.output.sound.set("sound", { id: id.sub("rbxassetid://".size()) });
				return;
			}

			this.output.sound.set("sound", { id: tostring(id) });
		});
	}
}

export const SoundFromIdBlock = {
	...BlockCreation.defaults,
	id: "soundfromid",
	displayName: "Sound From ID",
	description: "Creates the sound object from a roblox asset id.",
	search: {
		partialAliases: ["sound", "from", "from string"],
	},

	modelSource: {
		model: BlockCreation.Model.fAutoCreated("SoundLogicBlockPrefab", `SOUND FROM ID`),
		category: () => BlockCreation.Categories.sound,
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
