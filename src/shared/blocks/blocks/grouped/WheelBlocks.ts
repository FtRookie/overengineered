import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults, BlockLogicInfo } from "shared/blocks/Block";

const definition = {
	input: {
		friction: {
			displayName: "Tire friction",
			types: {
				number: {
					config: 50,
					clamp: {
						showAsSlider: true,
						max: 100,
						min: 0.1,
					},
				},
			},
		},
		elasticity: {
			displayName: "Tire elasticity",
			types: {
				number: {
					config: 50,
					clamp: {
						showAsSlider: true,
						max: 100,
						min: 0.1,
					},
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as WheelBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		this.on(({ friction, elasticity }) => {
			const collider = this.instance.FindFirstChild("Collider") as BasePart | undefined;
			if (!collider) return;

			const frictionMagic = 2; // hardcoded
			const elasticityMagic = 1; // hardcoded

			const frictionModifier = friction / 100;
			const elasticityModifier = elasticity / 100;

			collider.CustomPhysicalProperties = new PhysicalProperties(
				7.5,
				frictionModifier * frictionMagic,
				elasticityModifier * elasticityMagic,
				100,
				0.4,
			);
		});
	}
}

const logic: BlockLogicInfo = { definition, ctor: Logic };
const physics = {
	impactDamageStrength: 1000,
};

const list: BlockBuildersWithoutIdAndDefaults = {
	smallwheel: {
		displayName: "Small wheel",
		description: "Who's that teeny-tiny fella?",
		logic,
		physics,
	},
	wheel: {
		displayName: "Wheel",
		description: "circle",
		logic,
		physics,
	},
	bigwheel: {
		displayName: "Big wheel",
		description: "Wheel. Big one.",
		logic,
		physics,
	},
	smalloldwheel: {
		displayName: "Small old fashioned wheel",
		description: "smol ol whel",
		logic,
		physics,
	},
	oldwheel: {
		displayName: "Old wheel",
		description: "An old fashioned wheel",
		logic,
		physics,
	},
	bigoldwheel: {
		displayName: "Big old wheel",
		description: "Old fashioned wheel. Big one.",
		logic,
		physics,
	},
};
export const WheelBlocks = BlockCreation.arrayFromObject(list);
