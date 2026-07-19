import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import type { DistanceUnit } from "shared/data/GameDefinitions";

const definition = {
	input: {
		unit: {
			displayName: "Unit",
			types: {
				enum: {
					config: "studs",
					elementOrder: ["studs", "meters"],
					elements: {
						studs: { displayName: "Studs", tooltip: "The default unit of Roblox" },
						meters: { displayName: "Meters", tooltip: "100x the standard metric unit of length" },
						feet: { displayName: "Feet", tooltip: "About a third of a meter" },
						miles: { displayName: "Miles", tooltip: "5280 feet" },
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		result: {
			displayName: "Global Position",
			unit: "Coordinates",
			types: ["vector3"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as GPSSensorBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		// unit is config-only, so resolve the multiplier once instead of re-reading it every tick
		let unitMul = GameDefinitions.STUDS_TO.studs;
		this.onkFirstInputs(["unit"], ({ unit }) => (unitMul = GameDefinitions.STUDS_TO[unit as DistanceUnit]));
		const applyUnit = (v: number) => v * unitMul;

		const offset = new Vector3(0, -GameDefinitions.HEIGHT_OFFSET, 0);
		this.event.subscribe(RunService.PostSimulation, () => {
			const curr = offset.add(block.instance.GetPivot().Position);
			this.output.result.set("vector3", curr.apply(applyUnit));
		});
	}
}

export const GPSSensorBlock = {
	...BlockCreation.defaults,
	id: "gpssensor",
	displayName: "GPS",
	description: "Returns its global position",

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("DoubleGenericLogicBlockPrefab", "GPS"),
		category: () => BlockCreation.Categories.sensor,
	},
} as const satisfies BlockBuilder;
