import { MessagingService } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { JSON } from "engine/shared/fixes/Json";
import { Strings } from "engine/shared/fixes/String.propmacro";
import { isNotAdmin_AutoBanned } from "server/BanAdminExploiter";
import { CustomRemotes } from "shared/Remotes";
import type { AnnouncementDisplay, AnnouncementPayload } from "shared/Remotes";

const TOPIC = "announcement";
// Clamp text so the JSON payload stays well under the MessagingService 1 KiB limit (keys + originJobId + escaping).
const MAX_TEXT = 400;
const MAX_TTL = 3600;

/** Announcements arrive from the admin UI, a peer server and the bot; none is trusted to be sane. */
const cleanText = (raw: string): string | undefined => {
	if (!typeIs(raw, "string")) return undefined;

	const text = raw.sub(1, MAX_TEXT).trim();
	return text.size() === 0 ? undefined : text;
};

const formatRemaining = (total: number): string => {
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
	/** Pending restart, kept as an absolute time so a joiner's warning is rendered from the current clock. */
	private restart?: { readonly text: string; readonly at: number };

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
					if (payload.originJobId === game.JobId) return; // return if self

					this.dispatch(payload);
				}),
			);
			// Bare warn: the log macros are off by default, and a failed subscribe silently costs this
			// server every cross-server announcement for the rest of its life.
			if (!ok) $warn(`[AnnouncementController] SubscribeAsync failed: ${err}`);
		});

		this.event.subscribe(CustomRemotes.admin.adminAnnounce.invoked, (player, { payload, all }) => {
			if (isNotAdmin_AutoBanned(player, "adm_announce")) return;

			// Peers are sent what dispatch accepted, so every server renders the same clamped text.
			const cleaned = this.dispatch(payload);
			if (cleaned === undefined || !all) return;

			task.spawn(() => {
				const [ok, err] = pcall(() =>
					MessagingService.PublishAsync(TOPIC, JSON.serialize({ ...cleaned, originJobId: game.JobId })),
				);
				if (!ok) $warn(`Announcement PublishAsync failed: ${err}`);
			});
		});

		this.event.subscribe(CustomRemotes.playerLoaded.invoked, (player) => {
			if (this.restart !== undefined && this.restart.at > time()) {
				this.send({ text: this.restart.text, display: "both" }, player, this.restartText());
			}

			const announcement = this.lastAnnouncement;
			if (announcement === undefined || announcement.ttl === undefined) return;
			if (announcement.ttl - (time() - this.lastAnnouncementAt) <= 0) return;

			this.send(announcement, player, announcement.text);
		});
	}

	/** Show an announcement on this server only; replayed to anyone joining within `ttl`. */
	announce(text: string, display: AnnouncementDisplay, ttl?: number) {
		this.dispatch({ text, display, ttl });
	}

	// The only path that cannot go through dispatch: the text is stored and later recomposed with the
	// countdown, so clamping the finished sentence would eat the countdown rather than the caller's text.
	announceRestart(text: string, ttl: number) {
		const cleaned = cleanText(text) ?? "A restart is scheduled.";

		this.restart = { text: cleaned, at: time() + ttl };
		this.send({ text: cleaned, display: "both" }, "everyone", this.restartText());
	}

	private restartText(): string {
		const restart = this.restart!;
		return `${restart.text} Servers restart in ${formatRemaining(restart.at - time())} — wrap up what you're doing.`;
	}

	/** Sends a formatted system message */
	chat(text: string) {
		CustomRemotes.chat.systemMessage.send("everyone", `<b>[SERVER]: ${Strings.sanitizeRichText(text)}</b>`);
	}

	private dispatch(payload: AnnouncementPayload): AnnouncementPayload | undefined {
		const text = cleanText(payload.text);
		if (text === undefined) return undefined;

		const cleaned: AnnouncementPayload = {
			text,
			display: payload.display,
			ttl: math.clamp(payload.ttl ?? 0, 0, MAX_TTL),
		};

		this.lastAnnouncement = cleaned;
		this.lastAnnouncementAt = time();

		this.send(cleaned, "everyone", cleaned.text);
		return cleaned;
	}

	// Escaped for the chat but not the popup: the chat message is rich text, while the alert's label has
	// RichText off and would print the entities themselves.
	private send(payload: AnnouncementPayload, target: Player | "everyone", text: string) {
		if (payload.display === "chat" || payload.display === "both") {
			CustomRemotes.chat.systemMessage.send(target, `<b>[SERVER]: ${Strings.sanitizeRichText(text)}</b>`);
		}
		if (payload.display === "popup" || payload.display === "both") {
			CustomRemotes.chat.announcePopup.send(target, { text });
		}
	}
}
