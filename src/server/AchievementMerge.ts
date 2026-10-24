import type { AchievementData } from "shared/AchievementData";

export type Achievements = { readonly [id in string]: AchievementData };
type Stats = AchievementData & { readonly [stat in string]: unknown };

// a session that could not see the row counted these up from zero, so they add to the real ones.
// a new cumulative stat must be listed here, or recovery keeps only the session's count
const summedStats = ["seconds_spent", "placedBlocks", "chunks_generated"];
const bestStats = ["height_record", "time_record"];
const unionStats = ["checkpoints_finished"];

const num = (value: unknown) => (typeIs(value, "number") ? value : 0);
const strings = (value: unknown): string[] => (typeIs(value, "table") ? [...(value as string[])] : []);

const mergeStats = (real: Stats, session: Stats): Stats => {
	const has = (stat: string) => real[stat] !== undefined || session[stat] !== undefined;
	const merged: { [k in string]: unknown } = { ...real, ...session };

	for (const stat of summedStats) {
		if (has(stat)) merged[stat] = num(real[stat]) + num(session[stat]);
	}
	for (const stat of bestStats) {
		if (has(stat)) merged[stat] = math.max(num(real[stat]), num(session[stat]));
	}
	for (const stat of unionStats) {
		if (has(stat)) merged[stat] = [...new Set([...strings(real[stat]), ...strings(session[stat])])];
	}

	// progress mirrors the summed stat where there is one, otherwise the further of the two
	const summed = summedStats.find((stat) => merged[stat] !== undefined);
	if (summed !== undefined) merged.progress = merged[summed];
	else if (has("progress")) merged.progress = math.max(num(real.progress), num(session.progress));

	// done on either side stays done, dated from whenever it first was
	merged.completed = real.completed === true || session.completed === true ? true : undefined;
	merged.completionDateUnix = real.completed
		? real.completionDateUnix
		: session.completed
			? session.completionDateUnix
			: undefined;

	return merged as Stats;
};

/** Real achievements plus whatever a session earned while it could not see them */
export const mergeAchievements = (real: Achievements | undefined, session: Achievements): Achievements => {
	const merged: { [id in string]: AchievementData } = { ...(real ?? {}) };
	for (const [id, stats] of pairs(session)) {
		const existing = real?.[id];
		merged[id] = existing ? mergeStats(existing as Stats, stats as Stats) : stats;
	}

	return merged;
};
