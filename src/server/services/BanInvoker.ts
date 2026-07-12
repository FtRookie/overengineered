import { Players, RunService } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { CustomRemotes } from "shared/Remotes";

@injectable
export class BanInvoker extends HostedService {
	constructor() {
		super();
		this.event.subscribe(CustomRemotes.integrityViolation.invoked, (invoker: Player, reason: string) => {
			// unvalided client reason -> ban won't go through
			const r: unknown = reason;
			const safeReason = typeIs(r, "string") ? r.sub(1, 400) : "invalid violation report";

			const info = {
				UserIds: [invoker.UserId],
				Duration: -1,
				DisplayReason: "ur ban lole",
				PrivateReason: `ServiceIntegrityChecker: ${safeReason}`,
				ExcludeAltAccounts: false,
				ApplyDeviceBlock: true,
			};
			const [success] = pcall(() => Players.BanAsync(info));
			// in Studio BanAsync "succeeds" without banning or kicking (request is skipped), so kick explicitly; on production the ban itself kicks
			if (!success || RunService.IsStudio()) {
				invoker.Kick();
			}
		});
	}
}
