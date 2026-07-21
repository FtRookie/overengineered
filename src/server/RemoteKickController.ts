import { MessagingService, Players } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { JSON } from "engine/shared/fixes/Json";

const TOPIC = "kick";

type KickCommand = {
	readonly userId: number;
	readonly reason?: string;
};

// Roblox has no Open Cloud "kick" endpoint, so an external kick is broadcast to every server here;
// whichever server has the player kicks them. Bans do not need this — they go through Open Cloud directly.
@injectable
export class RemoteKickController extends HostedService {
	constructor() {
		super();

		task.spawn(() => {
			const [ok, err] = pcall(() =>
				MessagingService.SubscribeAsync(TOPIC, (message) => {
					const raw = (message as { readonly Data: unknown }).Data;
					if (!typeIs(raw, "string")) return;

					const [decodeOk, cmd] = pcall(() => JSON.deserialize<KickCommand>(raw));
					if (!decodeOk || cmd === undefined || !typeIs(cmd.userId, "number")) return;

					Players.GetPlayerByUserId(cmd.userId)?.Kick(cmd.reason ?? "You have been kicked.");
				}),
			);
			if (!ok) $warn(`Kick SubscribeAsync failed: ${err}`);
		});
	}
}
