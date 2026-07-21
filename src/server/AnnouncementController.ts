import { MessagingService } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { JSON } from "engine/shared/fixes/Json";
import { isNotAdmin_AutoBanned } from "server/BanAdminExploiter";
import { CustomRemotes } from "shared/Remotes";
import type { AnnouncementPayload } from "shared/Remotes";

const TOPIC = "announcement";
// Clamp text so the JSON payload stays well under the MessagingService 1 KiB limit (keys + originJobId + escaping).
const MAX_TEXT = 400;

@injectable
export class AnnouncementController extends HostedService {
	constructor() {
		super();

		// External (Open Cloud) and cross-server announcements arrive here.
		task.spawn(() => {
			const [ok, err] = pcall(() =>
				MessagingService.SubscribeAsync(TOPIC, (message) => {
					const raw = (message as { readonly Data: unknown }).Data;
					if (!typeIs(raw, "string")) return;

					const [decodeOk, payload] = pcall(() => JSON.deserialize<AnnouncementPayload>(raw));
					if (!decodeOk || payload === undefined) return;
					if (payload.originJobId === game.JobId) return; // origin already dispatched locally

					this.dispatch(payload);
				}),
			);
			if (!ok) $warn(`Announcement SubscribeAsync failed: ${err}`);
		});

		// In-game admin command → dispatch here immediately, then fan out to other servers.
		this.event.subscribe(CustomRemotes.admin.adminAnnounce.invoked, (player, payload) => {
			if (isNotAdmin_AutoBanned(player, "adm_announce")) return;

			const text = payload.text.sub(1, MAX_TEXT);
			if (text.size() === 0) return;

			const cleaned: AnnouncementPayload = { text, display: payload.display };
			this.dispatch(cleaned);
			task.spawn(() => {
				const [ok, err] = pcall(() =>
					MessagingService.PublishAsync(TOPIC, JSON.serialize({ ...cleaned, originJobId: game.JobId })),
				);
				if (!ok) $warn(`Announcement PublishAsync failed: ${err}`);
			});
		});
	}

	private dispatch(payload: AnnouncementPayload) {
		if (payload.display === "chat" || payload.display === "both") {
			CustomRemotes.chat.systemMessage.send("everyone", `<b>[SERVER]: ${payload.text}</b>`);
		}
		if (payload.display === "popup" || payload.display === "both") {
			CustomRemotes.chat.announcePopup.send("everyone", { text: payload.text });
		}
	}
}
