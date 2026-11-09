import { TextService } from "@rbxts/services";

type Filtered = { readonly raw: string; readonly userId: number; readonly filtered: string };

const lastFiltered = new Map<BlockModel, Filtered>();

/**
 * Filters a block's text for other players, reusing the previous result while the raw text and its sender are
 * unchanged: the filter is a yielding web call, and a block resending the same text would otherwise pay it each time.
 * Throws whatever the filter throws.
 */
export function filterBlockText(block: BlockModel, raw: string, player: Player): string {
	const last = lastFiltered.get(block);
	if (last && last.raw === raw && last.userId === player.UserId) return last.filtered;

	const filtered = TextService.FilterStringAsync(raw, player.UserId, "PublicChat").GetNonChatStringForUserAsync(
		player.UserId,
	);

	if (!last) block.Destroying.Once(() => lastFiltered.delete(block));
	lastFiltered.set(block, { raw, userId: player.UserId, filtered });

	return filtered;
}
