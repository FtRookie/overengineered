export type UpdateLog = {
	Header: string;
	Date: string;
	Content: string[];
};
const logs = [
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
		Header: '"Pulls from the Grave"',
		Date: "2026-05-12",
		Content: `
		- T-Flip-Flop
		- Propellant Block 'disintegration' option
		- Many new achievements
		- New banana model for Scale Block
		- Laser optimization tweak
		- Servo Limit fixes
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
