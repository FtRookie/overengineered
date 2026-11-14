import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { ParticleEmitterBlockLogic } from "shared/blocks/blocks/particle/ParticleBlocks";
import type { SharedPlots } from "shared/building/SharedPlots";

@injectable
export class ParticleServerLogic extends ServerBlockLogic<ParticleEmitterBlockLogic> {
	constructor(
		logic: ParticleEmitterBlockLogic,
		@inject playModeController: PlayModeController,
		@inject database: PlayerDatabase,
		@inject plots: SharedPlots,
	) {
		super(logic, playModeController);

		const events = logic.events;
		// todo: once there is telemetry, log the asset id here — the id is player-typed and reaches every
		// client that receives the broadcast, and nothing currently records what was sent
		// $log(`[particleemit] sent rbxassetid://${arg.properties.particleID}`)
		const isPublic = (player: Player) => database.get(player.UserId)?.settings?.replication?.publicParticles;
		const allowedFrom = (invoker: Player | undefined) => !invoker || isPublic(invoker);
		const allowedTo = (invoker: Player | undefined, player: Player) => {
			if (!isPublic(player)) return false;
			// the global middleware only sees live sends; this also covers the replay to a joining player
			if (invoker && !isPublic(invoker)) return false;
			if (invoker && plots.tryGetPlotByOwnerID(invoker.UserId)?.isBlacklisted(player)) return false;
			if (invoker && plots.tryGetPlotByOwnerID(player.UserId)?.isBlacklisted(invoker)) return false;

			return true;
		};

		events.updateParameters.addServerMiddleware((invoker, arg) =>
			allowedFrom(invoker) ? { success: true, value: arg } : "dontsend",
		);
		events.updateParameters.addServerMiddlewarePerPlayer((invoker, player, arg) =>
			allowedTo(invoker, player) ? { success: true, value: arg } : "dontsend",
		);
		events.emit.addServerMiddleware((invoker, arg) =>
			allowedFrom(invoker) ? { success: true, value: arg } : "dontsend",
		);
		events.emit.addServerMiddlewarePerPlayer((invoker, player, arg) =>
			allowedTo(invoker, player) ? { success: true, value: arg } : "dontsend",
		);
	}
}
