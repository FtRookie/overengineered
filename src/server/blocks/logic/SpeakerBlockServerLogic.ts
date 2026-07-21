import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import { SpeakerBlock } from "shared/blocks/blocks/sound/SpeakerBlock";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { SpeakerBlockLogic } from "shared/blocks/blocks/sound/SpeakerBlock";
import type { SharedPlots } from "shared/building/SharedPlots";

@injectable
export class SpeakerServerLogic extends ServerBlockLogic<typeof SpeakerBlockLogic> {
	constructor(
		logic: typeof SpeakerBlockLogic,
		@inject playModeController: PlayModeController,
		@inject database: PlayerDatabase,
		@inject plots: SharedPlots,
	) {
		super(logic, playModeController);

		const events = SpeakerBlock.logic.events;
		events.update.addServerMiddleware((invoker, arg) => {
			if (!invoker) return { success: true, value: arg };

			if (!database.get(invoker.UserId)?.settings?.replication?.publicSpeakers) {
				return "dontsend";
			}

			return { success: true, value: arg };
		});
		events.update.addServerMiddlewarePerPlayer((invoker, player, arg) => {
			if (!database.get(player.UserId)?.settings?.replication?.publicSpeakers) {
				return "dontsend";
			}
			if (invoker && plots.getPlotComponentByOwnerID(invoker.UserId).isBlacklisted(player)) {
				return "dontsend";
			}
			if (invoker && plots.getPlotComponentByOwnerID(player.UserId).isBlacklisted(invoker)) {
				return "dontsend";
			}

			return { success: true, value: arg };
		});
	}
}
