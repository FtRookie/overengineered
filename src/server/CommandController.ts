import { ConfigService, HttpService, MessagingService, Players, RunService } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { JSON } from "engine/shared/fixes/Json";
import type { AnnouncementController } from "server/AnnouncementController";
import type { AnnouncementDisplay } from "shared/Remotes";

/** Liveness only. Servers announce themselves; nobody gossips anyone else's list, so a stale view cannot spread. */
const ROSTER_TOPIC = "SERVERS";
const COMMAND_TOPIC = "COMMAND";
const BOT_URL = "https://bot.ftrookie.com";

const ANNOUNCE_INTERVAL = 45;
/** Three missed announces before a peer is presumed gone. */
const ROSTER_TTL = ANNOUNCE_INTERVAL * 3;
/**
 * Discovering peers queues ONE announce rather than one per peer. A server joining an N-server universe
 * hears N unfamiliar jobIds back to back; announcing per discovery would publish N times in a second.
 */
const ANNOUNCE_DEBOUNCE = 1;
/** Backstop for commands MessagingService dropped: late beats never. */
const POLL_INTERVAL = 30;
/** Command ids kept for dedupe. Oldest evicted — an unbounded set is a slow leak on a long-lived server. */
const MAX_HANDLED = 200;

type CommandEnvelope = {
	readonly id: string;
	readonly name: string;
	/** Bot-stamped, so the poll watermark never compares clocks across machines. */
	readonly issuedAt: number;
	readonly args?: { readonly [k in string]: unknown };
};
type CommandResult = { readonly ok: boolean; readonly response?: string };

let botToken: string | undefined;
let botTokenResolved = false;
/** Provisioned like the database token: never in the source tree. */
const getBotToken = (): string | undefined => {
	if (botTokenResolved) return botToken;
	botTokenResolved = true;

	const [ok, value] = pcall(() => ConfigService.GetConfigAsync().GetValue("BOTTOKEN") as string | undefined);
	if (!ok) return undefined;

	botToken = value === "" ? undefined : value; // "" is truthy in Luau
	return botToken;
};

/**
 * Commands issued from Discord (or any API surface) arrive on the COMMAND topic and are acknowledged back
 * over HTTP. The two directions are independent channels: MessagingService can be deaf while HTTP still
 * works, which is exactly why the poll below exists and why a server that cannot subscribe stops advertising
 * itself rather than sitting in every roster as a phantom the bot waits on forever.
 */
@injectable
export class CommandController extends HostedService {
	/** jobId -> when we last heard it. Receiver-stamped, so no clock is compared against another machine's. */
	private readonly roster = new Map<string, number>();
	/** Result per handled command, so a re-issue re-acknowledges instead of executing a second time. */
	private readonly handled = new Map<string, CommandResult>();
	private readonly handledOrder: string[] = [];
	private readonly handlers: { readonly [name in string]: (args: CommandEnvelope["args"]) => CommandResult };

	private commandsAlive = false;
	private announceQueued = false;
	private seeded = false;
	private watermark = 0;

	constructor(@inject announcements: AnnouncementController) {
		super();

		// Each handler narrows its own args: the envelope is fixed, the payload is per-command by design.
		this.handlers = {
			restart: (args) => {
				const ttl = typeIs(args?.ttl, "number") ? args.ttl : 60;
				const text = typeIs(args?.text, "string") ? args.text : "A new update is live!";

				announcements.announce(text, "both", ttl);
				return { ok: true, response: `Warned ${Players.GetPlayers().size()} player(s)` };
			},

			announce: (args) => {
				const text = args?.text;
				if (!typeIs(text, "string") || text.size() === 0) return { ok: false, response: "missing text" };

				const display = args?.display;
				const shown: AnnouncementDisplay = display === "chat" || display === "popup" ? display : "both";

				announcements.announce(text, shown);
				return { ok: true, response: `Shown to ${Players.GetPlayers().size()} player(s)` };
			},
		};

		// Studio must never join the production roster or answer real commands.
		if (RunService.IsStudio()) return;

		task.spawn(() => this.subscribeCommands());
		task.spawn(() => this.subscribeRoster());

		this.event.loop(ANNOUNCE_INTERVAL, () => this.announceSelf());
		this.event.loop(POLL_INTERVAL, () => this.poll());
	}

	/**
	 * Retries forever: a transient failure here would otherwise leave the server deaf for its entire life
	 * while still looking healthy to everyone else.
	 */
	private subscribeCommands() {
		for (let attempt = 1; ; attempt++) {
			const [ok, err] = pcall(() =>
				MessagingService.SubscribeAsync(COMMAND_TOPIC, (message) => {
					const raw = (message as { readonly Data: unknown }).Data;
					if (!typeIs(raw, "string")) return;

					const [decodeOk, command] = pcall(() => JSON.deserialize<CommandEnvelope>(raw));
					if (!decodeOk || command === undefined) return;

					this.execute(command);
				}),
			);
			if (ok) {
				this.commandsAlive = true;
				this.announceSelf();
				return;
			}

			$warn(`COMMAND SubscribeAsync failed (attempt ${attempt}): ${err}`);
			task.wait(math.min(60, attempt * 5));
		}
	}

	private subscribeRoster() {
		const [ok, err] = pcall(() =>
			MessagingService.SubscribeAsync(ROSTER_TOPIC, (message) => {
				const jobId = (message as { readonly Data: unknown }).Data;
				if (!typeIs(jobId, "string") || jobId === game.JobId) return;

				const isNew = !this.roster.has(jobId);
				this.roster.set(jobId, time());
				// A newcomer would otherwise wait a full interval to learn who else exists.
				if (isNew) this.queueAnnounce();
			}),
		);
		if (!ok) $warn(`SERVERS SubscribeAsync failed: ${err}`);
	}

	/** Silent while commands cannot arrive: better invisible than counted and unreachable. */
	private announceSelf() {
		if (!this.commandsAlive) return;
		pcall(() => MessagingService.PublishAsync(ROSTER_TOPIC, game.JobId));
	}

	private queueAnnounce() {
		if (this.announceQueued) return;

		this.announceQueued = true;
		task.delay(ANNOUNCE_DEBOUNCE, () => {
			this.announceQueued = false;
			this.announceSelf();
		});
	}

	private liveRoster(): string[] {
		const now = time();
		const alive: string[] = [game.JobId];

		for (const [jobId, lastSeen] of this.roster) {
			if (now - lastSeen > ROSTER_TTL) {
				this.roster.delete(jobId);
				continue;
			}

			alive.push(jobId);
		}

		return alive;
	}

	/** Shared by the pushed and the polled path, so a command behaves identically whichever way it arrived. */
	private execute(command: CommandEnvelope) {
		this.watermark = math.max(this.watermark, command.issuedAt);

		// Already ran it — but re-acknowledge, because the reason for a re-issue is usually that the
		// acknowledgement was lost rather than the command.
		const previous = this.handled.get(command.id);
		if (previous !== undefined) {
			task.spawn(() => this.acknowledge(command.id, previous));
			return;
		}

		// An unknown name is a newer bot than this server, mid-rollout. Ignore it rather than error.
		const handler = this.handlers[command.name];
		if (handler === undefined) return;

		const result = handler(command.args);
		this.remember(command.id, result);
		task.spawn(() => this.acknowledge(command.id, result));
	}

	private remember(id: string, result: CommandResult) {
		this.handled.set(id, result);
		this.handledOrder.push(id);

		while (this.handledOrder.size() > MAX_HANDLED) {
			const oldest = this.handledOrder.remove(0);
			if (oldest !== undefined) this.handled.delete(oldest);
		}
	}

	private acknowledge(id: string, result: CommandResult) {
		const token = getBotToken();
		if (token === undefined) {
			$warn("No bot token: command acknowledgement skipped.");
			return;
		}

		const [ok, err] = pcall(() =>
			HttpService.RequestAsync({
				Url: `${BOT_URL}/ack/${id}`,
				Method: "POST",
				Headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
				Body: JSON.serialize({
					jobId: game.JobId,
					ok: result.ok,
					response: result.response,
					roster: this.liveRoster(),
				}),
			}),
		);
		if (!ok) $warn(`Command acknowledgement failed: ${err}`);
	}

	/**
	 * Picks up anything MessagingService dropped. The first successful poll only establishes the watermark —
	 * a server that just started must not execute a restart issued before it existed.
	 */
	private poll() {
		const token = getBotToken();
		if (token === undefined) return;

		const [ok, result] = pcall(() =>
			HttpService.RequestAsync({
				Url: `${BOT_URL}/commands?since=${this.watermark}`,
				Method: "GET",
				Headers: { Authorization: `Bearer ${token}` },
			}),
		);
		if (!ok) return;

		const response = result as RequestAsyncResponse;
		if (!response.Success) return;

		const [decodeOk, commands] = pcall(() => JSON.deserialize<CommandEnvelope[]>(response.Body));
		if (!decodeOk || commands === undefined) return;

		for (const command of commands) {
			if (this.seeded) {
				this.execute(command);
				continue;
			}

			this.watermark = math.max(this.watermark, command.issuedAt);
		}

		this.seeded = true;
	}
}
