import { TextService } from "@rbxts/services";
import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import { TTSBlock } from "shared/blocks/blocks/TextToSpeechBlock";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { TTSBlockLogic } from "shared/blocks/blocks/TextToSpeechBlock";
import type { SharedPlots } from "shared/building/SharedPlots";

@injectable
export class TextToSpeechServerLogic extends ServerBlockLogic<typeof TTSBlockLogic> {
	constructor(
		logic: typeof TTSBlockLogic,
		@inject playModeController: PlayModeController,
		@inject database: PlayerDatabase,
		@inject plots: SharedPlots,
	) {
		super(logic, playModeController);

		const events = TTSBlock.logic.events;
		events.update.addServerMiddleware((invoker, arg) => {
			if (!invoker) return { success: true, value: arg };

			if (!arg.text || arg.text.size() > 300) {
				// Text too long
				return "dontsend";
			}

			if (!database.get(invoker.UserId)?.settings?.replication?.publicTTS) {
				return "dontsend";
			}

			return { success: true, value: arg };
		});
		events.update.addServerMiddlewarePerPlayer((invoker, player, arg) => {
			if (!database.get(player.UserId)?.settings?.replication?.publicTTS) {
				return "dontsend";
			}
			if (invoker && plots.getPlotComponentByOwnerID(invoker.UserId).isBlacklisted(player)) {
				return "dontsend";
			}
			if (invoker && plots.getPlotComponentByOwnerID(player.UserId).isBlacklisted(invoker)) {
				return "dontsend";
			}

			const retargs = { ...arg };
			if (invoker) {
				const [success, result] = pcall(() => {
					const filtered = TextService.FilterStringAsync(arg.text, invoker?.UserId);
					return filtered.GetNonChatStringForUserAsync(player.UserId);
				});
				if (success) {
					retargs.text = result;
				} else {
					warn("Error filtering text: ", result);
					// Text failed to filter
					return "dontsend";
				}
			} else {
				warn("Unknown player");
				// Unknown player - dont send to be safe
				return "dontsend";
			}

			return { success: true, value: retargs };
		});
	}
}
