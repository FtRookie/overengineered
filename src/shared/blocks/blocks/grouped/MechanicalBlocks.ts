import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockBuildersWithoutIdAndDefaults } from "shared/blocks/Block";

const physics = {
	impactDamageStrength: 1200,
	forcedDamageThreshold: 0.15,
	impactHeatStrength: 0.1,
};

const blocks: BlockBuildersWithoutIdAndDefaults = {
	anchorblock: {
		displayName: "Anchor",
		description: "An immovable block",

		weldRegionsSource: BlockCreation.WeldRegions.fAutomatic("cube"),
	},

	ballinsocket: {
		displayName: "Ball in Socket",
		description: "Ball socket for your mechanical ingenuities",
		search: {
			partialAliases: ["joint"],
		},
	},
	ballinsocketangled: {
		displayName: "Ball in Socket (Angled)",
		description: "Angled ball socket for your mechanical ingenuities",
		search: {
			partialAliases: ["joint"],
		},
	},

	shaft: {
		displayName: "Shaft",
		description: "A long thin pipe",
	},
	driveshaft: {
		displayName: "Driveshaft",
		description: "Kinda like a ball socket but with transmitting rotational force",
		search: {
			partialAliases: ["universal", "joint"],
		},
	},

	smallgear: {
		limitFamily: "gear",
		displayName: "Small Gear (Legacy)",
		description: "A cog for your machinery. Better use Spur Gear.",
		physics,
	},

	spurgear: {
		limitFamily: "gear",
		displayName: "Spur Gear",
		description: "Just a regular gear",
		physics,
	},
	bevelgear: {
		limitFamily: "gear",
		displayName: "Beveled Gear",
		description: "Tilted Spur Gear",
		physics,
	},
	helicalgear: {
		limitFamily: "gear",
		displayName: "Helical Gear",
		description: "Tilted Beveled Gear",
		physics,
	},
	gearrack: {
		limitFamily: "gear",
		displayName: "Rack (Gear)",
		description: "It's like a flat gear.. I mean gears are already flat but this one is a different way",
		physics,
	},
	sprocketgear: {
		limitFamily: "gear",
		displayName: "Sprocket",
		description: "Use it to hold your tank tracks",
		search: {
			partialAliases: ["track", "gear"],
		},
		physics,
	},

	largeoldtrainwheel: {
		displayName: "Large Old Train Wheel",
		description: "A large old train wheel",
		physics,
	},
	smallnewtrainwheel: {
		displayName: "Small Modern Train Wheel",
		description: "A modern small train wheel",
		physics,
	},
	smalloldtrainwheel: {
		displayName: "Small Old Train Wheel",
		description: "A small cousin of the old train wheel",
		physics,
	},

	oldrim: {
		limitFamily: "wheel",
		displayName: "Old Rim",
		description: "A classic",
	},
	rim: {
		limitFamily: "wheel",
		displayName: "Rim",
		description: "Comes with speed holes",
	},
	steelierim: {
		limitFamily: "wheel",
		cost: 2,
		displayName: "Steelie Rim",
		description: "Man they stole my wheels",
		search: { partialAliases: ["detroit"] },
	},
	militaryrim: {
		limitFamily: "pbrwheel",
		cost: 3,
		displayName: "Military Rim",
		description: "That there rubber wun' yerz' to lose!",
		search: { partialAliases: ["humvee"] },
	},
	semitruckrim: {
		limitFamily: "pbrwheel",
		cost: 2,
		displayName: "Semi Truck Rim",
		description: "Pointy",
		search: { partialAliases: ["wetod"] },
	},
	aircraftrim: {
		limitFamily: "pbrwheel",
		cost: 2,
		displayName: "Aircraft Rim",
		description: "Made for going really fast",
	},

	tanksprocket1: {
		limitFamily: "pbrwheel",
		cost: 5,
		displayName: "Tank Sprocket 1",
		description: "Hold your tank tracks, but better and more stylish",
		search: {
			partialAliases: ["sprocket", "running gear", "track", "abrams"],
		},
		physics,
	},
	tanksprocket2: {
		limitFamily: "pbrwheel",
		cost: 5,
		displayName: "Tank Sprocket 2",
		description: "The most rugged of the series",
		search: {
			partialAliases: ["sprocket", "running gear", "track", "t-80", "t-72"],
		},
		physics,
	},
	chain: {
		displayName: "Chain",
		description: "When an unbreakable rope just isn't enough",
		limit: 50,
	},
};

//

export const MechanicalBlocks = BlockCreation.arrayFromObject(blocks);
