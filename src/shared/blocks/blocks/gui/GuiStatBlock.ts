import { RunService } from "@rbxts/services";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { dataToString } from "shared/blocks/blocks/ScreenBlock";
import type { RideMode } from "client/modes/ride/RideMode";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["name", "text"],
	input: {
		name: {
			displayName: "Name",
			types: {
				string: { config: "Altitude" },
			},
		},
		text: {
			displayName: "Text",
			types: {
				bool: { config: false },
				byte: { config: 0 },
				number: { config: 0 },
				string: { config: "" },
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as GuiStatBlockLogic };
@injectable
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs, @inject rideMode: RideMode) {
		super(definition, block);
		if (!RunService.IsClient()) return;

		this.onEnable(() => {
			task.defer(() => {
				const scene = rideMode.rideModeScene;
				const gui = scene.infoTextTemplate();
				gui.FormattedText!.Text = "%s";

				const control = scene.addMeter(gui);
				this.onDisable(() => control.destroy());

				this.onk(["name"], ({ name }) => (gui.Title.Text = name.upper()));
				this.onk(["text"], ({ text }) => control.text.value.set(dataToString(text)));
			});
		});
	}
}

export const GuiStatBlock = {
	...BlockCreation.defaults,
	id: "guistat",
	displayName: "GUI Meter",
	description: "Writes text as a meter in the top left part of your screen",

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("DoubleGuiLogicBlockPrefab", "METER"),
		category: () => BlockCreation.Categories.gui,
	},
} as const satisfies BlockBuilder;
