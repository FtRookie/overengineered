import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		sound: {
			displayName: "Sound",
			types: {
				sound: {
					config: { id: "584691395" },
				},
			},
			configHidden: true,
		},
	},
	output: {
		length: {
			displayName: "Sound length",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const soundInstance = new Instance("Sound", this.instance.PrimaryPart);
		soundInstance.Loaded.Connect(() => {
			this.output.length.set("number", soundInstance.TimeLength);
		});

		this.onk(["sound"], ({ sound }) => {
			soundInstance.SoundId = `rbxassetid://${sound.id}`;

			if (soundInstance.IsLoaded) {
				this.output.length.set("number", soundInstance.TimeLength);
			} else {
				this.output.length.unset();
			}
		});
	}
}

export const SoundLengthBlock = {
	...BlockCreation.defaults,
	id: "soundlength",
	displayName: "Sound Length",
	description: "Returns the length of the sound, in seconds.",
	search: {
		partialAliases: ["sound"],
	},

	modelSource: {
		model: BlockCreation.Model.fAutoCreated("SoundLogicBlockPrefab", `LENGTH`),
		category: () => BlockCreation.Categories.sound,
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
