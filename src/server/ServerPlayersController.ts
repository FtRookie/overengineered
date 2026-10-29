import { MessagingService, Players, RunService, ServerStorage } from "@rbxts/services";
import { ComponentKeyedChildren } from "engine/shared/component/ComponentKeyedChildren";
import { HostedService } from "engine/shared/di/HostedService";
import { Lock } from "engine/shared/fixes/Lock";
import { Strings } from "engine/shared/fixes/String.propmacro";
import { PlayerRank } from "engine/shared/PlayerRank";
import { PlayerWatcher } from "engine/shared/PlayerWatcher";
import { t } from "engine/shared/t";
import { isNotAdmin_AutoBanned } from "server/BanAdminExploiter";
import { ServerSlotRequestController } from "server/building/ServerSlotRequestController";
import { ExternalDatabase } from "server/database/ExternalDatabase";
import { PlayerBanned, ServerError } from "server/database/PlayerDatabase";
import { asPlayerId } from "server/PlayerId";
import { ServerPlayerController } from "server/ServerPlayerController";
import { ServerPlayerDataRemotesController } from "server/ServerPlayerDataRemotesController";
import { CustomRemotes } from "shared/Remotes";
import { TagUtils } from "shared/utils/TagUtils";
import type { PlayerDatabase, PlayerDatabaseData } from "server/database/PlayerDatabase";
import type { SlotDatabase } from "server/database/SlotDatabase";
import type { SharedPlots } from "shared/building/SharedPlots";
import type { PlayerInitResponse } from "shared/Remotes";

const PENDING_TOPIC = "PENDING"; // Another server wrote this player id's row upstream; whoever holds them pulls it

const toDataResponse = (row: PlayerDatabaseData): PlayerDataResponse => ({
	purchasedSlots: row.purchasedSlots,
	settings: row.settings,
	slots: row.slots,
	data: row.data,
	blocks: row.blocks,
	achievements: row.achievements,
});

@injectable
export class ServerPlayersController extends HostedService {
	readonly controllers;

	constructor(
		@inject readonly players: PlayerDatabase,
		@inject blockList: BlockList,
		@inject sharedPlots: SharedPlots,
		@inject di: DIContainer,
	) {
		super();

		const controllers = this.parent(new ComponentKeyedChildren<number, ServerPlayerController>(true));
		this.controllers = controllers.children;

		this.event.subscribe(players.recovered, (userId, row) => {
			const player = Players.GetPlayerByUserId(userId);
			if (!player) return;

			CustomRemotes.playerDataRecovered.send(player, toDataResponse(row));
		});
		this.event.subscribe(CustomRemotes.playerDataRecoveredAck.invoked, (player) =>
			players.confirmRecovered(player.UserId),
		);

		if (!RunService.IsStudio()) task.spawn(() => this.subscribePending());

		const initPlayerLock = new Lock();
		this.event.subscribeRegistration(() =>
			CustomRemotes.initPlayer.subscribe((player): Response<PlayerInitResponse> => {
				const shadowBan = () => {
					ServerStorage.FindFirstChild("ShadowBan")!.Clone().Parent = (
						player as unknown as { PlayerGui: PlayerGui }
					).PlayerGui;
				};

				const cresult = initPlayerLock.execute((): Response<{ controller: ServerPlayerController }> => {
					if (controllers.getAll().has(player.UserId)) {
						task.spawn(() => player.Kick("hi  i like your hair"));
						controllers.remove(player.UserId);

						return { success: false, message: "no" };
					}

					let plot = sharedPlots.plots.find((p) => p.ownerId.get() === undefined);
					if (!plot) {
						// clean all plots
						for (const plot of sharedPlots.plots) {
							const ownerId = plot.ownerId.get();
							if (!ownerId) {
								// WHAT
								break;
							}

							if (!Players.GetPlayerByUserId(ownerId)) {
								plot.ownerId.set(undefined);
							}
						}

						// kick duplicates
						const duplicates = sharedPlots.plots
							.groupBy((c) => c.ownerId.get() ?? -1)
							.filter((k, c) => k !== -1 && c.size() > 1);
						for (const [id] of duplicates) {
							Players.GetPlayerByUserId(id)?.Kick();
						}

						plot = sharedPlots.plots.find((p) => p.ownerId.get() === undefined);
						if (!plot) {
							task.spawn(() => {
								while (true as boolean) {
									task.wait();
									for (const player of Players.GetPlayers()) {
										player.Kick("Updating the game...");
									}
								}
							});

							return { success: false, message: "No free plot found, try again later." };
						}
					}

					const scope = di.beginScope((builder) => {
						builder.registerSingletonValue(player);
						builder.registerSingletonValue(plot);
						builder.registerSingletonClass(ServerPlayerController);
					});

					const controller = scope.resolveForeignClass(ServerPlayerController, [player, plot]);
					controllers.add(player.UserId, controller);
					player.AddTag(TagUtils.allTags.PLAYER_LOADED);

					return { success: true, controller };
				});

				if (!cresult.success) return cresult;
				const controller = cresult.controller;

				let data;
				try {
					data = players.get(player.UserId) ?? {};
					// after the row loads, so this applies to it rather than racing it; reaches the client as an update
					task.spawn(() => this.pullPendingChanges(player.UserId));

					return {
						success: true,
						remotes: controller.remotesFolder,
						data: toDataResponse(data),
					};
				} catch (err) {
					if (t.typeCheck(err, PlayerBanned)) {
						const secondsToText = (msuntil: number): string => {
							const intervals = [
								{ label: "year", seconds: 31536000 },
								{ label: "month", seconds: 2592000 },
								{ label: "day", seconds: 86400 },
								{ label: "hour", seconds: 3600 },
								{ label: "minute", seconds: 60 },
								{ label: "second", seconds: 1 },
							];

							const seconds = (msuntil - DateTime.now().UnixTimestampMillis) / 1000;
							for (const interval of intervals) {
								const count = math.floor(seconds / interval.seconds);
								if (count >= 1) {
									return `${count} ${interval.label}${count !== 1 ? "s" : ""} left`;
								}
							}

							return "ඞ";
						};

						const data = err;
						if (!data.reason.contains("bye bye")) {
							player.Kick(
								`You are ${data.until ? "" : "permanently "}banned!\n${data.reason}${data.until && `\n${secondsToText(data.until)}`}`,
							);
							return { success: false, message: "ban haha" };
						}

						shadowBan();
						return { success: false, message: "no" };
					}

					let msg: string;
					if (t.typeCheck(err, ServerError)) {
						msg =
							err.message ??
							`The server is currently unavailable, try again later. Error code ${err.errorCode}`;
					} else {
						msg = "The server is currently unavailable, try again later.";
					}

					player.Kick(msg);
					return { success: false, message: msg };
				}
			}),
		);
		this.event.subscribeRegistration(() =>
			CustomRemotes.admin.adminDataFor.subscribe((sender, playerId): Response<PlayerInitResponse> => {
				if (isNotAdmin_AutoBanned(sender, "adminDataFor")) {
					return { success: false, message: "no" };
				}

				const controller = this.controllers.get(sender.UserId);
				if (!controller) {
					return { success: false, message: "you are LITERALLY offline" };
				}

				const scope = di.beginScope((builder) => {
					builder.registerSingletonValue(asPlayerId(playerId));
				});

				const spdrc = ServerPlayerDataRemotesController.create(scope, playerId, sender);
				spdrc.enable();

				spdrc.parent(
					new ServerSlotRequestController(
						asPlayerId(playerId),
						spdrc.slotRemotes,
						controller.plotController.blocks,
						scope.resolve<BlockList>(),
						scope.resolve<PlayerDatabase>(),
						scope.resolve<SlotDatabase>(),
					),
				);

				const data = players.get(playerId) ?? {};

				return {
					success: true,
					remotes: spdrc.remotesFolder,
					data: {
						purchasedSlots: data.purchasedSlots,
						settings: data.settings,
						slots: data.slots,
						data: data.data,
						blocks: data.blocks,
						achievements: data.achievements,
					},
				};
			}),
		);

		this.event.subscribeRegistration(() =>
			PlayerWatcher.onQuit((player) => {
				controllers.remove(player.UserId);
			}),
		);

		this.event.subscribeRegistration(() =>
			CustomRemotes.admin.adminBanPlayer.subscribe(
				(invoker, { plrID, displayReason, privateReason, duration }): Response => {
					if (isNotAdmin_AutoBanned(invoker, "adm_ban_player"))
						return { success: false, message: "Not an admin" };
					if (PlayerRank.isDevById(plrID) || PlayerRank.isModById(plrID)) {
						return { success: false, message: "Refused: staff" };
					}
					// BanAsync: -1 is permanent, 0 and every other negative is invalid
					if (!typeIs(duration, "number") || (duration !== -1 && !(duration >= 1 && duration % 1 === 0))) {
						return { success: false, message: `Invalid duration ${duration}` };
					}

					const shown = duration === -1 ? "Permanent" : Strings.prettyTime(duration);
					const [ok, err] = pcall(() =>
						Players.BanAsync({
							UserIds: [plrID],
							DisplayReason: `Reason:${displayReason ?? "No reason was given"}\nDuration:${shown}`,
							PrivateReason: privateReason ?? "No reason was given",
							Duration: duration,
						}),
					);
					if (!ok) return { success: false, message: `BanAsync failed: ${err}` };

					return { success: true };
				},
			),
		);
		this.event.subscribeRegistration(() =>
			CustomRemotes.admin.adminGrantBlock.subscribe((invoker, { plrID, blockId, limit }): Response => {
				if (isNotAdmin_AutoBanned(invoker, "adm_grant_block"))
					return { success: false, message: "Not an admin" };
				if (!blockList.blocks[blockId as BlockId])
					return { success: false, message: `Unknown block id ${blockId}` };

				const result = ExternalDatabase.SetBlockLimit(plrID, blockId, limit);
				if (!result.ok) return { success: false, message: `Could not write the limit: ${result.error}` };

				this.notifyPendingChanges(plrID);
				return { success: true };
			}),
		);
		this.event.subscribeRegistration(() =>
			CustomRemotes.admin.adminKickPlayer.subscribe(
				(invoker, { plrID, displayReason, privateReason }): Response => {
					if (isNotAdmin_AutoBanned(invoker, "adm_kick_player"))
						return { success: false, message: "Not an admin" };
					if (PlayerRank.isDevById(plrID) || PlayerRank.isModById(plrID)) {
						return { success: false, message: "Refused: staff" };
					}

					const player = Players.GetPlayerByUserId(plrID);
					if (!player) return { success: false, message: `${plrID} is not on this server` };

					player.Kick(`Reason: ${displayReason}`);
					return { success: true };
				},
			),
		);

		game.BindToClose(() => {
			$log("Game quit, destroying controllers...");

			for (const [playerId, controller] of controllers.getAll()) {
				$log(`Destroying controller of ${playerId}`);
				controller.destroy();
			}
		});
	}

	getPlayers(): readonly Player[] {
		return this.controllers
			.getAll()
			.keys()
			.mapFiltered((id) => Players.GetPlayerByUserId(id));
	}

	autosaveAll(): void {
		for (const [, controller] of this.controllers.getAll()) {
			controller.autosave();
		}
	}

	private subscribePending() {
		const [ok, err] = pcall(() =>
			MessagingService.SubscribeAsync(PENDING_TOPIC, (message) => {
				const userId = (message as { readonly Data: unknown }).Data;
				if (!typeIs(userId, "number")) return;

				this.pullPendingChanges(userId);
			}),
		);
		if (!ok)
			$warn(
				`[ServerPlayersController] ${PENDING_TOPIC} SubscribeAsync failed, upstream writes reach players here only on join: ${err}`,
			);
	}

	/** After a write upstream: apply it here if the player is here, otherwise have whichever server holds them pull it. */
	notifyPendingChanges(userId: number) {
		if (this.pullPendingChanges(userId)) return;
		pcall(() => MessagingService.PublishAsync(PENDING_TOPIC, userId));
	}

	/** Apply the backend's pending changes for a player on this server. False when they are not here. */
	pullPendingChanges(userId: number): boolean {
		const player = Players.GetPlayerByUserId(userId);
		if (!player || !this.controllers.has(userId)) return false;

		const applied = this.players.applyPendingChanges(userId);
		if (applied?.blocks !== undefined) CustomRemotes.updateBlockLimits.send(player, applied.blocks);

		return true;
	}
}
