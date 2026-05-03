import { Players, RunService } from "@rbxts/services";
import { ComponentDisabler } from "engine/shared/component/ComponentDisabler";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { Switches } from "engine/shared/Switches";

declare global {
	function $trace(...args: unknown[]): void;
	function $debug(...args: unknown[]): void;
	function $log(...args: unknown[]): void;
	function $err(...args: unknown[]): void;
	function $warn(...args: unknown[]): void;
}

// stuff like [CLIENT] and [Logger.ts:456] is already present in studio so we don't really need to print it
// BUT print() only writes as a "Logger.ts:123" instead of the actual source, so we don't disable this
const printAdditional = true || !RunService.IsStudio();
const context = !printAdditional ? "" : RunService.IsServer() ? " [SERV]" : " [CLIE]";

type LogLevel = {
	readonly name: string;
	readonly print: (...args: unknown[]) => void;
};

const lvls = {
	trace: {
		name: "TRC",
		print,
	},
	debug: {
		name: "DBG",
		print,
	},
	info: {
		name: "INF",
		print,
	},
	warn: {
		name: "WRN",
		print: warn,
	},
	error: {
		name: "ERR",
		print: (...args) => {
			try {
				warn(
					asMap(args)
						.map((i, v) => (v === undefined ? "nil" : tostring(v)))
						.join("\t"),
					1,
				);
			} catch {
				// empty
			}
		},
	},
} as const satisfies Record<string, LogLevel>;

export namespace Logger {
	export const levels = lvls;
	export const enabledLevels = new ComponentDisabler<LogLevel>();
	enabledLevels.disableAll(); // shut up

	const scopeStack: string[] = [];

	export function printInfo(gameInfo: GameInfo) {
		if (!RunService.IsClient()) return;

		print(gameInfo.gameName);
		print();

		print(`ℹ User: ${Players.LocalPlayer.UserId} @${Players.LocalPlayer.Name} ${Players.LocalPlayer.DisplayName}`);
		print(`ℹ Build: ${RunService.IsStudio() ? "🔒 Studio" : game.PlaceVersion}`);
		print(`ℹ Server: ${RunService.IsStudio() ? "🔒 Studio" : game.JobId}`);

		print();
	}
	export function initSwitches(switches: Switches) {
		const logDebug = new ObservableValue(false);
		logDebug.subscribe((enabled) => enabledLevels.set(enabled, levels.debug), true);
		switches.register("logDebug", logDebug);

		const logTrace = new ObservableValue(false);
		logTrace.subscribe((enabled) => enabledLevels.set(enabled, levels.trace), true);
		switches.register("logTrace", logTrace);
	}

	export function beginScope(scope: string) {
		scopeStack.push(scope);
	}
	export function endScope() {
		scopeStack.pop();
	}

	function stackToName() {
		if (scopeStack.size() === 0) return "";
		return `[${scopeStack.map((s) => `${s}`).join(" > ")}]`;
	}

	function isActive(level: (typeof levels)[keyof typeof levels]) {
		return enabledLevels.isEnabled(level);
	}
	export function log(level: (typeof levels)[keyof typeof levels], ...args: unknown[]) {
		if (!isActive(level)) return;
		level.print(`[${level.name}]${context} ${stackToName()}`, ...args);
	}

	export function trace(...args: unknown[]) {
		log(levels.trace, ...args);
	}
	export function debug(...args: unknown[]) {
		log(levels.debug, ...args);
	}
	export function info(...args: unknown[]) {
		log(levels.info, ...args);
	}
	export function warn(...args: unknown[]) {
		log(levels.warn, ...args);
	}
	export function err(...args: unknown[]) {
		log(levels.error, ...args);
	}

	function addAdditional(additional: string, ...args: unknown[]) {
		if (printAdditional) {
			return [...(asArray(asMap(args).map((k, a) => (a === undefined ? "nil" : a))) as defined[]), additional];
		}

		return args;
	}

	/** @deprecated For internal usage */
	export function _trace(additional: string, ...args: unknown[]) {
		trace(...addAdditional(additional, ...args));
	}
	/** @deprecated For internal usage */
	export function _debug(additional: string, ...args: unknown[]) {
		debug(...addAdditional(additional, ...args));
	}
	/** @deprecated For internal usage */
	export function _info(additional: string, ...args: unknown[]) {
		info(...addAdditional(additional, ...args));
	}
	/** @deprecated For internal usage */
	export function _warn(additional: string, ...args: unknown[]) {
		warn(...addAdditional(additional, ...args));
	}
	/** @deprecated For internal usage */
	export function _err(additional: string, ...args: unknown[]) {
		err(...addAdditional(additional, ...args));
	}
}
