import { MessagingService } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { JSON } from "engine/shared/fixes/Json";
import { isNotAdmin_AutoBanned } from "server/BanAdminExploiter";
import { CustomRemotes } from "shared/Remotes";
import type { AnnouncementDisplay, AnnouncementPayload } from "shared/Remotes";

const TOPIC = "announcement";
// Clamp text so the JSON payload stays well under the MessagingService 1 KiB limit (keys + originJobId + escaping).
const MAX_TEXT = 400;

const formatRemaining = (total: number): string => {
	// Under ten seconds an exact count is false precision — MessagingService delivery alone drifts ~1s —
	// and a small number reads as less urgent than the moment actually is.
	if (total < 10) return "a few seconds";

	const seconds = math.ceil(total);
	const minutes = math.floor(seconds / 60);
	const rest = seconds % 60;

	if (minutes === 0) return `${rest} second${rest === 1 ? "" : "s"}`;
	if (rest === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
	return `${minutes} minute${minutes === 1 ? "" : "s"} ${rest} second${rest === 1 ? "" : "s"}`;
};

/**
 * Shows announcements to the players on this server. Delivery of the *decision* to announce belongs to
 * CommandController; this only renders it and replays it to anyone who joins while it is still relevant.
 */
@injectable
export class AnnouncementController extends HostedService {
	private lastAnnouncement?: AnnouncementPayload;
	private lastAnnouncementAt = 0;

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

		// Fires once the client has its handlers connected; PlayerAdded would race them and the popup
		// would be dropped.
		this.event.subscribe(CustomRemotes.playerLoaded.invoked, (player) => {
			const announcement = this.lastAnnouncement;
			if (announcement === undefined || announcement.ttl === undefined) return;

			const remaining = announcement.ttl - (time() - this.lastAnnouncementAt);
			if (remaining <= 0) return;

			this.send(announcement, player, this.textFor(announcement, remaining));
		});
	}

	/** Show an announcement on this server only; replayed to anyone joining within `ttl`. */
	announce(text: string, display: AnnouncementDisplay, ttl?: number) {
		this.dispatch({ text, display, ttl });
	}

	private dispatch(payload: AnnouncementPayload) {
		this.lastAnnouncement = payload;
		this.lastAnnouncementAt = time();

		this.send(payload, "everyone", this.textFor(payload, payload.ttl));
	}

	/**
	 * A restart warning must state how long is actually left. "Shortly" reads as "a few minutes" and gets
	 * people caught mid-build, so the remaining seconds are spelled out on the broadcast and every replay.
	 */
	private textFor(payload: AnnouncementPayload, remaining: number | undefined) {
		if (remaining === undefined) return payload.text;
		return `${payload.text} Servers restart in ${formatRemaining(remaining)} — wrap up what you're doing.`;
	}

	private send(payload: AnnouncementPayload, target: Player | "everyone", text: string) {
		if (payload.display === "chat" || payload.display === "both") {
			CustomRemotes.chat.systemMessage.send(target, `<b>[SERVER]: ${text}</b>`);
		}
		if (payload.display === "popup" || payload.display === "both") {
			CustomRemotes.chat.announcePopup.send(target, { text });
		}
	}
}
