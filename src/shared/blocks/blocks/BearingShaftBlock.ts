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
			displayName: "Encoder",
			unit: "Radians",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type BlockDefinition = BlockModel & {
	readonly Union: BasePart & {
		readonly HingeConstraint: HingeConstraint;
	};
	readonly Part: BasePart;
};

export type { Logic as BearingShaftBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, BlockDefinition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		// unit is config-only, so resolve the multiplier once instead of re-reading it every tick
		let unitMul = GameDefinitions.RADIANS_TO.radian;
		this.onkFirstInputs(["unit"], ({ unit }) => (unitMul = GameDefinitions.RADIANS_TO[unit as RadialUnit]));

		// the hinge already tracks its own rotation, so there is no need to derive it from the two pivots.
		// its zero is where the attachments align, which the prefab does not sit at, so bank the offset
		const hinge = this.instance.Union.HingeConstraint;
		const initial = hinge.CurrentAngle;

		this.event.subscribe(RunService.PostSimulation, () => {
			let delta = hinge.CurrentAngle - initial;
			if (math.abs(delta) > 180) delta -= math.sign(delta) * 360;

			this.output.result.set("number", math.rad(delta) * unitMul);
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
