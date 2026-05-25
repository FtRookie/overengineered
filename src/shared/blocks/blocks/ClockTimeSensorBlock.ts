import { Lighting } from "@rbxts/services";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, BlockCategoryPath, BlockModelSource } from "shared/blocks/Block";

const autoModel = (prefab: BlockCreation.Model.PrefabName, text: string, category: BlockCategoryPath) => {
	return {
		model: BlockCreation.Model.fAutoCreated(prefab, text),
		category: () => category,
	} satisfies BlockModelSource;
};
const definition = {
	input: {},
	output: {
		clocktime: {
			displayName: "Clock Time",
			types: ["number"],
		},
		timeofday: {
			displayName: "Time of Day",
			types: ["string"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as ClockTimeSensorBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		this.onEnable(() => {
			this.output.clocktime.set("number", Lighting.ClockTime);
			this.output.timeofday.set("string", Lighting.TimeOfDay);
		});

		this.event.subscribe(Lighting.LightingChanged, () => {
			this.output.clocktime.set("number", Lighting.ClockTime);
			this.output.timeofday.set("string", Lighting.TimeOfDay);
		});
	}
}

export const ClockTimeSensorBlock = {
	...BlockCreation.defaults,
	id: "clocktimesensor",
	displayName: "Clock Time Sensor",
	description: "Outputs current TimeOfDay, and ClockTime, updates on Lighting change",
	search: { partialAliases: ["clock", "hour", "daylight", "day", "night"] },
	modelSource: autoModel("DoubleGenericLogicBlockPrefab", "CLOCK TIME", BlockCreation.Categories.sensor),

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
