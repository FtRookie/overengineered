import { HostedService } from "engine/shared/di/HostedService";
import { BidirectionalRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { PlayerConfigDefinition } from "shared/config/PlayerConfig";
import type { CreatableRemoteEvents } from "engine/shared/event/PERemoteEvent";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { ServerPlayersController } from "server/ServerPlayersController";
import type { SharedPlots } from "shared/building/SharedPlots";
import type { EEEffect, EffectCreator } from "shared/effects/EffectBase";

@injectable
class ServerEffect<T> implements EEEffect<T> {
	readonly event: BidirectionalRemoteEvent<T>;
	private readonly relayChecks: ((sender: Player, arg: unknown) => boolean)[] = [];

	constructor(
		name: string,
		eventType: CreatableRemoteEvents,
		@inject private readonly plots: SharedPlots,
		@inject private readonly playerDatabase: PlayerDatabase,
		@inject private readonly playersController: ServerPlayersController,
	) {
		this.event = new BidirectionalRemoteEvent<T>(name, eventType);

		this.event.c2s.invoked.Connect((owner, arg) => {
			for (const check of this.relayChecks) {
				if (!check(owner, arg)) return;
			}

			let players = playersController.getPlayers();
			players = players.filter((p) => p !== owner);
			players = players.filter((player) => this.filterPlayer(owner, player));

			this.event.s2c.send(players, arg);
		});
	}

	send(ownerPart: BasePart, arg: T): void {
		if (!ownerPart || !ownerPart.CanSetNetworkOwnership()[0]) return;

		const owner = ownerPart.GetNetworkOwner();
		const players = this.playersController.getPlayers().filter((player) => this.filterPlayer(owner, player));

		this.event.s2c.send(players, arg);
	}

	addRelayCheck(check: (sender: Player, arg: unknown) => boolean): void {
		this.relayChecks.push(check);
	}

	private filterPlayer(owner: Player | undefined, player: Player): boolean {
		if (player === owner) return true;

		if (owner) {
			const plot = this.plots.getPlotComponentByOwnerID(player.UserId);
			if (plot.isBlacklisted(owner)) {
				return false;
			}
		}

		const other =
			this.playerDatabase.get(player.UserId).settings?.graphics?.othersEffects ??
			PlayerConfigDefinition.graphics.config.othersEffects;

		return !!other;
	}
}

@injectable
export class ServerEffectCreator extends HostedService implements EffectCreator {
	constructor(@inject private readonly di: DIContainer) {
		super();
	}

	create<T>(name: string, eventType: CreatableRemoteEvents): EEEffect<T> {
		return this.di.resolveForeignClass(ServerEffect<T>, [name, eventType]);
	}
}
