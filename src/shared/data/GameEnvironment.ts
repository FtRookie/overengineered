import { GameDefinitions } from "shared/data/GameDefinitions";

export namespace GameEnvironment {
	export const EarthGravity: number = 180;
	export const PresetToGravity: Record<string, number> = {
		earth: EarthGravity,
		realistic: 9.81 * GameDefinitions.METERS_TO_STUDS,
	};
	export const EarthAirDensity = 0.005;

	export const ZeroGravityHeight: number = 30000;
	export const ZeroAirHeight = 20000;

	export const MinSoundValue = 0.01;
}
