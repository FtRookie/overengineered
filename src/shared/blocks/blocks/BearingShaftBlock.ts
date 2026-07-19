import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import type { RadialUnit } from "shared/data/GameDefinitions";

const definition = {
	input: {
		unit: {
			displayName: "Unit",
			types: {
				enum: {
					config: "radian",
					elementOrder: ["radian", "degree"],
					elements: {
						radian: { displayName: "Radians", tooltip: "The default unit of 180°/π" },
						degree: { displayName: "Degrees", tooltip: "Degrees" },
					},
				},
			},
			connectorHidden: true,
		},
	},
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

		// unit is config-only, so resolve the multiplier once instead of re-reading it every tick
		let unitMul = GameDefinitions.RADIANS_TO.radian;
		this.onkFirstInputs(["unit"], ({ unit }) => (unitMul = GameDefinitions.RADIANS_TO[unit as RadialUnit]));

		const base = this.instance.Union;
		const axle = this.instance.Part;
		const initial = base.GetPivot().ToObjectSpace(axle.GetPivot()).ToEulerAnglesXYZ()[0];

		this.event.subscribe(RunService.PostSimulation, () => {
			const [x] = base.GetPivot().ToObjectSpace(axle.GetPivot()).ToEulerAnglesXYZ();
			const angle = ((x - initial + math.pi) % (math.pi * 2)) - math.pi;
			this.output.result.set("number", angle * unitMul);
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
