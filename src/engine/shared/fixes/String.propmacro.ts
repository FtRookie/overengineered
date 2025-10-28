import { Objects } from "engine/shared/fixes/Objects";
import { utf8_lc_uc, utf8_uc_lc } from "engine/shared/fixes/utf8data";

// function to force hoisting of the macros, because it does not but still tries to use them
// do NOT remove and should ALWAYS be before any other code
const _ = () => [StringMacros];

declare global {
	interface String {
		contains(this: string, search: string): boolean;
		startsWith(this: string, search: string): boolean;

		trim(this: string): string;
		fullLower(this: string): string;
		fullUpper(this: string): string;
	}
}
export const StringMacros: PropertyMacros<String> = {
	contains: (str: String, search: string): boolean => {
		return (str as string).find(search)[0] !== undefined;
	},
	startsWith: (str: String, search: string): boolean => {
		return (str as string).sub(1, search.size()) === search;
	},

	trim: (str: String): string => {
		return (str as string).gsub("^%s*(.-)%s*$", "%1")[0];
	},
	fullLower: (str: String): string => {
		let ret = "";
		for (const c of str as string) {
			ret += utf8_uc_lc[c as never] ?? c;
		}

		return ret;
	},
	fullUpper: (str: String): string => {
		let ret = "";
		for (const c of str as string) {
			ret += utf8_lc_uc[c as never] ?? c;
		}

		return ret;
	},
};

export namespace Strings {
	function _pretty(value: unknown, seen: Map<object, string>): string {
		if (typeIs(value, "string")) return `"${value}"`;

		if (typeIs(value, "table")) {
			const circular = seen.get(value);
			if (circular) {
				return `[Circular ${circular}]`;
			}
			seen.set(value, tostring(value));

			if (1 in value) {
				return `[ ${Objects.values(value)
					.map((v) => _pretty(v, seen))
					.join()} ]`;
			}

			return `{ ${Objects.entriesArray(value)
				.map((e) => `${e[0]}: ${_pretty(e[1], seen)}`)
				.join()} }`;
		}

		return tostring(value);
	}
	export function pretty(value: unknown): string {
		return _pretty(value, new Map());
	}

	export function prettyNumber(value: number, step: number | undefined) {
		if (value !== value) return "NaN";

		const maxdigits = math.min(4, step ? math.max(0, math.ceil(-math.log(step, 10))) : math.huge);
		const multiplied = value * math.pow(10, maxdigits);

		let valuestr = string.format("%i", multiplied);
		while (valuestr.size() < maxdigits + 1) {
			valuestr = "0" + valuestr;
		}

		const integerstr = valuestr.sub(1, -maxdigits - 1);

		let floatingstr = maxdigits === 0 ? "" : valuestr.sub(-maxdigits);
		while (floatingstr.sub(-1) === "0") {
			if (floatingstr.size() === 0) break;
			floatingstr = floatingstr.sub(1, -2);
		}

		if (floatingstr.size() === 0) {
			return integerstr;
		}

		return `${integerstr}.${floatingstr}`;
	}

	export function prettySecondsAgo(seconds: number): string {
		const intervals = [
			{ label: "year", seconds: 31536000 },
			{ label: "month", seconds: 2592000 },
			{ label: "day", seconds: 86400 },
			{ label: "hour", seconds: 3600 },
			{ label: "minute", seconds: 60 },
			{ label: "second", seconds: 1 },
		];

		for (const interval of intervals) {
			const count = math.floor(seconds / interval.seconds);
			if (count >= 1) {
				return `${count} ${interval.label}${count !== 1 ? "s" : ""} ago`;
			}
		}

		return "just now";
	}

	export function prettyTime(seconds: number): string {
		const intervals = [
			{ label: "year", seconds: 31536000 },
			{ label: "month", seconds: 2592000 },
			{ label: "day", seconds: 86400 },
			{ label: "hour", seconds: 3600 },
			{ label: "min", seconds: 60 },
			{ label: "sec", seconds: 1 },
		];

		for (const interval of intervals) {
			const count = math.floor(seconds / interval.seconds);
			if (count >= 1) {
				return `${count} ${interval.label}`;
			}
		}

		return "0 sec";
	}
	export function prettyKMT(num: number): string {
		const round = (num: number) => math.round(num * 100) / 100;

		if (num < 1000) return `${round(num)}`;
		num /= 1000;
		if (num < 1000) return `${round(num)}k`;
		num /= 1000;
		if (num < 1000) return `${round(num)}M`;
		num /= 1000;
		if (num < 1000) return `${round(num)}G`;
		num /= 1000;
		if (num < 1000) return `${round(num)}T`;
		num /= 1000;

		return `${round(num)}`;
	}
}
