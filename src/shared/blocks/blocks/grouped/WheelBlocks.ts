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
			const colliders = this.instance
				.GetDescendants()
				.filter(
					(d): d is BasePart =>
						(d.Name === "Collider" || d.Name.sub(1, -2) === "Collider") && d.IsA("BasePart"),
				);
			if (colliders?.size() === 0) return;

			const frictionMagic = 2; // hardcoded
			const elasticityMagic = 1; // hardcoded

			const frictionModifier = friction / 100;
			const elasticityModifier = elasticity / 100;

			for (const collider of colliders) {
				collider.CustomPhysicalProperties = new PhysicalProperties(
					7.5,
					frictionModifier * frictionMagic,
					elasticityModifier * elasticityMagic,
					100,
					0.4,
				);
			}
		});
	}
}

const logic: BlockLogicInfo = { definition, ctor: Logic };
const physics = {
	impactDamageStrength: 1200,
	forcedDamageThreshold: 0.15,
	impactHeatStrength: 0.1,
};

const list: BlockBuildersWithoutIdAndDefaults = {
	smallwheel: {
		limitFamily: "wheel",
		displayName: "Small wheel",
		description: "Who's that teeny-tiny fella?",
		logic,
		physics,
	},
	wheel: {
		limitFamily: "wheel",
		displayName: "Wheel",
		description: "circle",
		logic,
		physics,
	},
	bigwheel: {
		limitFamily: "wheel",
		displayName: "Big wheel",
		description: "Wheel. Big one.",
		logic,
		physics,
	},
	smalloldwheel: {
		limitFamily: "wheel",
		displayName: "Small old fashioned wheel",
		description: "smol ol whel",
		logic,
		physics,
	},
	oldwheel: {
		limitFamily: "wheel",
		displayName: "Old wheel",
		description: "An old fashioned wheel",
		logic,
		physics,
	},
	bigoldwheel: {
		limitFamily: "wheel",
		displayName: "Big old wheel",
		description: "Old fashioned wheel. Big one.",
		logic,
		physics,
	},
	tire: {
		limitFamily: "wheel",
		displayName: "Tire",
		description: "Brand spankin new radials",
		logic,
		physics,
	},
	oldtire: {
		limitFamily: "wheel",
		displayName: "Old tire",
		description: "Good ol' cross-ply",
		logic,
		physics,
	},
	tankwheel1: {
		limitFamily: "wheel",
		displayName: "Tank Wheel 1",
		description: "A western style solid wheel with rubber for grip",
		logic,
		physics,
	},
	tankwheel2: {
		limitFamily: "wheel",
		displayName: "Tank Wheel 2",
		description: "A russian style wheel with rubber for grip",
		logic,
		physics,
	},
	steelie: {
		limitFamily: "wheel",
		cost: 3,
		displayName: "Steelie",
		description: "A steel wheel with a bunch of holes in it",
		search: { partialAliases: ["wheel", "car"] },
		logic,
		physics,
	},
	steelietire: {
		limitFamily: "wheel",
		displayName: "Steelie Tire",
		description: "Can't have crap in Detroit.",
		search: { partialAliases: ["car"] },
		logic,
		physics,
	},
	militarywheelright: {
		limitFamily: "pbrwheel",
		cost: 5,
		displayName: "Military Wheel (Right)",
		description: "90% Rugged and reliable",
		search: { partialAliases: ["humvee"] },
		logic,
		physics,
	},
	militarywheelleft: {
		limitFamily: "pbrwheel",
		cost: 5,
		displayName: "Military Wheel (Left)",
		description: "10% Rugged and reliable",
		search: { partialAliases: ["humvee"] },
		logic,
		physics,
	},
	militarytireright: {
		limitFamily: "pbrwheel",
		cost: 3,
		displayName: "Military Tire (Right)",
		description: "90% Military grade",
		search: { partialAliases: ["humvee"] },
		logic,
		physics,
	},
	militarytireleft: {
		limitFamily: "pbrwheel",
		cost: 3,
		displayName: "Military Tire (Left)",
		description: "10% Military grade",
		search: { partialAliases: ["humvee"] },
		logic,
		physics,
	},
	semitruckwheel: {
		limitFamily: "pbrwheel",
		cost: 3,
		displayName: "Semi Truck Wheel",
		description: "For all your hauling needs",
		search: { partialAliases: ["wetod"] },
		logic,
		physics,
	},
	semitrucktire: {
		limitFamily: "pbrwheel",
		displayName: "Semi Truck Tire",
		description: "I'm tired boss",
		search: { partialAliases: ["wetod"] },
		logic,
		physics,
	},
	aircraftwheel: {
		limitFamily: "pbrwheel",
		cost: 4,
		displayName: "Aircraft Wheel",
		description: "A low pressure aviation grade wheel",
		logic,
		physics,
	},
	aircrafttire: {
		limitFamily: "pbrwheel",
		cost: 2,
		displayName: "Aircraft Tire",
		description: "A low pressure aviation grade tire",
		logic,
		physics,
	},
};
export const WheelBlocks = BlockCreation.arrayFromObject(list);
