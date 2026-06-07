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
		displayName: "Small Gear (Legacy)",
		description: "A cog for your machinery. Better use Spur Gear.",
	},

	spurgear: {
		displayName: "Spur Gear",
		description: "Just a regular gear",
	},
	bevelgear: {
		displayName: "Beveled Gear",
		description: "Tilted Spur Gear",
	},
	helicalgear: {
		displayName: "Helical Gear",
		description: "Tilted Beveled Gear",
	},
	gearrack: {
		displayName: "Rack (Gear)",
		description: "It's like a flat gear.. I mean gears are already flat but this one is a different way",
	},
	sprocketgear: {
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
		displayName: "Old Rim",
		description: "A classic",
	},
	rim: {
		displayName: "Rim",
		description: "Comes with speed holes",
	},
	steelierim: {
		displayName: "Steelie Rim",
		description: "Man they stole my wheels",
		search: { partialAliases: ["wheel", "car"] },
	},

	tanksprocket1: {
		displayName: "Tank Sprocket 1",
		description: "Hold your tank tracks, but better and more stylish",
		search: {
			partialAliases: ["sprocket", "running gear", "track", "abrams"],
		},
	},
	tanksprocket2: {
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
};

//

export const MechanicalBlocks = BlockCreation.arrayFromObject(blocks);
