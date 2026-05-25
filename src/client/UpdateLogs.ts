type PreProcess = { Header: string; Date: string; Content: string };
export type UpdateLog = {
	Header: string;
	Date: string;
	Content: string[];
};

const logs: PreProcess[] = [
	{
		Header: "Quick Fix",
		Date: "2026-05-25",
		Content: `
		- Removed old movement smoothening system (it didn't properly work)
		- Removed impact damage causing heat damage (leads to block combustion)
		- Made backmount block almost behave as intended (don't fling players in space no more)
		- ^^^^^^^^ People still can't see you move when you wear it
		`, // add atmo fixes to THIS list
	},
	{
		Header: "My World's On Fire, How About Yours?",
		Date: "2026-05-25",
		Content: `
		- Fire reworked! No more random flames on block break!
		- Colboxes now don't catch fire! They did that before for some reason.
		- Players now may start burning when any block near them catches fire
		- Plasma gun fixes
		- Plasma projectile damage reduced to 60 points
		- Plasma projectile now can make blocks burn with 1% chance
		- Added Extinguisher block
		- Clouds at ground level
		- Stars in space
		`, // add atmo fixes to THIS list
	},
	{
		Header: "Fixes, Fixtures, Features",
		Date: "2026-05-22",
		Content: `
		- Fallback block logic fixed
		- Mouse sensor now includes LMB, MMB, RMB
		- PrioritizeLightingQuality = true (sorry mobile users)
		- World brightness changes depending on hour of day
		- Many new aliases for operation and gate blocks
		- FlatTerrain and TriangleTerrain now clean up properly
		- ^ Override also fixed
		- LaserBlock cleanup and optimization
		`,
	},
	{
		Header: "Slider, Grabber, Holder, Rounder, Splitter",
		Date: "2026-05-20",
		Content: `
		- New string split block
		- Handle is now draggable and configurable
		- Math Round supports Vector
		- Gravity Slider
		- Key Sensor has new threshold configurable value
		`,
	},
	{
		Header: "Weeeee",
		Date: "2026-05-18",
		Content: `
		- JumpPower config
		`,
	},
	{
		Header: "Old Dog, New Tricks",
		Date: "2026-05-18",
		Content: `
		- Added Configurable colors to Logic Debug mode	
		`,
	},
	{
		Header: "Hammer Time",
		Date: "2026-05-17",
		Content: `
		- Added Moderation tools
		- Better Save data management
		- Fixed large slots not loading correctly
		`,
	},
	{
		Header: "Lu-again",
		Date: "2026-05-16",
		Content: `
		- Reenabled Lua Circuit
		- Updated Lua to v0.700
		- Reenabled Function Block
		`,
	},
	{
		Header: "Content Changes/Added",
		Date: "2026-05-15",
		Content: `
		- Added Update Log
		- Changed Achievements Icon
		- Disabled Luau dependant blocks due to game breaking timeout (Lua Circuit, Function Block)
		`,
	},
	{
		Header: "Shapeshifters among us",
		Date: "2026-05-14",
		Content: `
		- Avatar Mimic
		- Maks gaming admin
		`,
	},
	{
		Header: '"Pulls from the Grave"',
		Date: "2026-05-12",
		Content: `
		- Fix broken Achievements
		- T-Flip-Flop
		- Propellant Block 'disintegration' option
		- Many new achievements
		- New banana model for Scale Block
		- Laser optimization tweak
		- Servo Limit fixes
		`,
	},
	{
		Header: "Omni-Optimization",
		Date: "2026-05-12",
		Content: `
		- Added the ability to deload map elements with toggles
		- Bring back train tracks and trainyard
		- ExternalDatabase v2
		`,
	},
	{
		Header: "Unit-ed",
		Date: "2026-05-11",
		Content: `
		- Added choice of units for speedometer, altimeter, position, gravity (not in logic)
		`,
	},
	{
		Header: "Misc changes",
		Date: "2026-05-10",
		Content: `
		- Made spawn selection menu not take up the entire screen
		- Change spawn position menu icon
		- Raise sprint speed limit to 1000
		`,
	},
	{
		Header: "Tracer? I barely know her!",
		Date: "2026-05-10",
		Content: `
		- Tracer block replication (others can see them)
		- Add setting to toggle replication
		`,
	},
	{
		Header: "Saves once again",
		Date: "2026-05-03",
		Content: `
		- ExternalDatabase v1
		`,
	},
	{
		Header: "Samyy Moshnyy",
		Date: "2026-05-03",
		Content: `
		- Makes.mp3 build music
		- Maks_epic.mp3 space music
		`,
	},
	{
		Header: "Road Work",
		Date: "2026-05-02",
		Content: `
		- Lower plots by 1 stud
		- Delete train tracks and trainyard
		`,
	},
];

const processed = logs //
	.map((log) => ({
		...log,
		Date: log.Date + "T00:00:00Z",
		Content: log.Content.gsub("\t", "")[0]
			.split("\n")
			.filter((l) => l !== ""), // Stupid artifact
	}))
	.sort((a, b) => b.Date < a.Date);
export const updateLogs = processed as UpdateLog[];
