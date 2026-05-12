import { Players, ReplicatedStorage, RunService } from "@rbxts/services";
import { PlayerRank } from "engine/shared/PlayerRank";

export namespace GameDefinitions {
	export const isOfficialAwms = ReplicatedStorage.FindFirstChild("anywaymachines") !== undefined;

	// Building
	export const FREE_SLOTS = 70;
	export const ADMIN_SLOTS = 100 - FREE_SLOTS;

	export const MAX_ANGULAR_SPEED = 40;
	export const HEIGHT_OFFSET = -16384;

	// Units
	export const STUDS_TO_METERS = 0.28;
	export const METERS_TO_STUDS = 1 / STUDS_TO_METERS;
	export const STUDS_TO_KMH = 1.008;
	export const STUDS_TO_FEET = STUDS_TO_METERS * 3.280839895;
	export const STUDS_TO_MILES = STUDS_TO_METERS * 0.000621371;

	export const RMU_TO_KG = 21.952;

	const icicle = 101023772575559;
	export const isTesting = RunService.IsStudio() || game.PlaceId === icicle;

	export function getMaxSlots(player: Player, additional: number) {
		let max = FREE_SLOTS + additional;
		if (PlayerRank.isAdmin(player)) max += ADMIN_SLOTS;

		return max;
	}

	export function getEnvironmentInfo(): readonly string[] {
		const ret = [];

		ret.push(isOfficialAwms ? `[Official awms build]` : "[Unofficial build]");
		if (Players.LocalPlayer) {
			ret.push(
				`User: ${Players.LocalPlayer.UserId} @${Players.LocalPlayer.Name} ${Players.LocalPlayer.DisplayName}`,
			);
		} else {
			ret.push("Server");
		}

		ret.push(`Build: ${RunService.IsStudio() ? "🔒 Studio" : game.PlaceVersion}`);
		ret.push(`Server: ${RunService.IsStudio() ? "🔒 Studio" : game.JobId}`);

		return ret;
	}
}
