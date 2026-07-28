import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockBuildersWithoutIdAndDefaults } from "shared/blocks/Block";

const blocks: BlockBuildersWithoutIdAndDefaults = {
	anchorblock: {
		displayName: "Anchor",
		description: "An immovable block",

		weldRegionsSource: BlockCreation.WeldRegions.fAutomatic("cube"),
	},

	ballinsocket: {
		displayName: "Ball in Socket",
		description: "Ball socket for your mechanical ingenuities",
	},
	ballinsocketangled: {
		displayName: "Ball in Socket (Angled)",
		description: "Angled ball socket for your mechanical ingenuities",
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
	},

	spurgear: {
		limitFamily: "gear",
		displayName: "Spur Gear",
		description: "Just a regular gear",
	},
	bevelgear: {
		limitFamily: "gear",
		displayName: "Beveled Gear",
		description: "Tilted Spur Gear",
	},
	helicalgear: {
		limitFamily: "gear",
		displayName: "Helical Gear",
		description: "Tilted Beveled Gear",
	},
	gearrack: {
		limitFamily: "gear",
		displayName: "Rack (Gear)",
		description: "It's like a flat gear.. I mean gears are already flat but this one is a different way",
	},
	sprocketgear: {
		limitFamily: "gear",
		displayName: "Sprocket",
		description: "Use it to hold your tank tracks",
		search: {
			partialAliases: ["gear", "sprocket", "track"],
		},
	},

	largeoldtrainwheel: {
		displayName: "Large Old Train Wheel",
		description: "A large old train wheel",
	},
	smallnewtrainwheel: {
		displayName: "Small Modern Train Wheel",
		description: "A modern small train wheel",
	},
	smalloldtrainwheel: {
		displayName: "Small Old Train Wheel",
		description: "A small cousin of the old train wheel",
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
	},
	tanksprocket2: {
		limitFamily: "pbrwheel",
		cost: 5,
		displayName: "Tank Sprocket 2",
		description: "The most rugged of the series",
		search: {
			partialAliases: ["sprocket", "running gear", "track", "t-80", "t-72"],
		},
	},

	wingrounding: {
		displayName: "Wing Rounding",
		description: "A wing rounding. Literally rounds your wing",
	},
	wingsharpening: {
		displayName: "Wing Sharper",
		description: "An evil brother of the wing rounding",
	},

	chain: {
		displayName: "Chain",
		description: "When an unbreakable rope just isn't enough",
		limit: 50,
	},
};

//

export const MechanicalBlocks = BlockCreation.arrayFromObject(blocks);
