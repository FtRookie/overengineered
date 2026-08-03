import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { LaserBlockLogic } from "shared/blocks/blocks/LaserBlock";
import type { SharedPlots } from "shared/building/SharedPlots";

@injectable
export class LaserServerLogic extends ServerBlockLogic<LaserBlockLogic> {
	constructor(
		logic: LaserBlockLogic,
		@inject playModeController: PlayModeController,
		@inject database: PlayerDatabase,
		@inject plots: SharedPlots,
	) {
		super(logic, playModeController);

		const events = logic.events;
		events.update.addServerMiddleware((invoker, arg) => {
			if (!invoker) return { success: true, value: arg };
			if (!database.get(invoker.UserId)?.settings?.replication?.publicLasers) return "dontsend";

			return { success: true, value: arg };
		});
		events.update.addServerMiddlewarePerPlayer((invoker, player, arg) => {
			if (!database.get(player.UserId)?.settings?.replication?.publicLasers) return "dontsend";
			if (invoker && plots.tryGetPlotByOwnerID(invoker.UserId)?.isBlacklisted(player)) return "dontsend";
			if (invoker && plots.tryGetPlotByOwnerID(player.UserId)?.isBlacklisted(invoker)) return "dontsend";

			return { success: true, value: arg };
		});
	}
}
