import { ConfigService, HttpService, RunService } from "@rbxts/services";
import { JSON } from "engine/shared/fixes/Json";
import { Lazy } from "engine/shared/Lazy";
import { clipBytes } from "server/kafka/ClipBytes";
import { studioConfig } from "server/StudioConfig";

/** oe-bun-kafka-client behind the same host as the database; nginx strips the /kafka prefix */
const PRODUCTION_URL = "https://www.ftrookie.com/kafka";
/** The client accepts 500 per request; 100 capped messages stay well under Roblox's request body limit */
const BATCH_SIZE = 100;
/** An outage must not grow the queue forever, so the oldest events go first past this */
const MAX_QUEUED = 1000;
/** Matches the topic schemas in oe-bun-kafka-client */
const MAX_MESSAGE = 2000;
const MAX_STACK = 4000;

export type KafkaEnvelope = {
	readonly eventId: string;
	readonly topic: string;
	readonly at: number;
	readonly server?: { readonly jobId: string; readonly placeVersion: number };
	readonly data: unknown;
};

export type ErrorSource = "script" | "datastore" | "save";

const nonEmpty = (value: string | undefined) => (value === "" ? undefined : value); // "" is truthy in Luau

const baseUrl = new Lazy((): string => {
	// Studio only, so a stray value can never redirect a live server
	const override = RunService.IsStudio() ? nonEmpty(studioConfig.get().kafkaurl) : undefined;
	if (override === undefined) return PRODUCTION_URL;

	warn(`[Kafka] Talking to ${override} instead of production.`);
	return override.sub(-1) === "/" ? override.sub(1, override.size() - 1) : override;
});

// cached even when missing: GetConfigAsync yields, and re-reading it per request stalls
const token = new Lazy((): string | undefined => {
	if (RunService.IsStudio()) return nonEmpty(studioConfig.get().kafkatoken);

	let value: string | undefined;
	try {
		value = nonEmpty(ConfigService.GetConfigAsync().GetValue("KAFKATOKEN") as string | undefined);
	} catch (err) {
		$err(`Could not read the Kafka token: ${err}`);
	}

	// warn, not $log: log macros are off by default
	if (value === undefined)
		warn("[Kafka] No KAFKATOKEN: game events are not published and commands come only by push.");
	return value;
});

const queue: KafkaEnvelope[] = [];
/** Identical errors between two flushes, merged into one event with a count */
const errors = new Map<string, { source: ErrorSource; message: string; stack?: string; count: number }>();
let flushing = false;
let reachable = false;

const envelope = (topic: string, data: unknown, eventId?: string): KafkaEnvelope => ({
	eventId: eventId ?? HttpService.GenerateGUID(false),
	topic,
	at: DateTime.now().UnixTimestampMillis,
	// a Studio session has an empty JobId, which the client rejects
	server: { jobId: game.JobId !== "" ? game.JobId : "studio", placeVersion: game.PlaceVersion },
	data,
});

const request = (options: RequestAsyncRequest): RequestAsyncResponse | undefined => {
	const [ok, result] = pcall(() => HttpService.RequestAsync(options));
	const response = ok ? (result as RequestAsyncResponse) : undefined;

	reachable = response !== undefined && response.StatusCode < 500;
	return response;
};

/** "retry" keeps the messages for the next flush; "dropped" ones can never be taken, so they are not kept */
const send = (messages: readonly KafkaEnvelope[]): "accepted" | "dropped" | "retry" => {
	const key = token.get();
	if (key === undefined) return "dropped";

	const response = request({
		Url: `${baseUrl.get()}/messages`,
		Method: "POST",
		Headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
		Body: JSON.serialize({ messages }),
	});
	if (!response || !reachable) return "retry";

	// a refused token or a malformed body fails the same way on every retry
	if (!response.Success) {
		warn(`[Kafka] ${response.StatusCode}, dropping ${messages.size()} message(s): ${response.Body.sub(1, 300)}`);
		return "dropped";
	}

	const [ok, body] = pcall(() =>
		JSON.deserialize<{ rejected?: { eventId: string; error: string }[] }>(response.Body),
	);
	const rejected = ok ? body.rejected : undefined;
	if (rejected && !rejected.isEmpty()) {
		warn(`[Kafka] ${rejected.size()} message(s) rejected, first: ${rejected[0].error}`);
		return rejected.size() === messages.size() ? "dropped" : "accepted";
	}
	return "accepted";
};

const takeErrors = () => {
	for (const [, { source, message, stack, count }] of errors) {
		Kafka.publish("game.error", { source, message, stack, count });
	}
	errors.clear();
};

export namespace Kafka {
	export const enabled = () => token.get() !== undefined;

	/** For free text in event data, which the topic schemas cap */
	export const truncate = clipBytes;

	/** Whether the last request reached the client. False before the first one */
	export const isReachable = () => reachable;

	/** Sent with the next batch, at most a flush interval later */
	export function publish(topic: string, data: unknown, eventId?: string) {
		if (!enabled()) return;

		queue.push(envelope(topic, data, eventId));
		if (queue.size() > MAX_QUEUED) queue.shift();
	}

	/** Sent right away, bypassing the queue. False when the client did not take it */
	export function publishNow(topic: string, data: unknown): boolean {
		if (!enabled()) return false;
		return send([envelope(topic, data)]) === "accepted";
	}

	/** Counted rather than sent: the same error thrown every frame becomes one event per flush */
	export function reportError(source: ErrorSource, message: string, stack?: string) {
		if (!enabled()) return;

		const key = `${source}\n${message}\n${stack ?? ""}`;
		const existing = errors.get(key);
		if (existing) {
			existing.count++;
			return;
		}

		errors.set(key, {
			source,
			message: clipBytes(message, MAX_MESSAGE),
			stack: stack === undefined ? undefined : clipBytes(stack, MAX_STACK),
			count: 1,
		});
	}

	/**
	 * Sends everything queued, in batches; stops at the first batch the client could not take.
	 * `waitForRunning` first lets a flush already in flight finish, so the shutdown flush is not skipped by it.
	 */
	export function flush(waitForRunning = false) {
		if (!enabled()) return;
		if (waitForRunning) while (flushing) task.wait();
		if (flushing) return;
		flushing = true;

		takeErrors();
		while (!queue.isEmpty()) {
			const batch: KafkaEnvelope[] = [];
			while (batch.size() < BATCH_SIZE && !queue.isEmpty()) batch.push(queue.shift()!);

			if (send(batch) === "retry") {
				// back to the front, in order, for the next flush
				for (let i = batch.size() - 1; i >= 0; i--) queue.unshift(batch[i]);
				break;
			}
		}

		flushing = false;
	}

	/** Messages of `topic` with `at` after `since`; undefined when the client could not be read */
	export function readSince(topic: string, since: number): readonly KafkaEnvelope[] | undefined {
		const key = token.get();
		if (key === undefined) return undefined;

		const response = request({
			Url: `${baseUrl.get()}/messages/${topic}?since=${since}`,
			Method: "GET",
			Headers: { Authorization: `Bearer ${key}` },
		});
		if (!response || !response.Success) return undefined;

		const [ok, body] = pcall(() => JSON.deserialize<{ messages: KafkaEnvelope[] }>(response.Body));
		return ok ? body.messages : undefined;
	}
}
