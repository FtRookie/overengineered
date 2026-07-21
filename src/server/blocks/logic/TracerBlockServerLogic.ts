import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { TracerBlockLogic } from "shared/blocks/blocks/TracerBlock";
import type { SharedPlots } from "shared/building/SharedPlots";

@injectable
export class TracerServerLogic extends ServerBlockLogic<TracerBlockLogic> {
	constructor(
		logic: TracerBlockLogic,
		@inject playModeController: PlayModeController,
		@inject database: PlayerDatabase,
		@inject plots: SharedPlots,
	) {
		super(logic, playModeController);

		const events = logic.events;
		events.update.addServerMiddleware((invoker, arg) => {
			if (!invoker) return { success: true, value: arg };

			if (!database.get(invoker.UserId)?.settings?.replication?.publicTracers) {
				return "dontsend";
			}

			return { success: true, value: arg };
		});
		events.update.addServerMiddlewarePerPlayer((invoker, player, arg) => {
			if (!database.get(player.UserId)?.settings?.replication?.publicTracers) return "dontsend";
			if (invoker && plots.getPlotComponentByOwnerID(invoker.UserId).isBlacklisted(player)) return "dontsend";
			if (invoker && plots.getPlotComponentByOwnerID(player.UserId).isBlacklisted(invoker)) return "dontsend";
			return { success: true, value: arg };
		});
	}
}
