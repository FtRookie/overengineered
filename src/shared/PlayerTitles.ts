import { PlayerRank } from "engine/shared/PlayerRank";

type Info = {
	Prefix: string;
	Color: Color3;
	Cycles: boolean;
};

const customTitles: Record<number, Info> = {
	1852595158: {
		Prefix: "🏆 jenny",
		Color: Color3.fromRGB(220, 220, 100),
		Cycles: false,
	}, // jevilgamer13
} as const;

export namespace PlayerTitles {
	/** Optionally colored chat prefix for the given player */
	export function getPrefixFor(player: Player): string {
		const customInfo = customTitles[player.UserId];
		if (customInfo) {
			return `<font color='#${customInfo.Color.ToHex()}'>[${customInfo.Prefix}]</font> `;
		}
		if (PlayerRank.isFounder(player)) {
			return `<font color='#ff5555'>[Founder]</font> `;
		} else if (PlayerRank.isDev(player)) {
			return `<font color='#ff5555'>[Developer]</font> `;
		} else if (PlayerRank.isMod(player)) {
			return `<font color='#ffff55'>[Moderator]</font> `;
		}
		return "";
	}

	/** Returns the label text underneath the plot username for the given player*/
	export function getRankLabelFor(player: Player): string {
		const customInfo = customTitles[player.UserId];
		if (customInfo) return `<font color='#${customInfo.Color.ToHex()}'>[${customInfo.Prefix}]</font> `;
		if (PlayerRank.isFounder(player)) {
			return "Founder";
		} else if (PlayerRank.isDev(player)) {
			return "Developer";
		} else if (PlayerRank.isMod(player)) {
			return "Moderator";
		}
		return "";
	}

	/** Returns true if the floating plot label should cycle colors */
	export function doesPlotCycle(player: Player): boolean {
		return (PlayerRank.isDev(player) || PlayerRank.isMod(player) || customTitles[player.UserId].Cycles) ?? false;
	}
	export function isChatBold(player: Player): boolean {
		return PlayerRank.isDev(player) || PlayerRank.isMod(player);
	}
}
