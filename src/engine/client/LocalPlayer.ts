import { Players } from "@rbxts/services";
import { PlayerInfo } from "engine/shared/PlayerInfo";

const info = new PlayerInfo(Players.LocalPlayer);
info.enable();

export namespace LocalPlayer {
	export const playerInfo = info;

	export const player = info.instance;
	export const mouse = player.GetMouse();
	export const character = info.character;
	export const humanoid = info.humanoid;
	export const rootPart = info.rootPart;

	export const spawnEvent = info.spawnEvent;
	export const diedEvent = info.diedEvent;

	/** Native `PlayerModule` library */
	export function getPlayerModule(): PlayerModule {
		return info.getPlayerModule();
	}
}
