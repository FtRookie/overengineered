import { Players, RunService } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { Kafka } from "server/kafka/Kafka";
import { CustomRemotes } from "shared/Remotes";

@injectable
export class BanInvoker extends HostedService {
	constructor() {
		super();
		this.event.subscribe(CustomRemotes.integrityViolation.invoked, (invoker: Player, reason: string) => {
			// needs to be validated otherwise anything can be sent
			const r: unknown = reason;
			// private reason api limit is 1000, minus the "ServiceIntegrityChecker: " prefix
			const safeReason = typeIs(r, "string") ? r.sub(1, 975) : "invalid violation report";

			const info = {
				UserIds: [invoker.UserId],
				Duration: -1,
				DisplayReason: "ur ban lole",
				PrivateReason: `ServiceIntegrityChecker: ${safeReason}`,
				ExcludeAltAccounts: false,
				ApplyDeviceBlock: true,
			};
			const [success] = pcall(() => Players.BanAsync(info));

			const details = Kafka.truncate(safeReason, 975);
			Kafka.publish("game.anticheat", { userId: invoker.UserId, kind: "integrity", details });
			if (success)
				Kafka.publish("game.player_ban", { userId: invoker.UserId, source: "anticheat", reason: details });
			// in Studio BanAsync "succeeds" without banning or kicking (request is skipped), so kick explicitly; on production the ban itself kicks
			if (!success || RunService.IsStudio()) {
				invoker.Kick();
			}
		});
	}
}
