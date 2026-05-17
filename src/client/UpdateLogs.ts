export type UpdateLog = {
	Header: string;
	Date: string;
	Content: string[];
};

const logs = [
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
