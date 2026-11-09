import { Players } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { ArgsSignal } from "engine/shared/event/Signal";
import { PlayerWatcher } from "engine/shared/PlayerWatcher";
import { Throttler } from "engine/shared/Throttler";
import { PlayerUtils } from "engine/shared/utils/PlayerUtils";
import { BuildMode } from "server/modes/BuildMode";
import { RideMode } from "server/modes/RideMode";
import { CustomRemotes } from "shared/Remotes";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";
import type { PlayModeBase } from "server/modes/PlayModeBase";
import type { SpawnPosition } from "shared/SpawnPositions";

@injectable
export class PlayModeController extends HostedService {
	static initialize(host: GameHostBuilder) {
		host.services.registerSingletonClass(RideMode);
		host.services.registerSingletonClass(BuildMode);
		host.services.registerService(this);
	}

	readonly playerModeChanged = new ArgsSignal<[player: Player, mode: PlayModes | undefined]>();

	private readonly playerModes: Record<number, PlayModes | undefined> = {};
	private readonly remoteRequests = new Map<number, { windowStart: number; count: number }>();
	private readonly modes;

	constructor(@inject ride: RideMode, @inject build: BuildMode) {
		super();

		this.modes = {
			ride,
			build,
		} as const satisfies Record<PlayModes, PlayModeBase>;

		CustomRemotes.modes.set.subscribe((player, m) => {
			if (!this.allowRemoteRequest(player)) return { success: false, message: "Too many requests" };
			return this.changeModeForPlayer(player, m);
		});
		Players.PlayerRemoving.Connect((plr) => {
			delete this.playerModes[plr.UserId];
			this.remoteRequests.delete(plr.UserId);
		});

		const initCharacterDeath = async (plr: Player, character: Model) => {
			(character.WaitForChild("Humanoid") as Humanoid).Died.Once(async () => {
				const prev = this.getPlayerMode(plr);
				if (prev !== "build" && prev !== undefined) return;

				this.changeModeForPlayer(plr, undefined);
			});
		};
		PlayerWatcher.onJoin((plr) => {
			const char = plr.Character;
			if (char) initCharacterDeath(plr, char);

			plr.CharacterAdded.Connect((char) => initCharacterDeath(plr, char));
		});
	}

	/** The client's own limiter (30 per 60 s, in Remotes.ts) never reaches this server-side one: a client window
	 * resets only after more than 60 s, so no 60 s server window can hold more than three windows' worth of
	 * its requests. OnServerInvoke skips WaiterMiddlewares, so without this the client limit is the only one. */
	private allowRemoteRequest(player: Player): boolean {
		const now = os.time();
		let entry = this.remoteRequests.get(player.UserId);
		if (!entry || now - entry.windowStart > 60) {
			entry = { windowStart: now, count: 0 };
			this.remoteRequests.set(player.UserId, entry);
		}
		if (entry.count >= 90) return false;

		entry.count++;
		return true;
	}

	getPlayerMode(player: Player) {
		return this.playerModes[player.UserId];
	}
	getPlayerModeById(playerId: number) {
		return this.playerModes[playerId];
	}

	changeModeForPlayer(player: Player, m: { mode: PlayModes; pos?: SpawnPosition } | undefined): Response {
		if (m !== undefined && !PlayerUtils.isAlive(player)) {
			return { success: false, message: "Player is not alive" };
		}

		const prevmode = this.playerModes[player.UserId];
		if (prevmode) {
			const transition = this.modes[prevmode];
			if (transition) {
				const result = transition.onTransitionTo(player, m?.mode);
				if (!result || !result.success)
					return (
						result ?? { success: false, message: `Invalid play mode transition ${prevmode} => ${m?.mode}` }
					);
			}
		}
		if (m) {
			const transition = this.modes[m.mode];
			if (transition) {
				const result = transition.onTransitionFrom(player, prevmode, m?.pos);
				if (!result || !result.success)
					return (
						result ?? { success: false, message: `Invalid play mode transition ${prevmode} => ${m?.mode}` }
					);
			}
		}

		$log(`${player.Name}'s mode: '${this.playerModes[player.UserId]}' => '${m?.mode}'`);
		this.playerModes[player.UserId] = m?.mode;
		this.playerModeChanged.Fire(player, m?.mode);

		// for (let i = 0; i < 3; i++) {
		// 	try {
		// 		if (!Players.GetPlayers().includes(player)) {
		// 			return { success: true };
		// 		}

		// 		const result = CustomRemotes.modes.setOnClient.send(player, mode);
		// 		if (!result.success) throw result.message;
		// 		break;
		// 	} catch (err) {
		// 		//
		// 	}
		// }

		if (!Players.GetPlayers().includes(player)) {
			return { success: true };
		}

		const req = Throttler.retryOnFail(3, 1, () => {
			const result = CustomRemotes.modes.setOnClient.send(player, m?.mode);
			if (!result.success) throw result.message;
		});

		if (!req.success) {
			$warn(req.error_message);
		}

		return { success: true };
	}
}
