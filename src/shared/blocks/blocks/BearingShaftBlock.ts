import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {
		result: {
			displayName: "Axle angle",
			unit: "Radians",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type BlockDefinition = BlockModel & {
	readonly Union: BasePart;
	readonly Part: BasePart;
};

export type { Logic as BearingShaftBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, BlockDefinition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const base = this.instance.Union;
		const axle = this.instance.Part;
		const initial = base.GetPivot().ToObjectSpace(axle.GetPivot()).ToEulerAnglesXYZ()[0];

		this.event.subscribe(RunService.PostSimulation, () => {
			const [x] = base.GetPivot().ToObjectSpace(axle.GetPivot()).ToEulerAnglesXYZ();
			this.output.result.set("number", ((x - initial + math.pi) % (math.pi * 2)) - math.pi);
		});
	}
}

export const BearingShaftBlock = {
	...BlockCreation.defaults,
	id: "bearingshaft",
	displayName: "Bearing Shaft",
	description: "A free spinning shaft with a bearing",
	search: {
		partialAliases: ["angle"],
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
