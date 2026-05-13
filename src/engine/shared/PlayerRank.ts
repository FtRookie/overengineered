import { RunService } from "@rbxts/services";
export namespace PlayerRank {
	export const developers: number[] = [
		10897692300, // Maks_gaming2
		238427763, // FtRookie
		8377191303, // samlovedeveloping
		8215244948, // rickjealous139
	];

	export function isAdmin(player: Player): boolean {
		if (RunService.IsStudio()) return true;
		return developers.includes(player.UserId);
	}
	export function isAdminById(playerId: number): boolean {
		if (RunService.IsStudio()) return true;
		return developers.includes(playerId);
	}
}
