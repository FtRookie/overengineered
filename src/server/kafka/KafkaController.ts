import { Players, ScriptContext, Stats } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { Kafka } from "server/kafka/Kafka";
import { MalformedRemote } from "shared/remotes/MalformedRemote";
import type { DonationController } from "shared/Donations";

/** Seconds a game event may wait in the queue; command acknowledgements skip it */
const FLUSH_INTERVAL = 10;
const STATS_INTERVAL = 60;

/** Sends the queued game events and the events no single other service owns */
@injectable
export class KafkaController extends HostedService {
	constructor(@inject donations: DonationController) {
		super();

		this.event.subscribe(donations.donated, (player, robux, receipt) =>
			// Roblox redelivers a receipt until it is granted, so the purchase id makes the event id
			Kafka.publish(
				"game.donation",
				{ userId: player.UserId, productId: receipt.ProductId, robux, purchaseId: receipt.PurchaseId },
				`donation-${receipt.PurchaseId}`,
			),
		);
		this.event.subscribe(MalformedRemote.kicked, (player, remote, details) =>
			Kafka.publish("game.malformed_remote", {
				userId: player.UserId,
				remote: Kafka.truncate(remote, 100),
				details: details === undefined ? undefined : Kafka.truncate(details, 2000),
			}),
		);
		this.event.subscribe(ScriptContext.Error, (message, stack) => Kafka.reportError("script", message, stack));

		this.event.loop(FLUSH_INTERVAL, () => Kafka.flush());
		this.event.loop(STATS_INTERVAL, () =>
			Kafka.publish("game.server_stats", {
				players: Players.GetPlayers().size(),
				maxPlayers: Players.MaxPlayers,
				memoryMb: Stats.GetTotalMemoryUsageMb(),
			}),
		);

		// one attempt, no retries: shutdown shares its ~30s budget with every save
		game.BindToClose(() => {
			Kafka.publish("game.server_lifecycle", { state: "shutdown" });
			Kafka.flush(true);
		});
	}
}
