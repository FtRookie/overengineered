import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults } from "shared/blocks/Block";

const definition = {
	input: {
		length: {
			displayName: "Length",
			types: {
				number: {
					config: 15,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 50,
					},
				},
			},
		},
		thickness: {
			displayName: "Thickness",
			types: {
				number: {
					config: 0.1,
					clamp: {
						showAsSlider: true,
						min: 0.01,
						max: 10,
					},
				},
			},
		},
		color: {
			displayName: "Color",
			tooltip: "Rope cannot take Color3, finds the closest BrickColor",
			types: {
				color: {
					config: new BrickColor("Dark taupe").Color,
				},
			},
			connectorHidden: true,
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type RopeModel = BlockModel & {
	readonly RopeSide: BasePart & {
		readonly RopeConstraint: RopeConstraint;
	};
};

export type { Logic as RopeBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, RopeModel> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const ropeConstraint = this.instance.RopeSide.RopeConstraint;
		this.on(({ length, thickness, color }) => {
			ropeConstraint.Length = length;
			ropeConstraint.Thickness = thickness;
			ropeConstraint.Color = new BrickColor(color);
		});
	}
}

const list: BlockBuildersWithoutIdAndDefaults = {
	rope: {
		displayName: "Rope",
		description: "A very VERY robust rope",
		logic: { definition, ctor: Logic },
	},
	baselessrope: {
		displayName: "Baseless Rope",
		description: "A very VERY robust rope, except without a base",
		logic: { definition, ctor: Logic },
	},
};
export const RopeBlocks = BlockCreation.arrayFromObject(list);
