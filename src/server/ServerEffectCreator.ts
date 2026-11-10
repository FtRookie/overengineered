import { Players } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { BidirectionalRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { PlayerConfigDefinition } from "shared/config/PlayerConfig";
import { isPlayerLoaded, playerLoadedOnce } from "shared/Remotes";
import type { CreatableRemoteEvents } from "engine/shared/event/PERemoteEvent";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { ServerPlayersController } from "server/ServerPlayersController";
import type { SharedPlots } from "shared/building/SharedPlots";
import type { EEEffect, EffectCreator } from "shared/effects/EffectBase";

/**
 * A player's effects queue fills from `player_init` until their client sends `player_loaded`; before that the
 * client has no listeners and Roblox drops the events. Bounded, because a client that never loads would
 * otherwise collect every effect in the server.
 */
const MAX_PENDING = 64;
/** Seconds. An effect older than this is stale by the time it would be shown. */
const PENDING_TTL = 5;

type Pending = {
	readonly effect: ServerEffect<unknown>;
	readonly owner: Player | undefined;
	readonly arg: unknown;
	readonly at: number;
};
/** Shared by every effect, so a player's queued effects are delivered in the order they were sent. */
type PendingEffects = Map<Player, Pending[]>;

@injectable
class ServerEffect<T> implements EEEffect<T> {
	readonly event: BidirectionalRemoteEvent<T>;
	private readonly relayChecks: ((sender: Player, arg: unknown) => boolean)[] = [];

	constructor(
		name: string,
		eventType: CreatableRemoteEvents,
		private readonly pending: PendingEffects,
		@inject private readonly plots: SharedPlots,
		@inject private readonly playerDatabase: PlayerDatabase,
		@inject private readonly playersController: ServerPlayersController,
	) {
		this.event = new BidirectionalRemoteEvent<T>(name, eventType);

		this.event.c2s.invoked.Connect((owner, arg) => {
			for (const check of this.relayChecks) {
				if (!check(owner, arg)) return;
			}

			const players = playersController.getPlayers().filter((p) => p !== owner);
			this.deliver(owner, players, arg);
		});
	}

	send(ownerPart: BasePart, arg: T): void {
		if (!ownerPart || !ownerPart.CanSetNetworkOwnership()[0]) return;

		const owner = ownerPart.GetNetworkOwner();
		this.deliver(owner, this.playersController.getPlayers(), arg);
	}

	addRelayCheck(check: (sender: Player, arg: unknown) => boolean): void {
		this.relayChecks.push(check);
	}

	/** Queued effects are filtered on delivery instead: filterPlayer reads the player's data, which can yield on an HTTP fetch until their load completes. */
	private deliver(owner: Player | undefined, players: readonly Player[], arg: T) {
		for (const player of players) {
			if (isPlayerLoaded(player) && !this.pending.has(player)) {
				if (this.filterPlayer(owner, player)) this.event.s2c.send(player, arg);
				continue;
			}

			let queue = this.pending.get(player);
			if (!queue) {
				queue = [];
				this.pending.set(player, queue);
			}

			queue.push({ effect: this as unknown as ServerEffect<unknown>, owner, arg, at: os.clock() });
			if (queue.size() > MAX_PENDING) queue.remove(0);
		}
	}

	filterPlayer(owner: Player | undefined, player: Player): boolean {
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
	private readonly pending: PendingEffects = new Map();

	constructor(@inject private readonly di: DIContainer) {
		super();

		// registered as a plain singleton, never enabled, so this.event subscriptions would never connect
		playerLoadedOnce.Connect((player) => {
			const queue = this.pending.get(player);
			if (!queue) return;

			task.spawn(() => {
				while (!queue.isEmpty() && player.Parent) {
					const { effect, owner, arg, at } = queue.shift()!;
					if (at >= os.clock() - PENDING_TTL && effect.filterPlayer(owner, player)) {
						effect.event.s2c.send(player, arg);
					}
				}
				if (this.pending.get(player) === queue) this.pending.delete(player);
			});
		});
		Players.PlayerRemoving.Connect((player) => this.pending.delete(player));
	}

	create<T>(name: string, eventType: CreatableRemoteEvents): EEEffect<T> {
		return this.di.resolveForeignClass(ServerEffect<T>, [name, eventType, this.pending]);
	}
}
