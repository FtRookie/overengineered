import type { TutorialStarter } from "client/tutorial2/TutorialStarter";

export interface TutorialDescription {
	readonly name: string;
	readonly description: string;
	// `firstTime` when started for a player with no builds yet
	readonly start: (tutorial: TutorialStarter, firstTime: boolean) => void;
}
