// Typed handles to the ModuleScripts under ReplicatedStorage.Modules.
import { ReplicatedStorage } from "@rbxts/services";

// vLuau (Fiu): a Luau interpreter written in Luau. luau_execute compiles `code` and returns a start
// closure without running it, so a pcall around it is a side-effect-free parse check.

export namespace Modules {
	/** The running function as the VM sees it — the only place a fault's line in the *user's* source is known. */
	export type VLuauProto = {
		readonly lineinfoenabled: boolean;
		/** Keyed by pc, which is 1-based; an index signature so roblox-ts doesn't offset it like an array. */
		readonly instructionlineinfo?: { readonly [pc: number]: number };
	};
	export type VLuauSettings = {
		/** Off, the raw Luau error escapes carrying the interpreter's own position instead of the script's. */
		errorHandling: boolean;
		callHooks: {
			interruptHook?: () => void;
			/** Fires once per frame as an error unwinds, innermost first, before the VM reformats it. */
			panicHook?: (
				message: unknown,
				stack: unknown,
				debugging: { readonly pc: number },
				proto: VLuauProto,
			) => void;
		};
	};
	export type VLuau = {
		luau_execute: (
			code: string,
			env: unknown,
			chunkname?: string,
			settings?: VLuauSettings,
		) => LuaTuple<[start: () => void, close: () => void]>;
		create_settings: () => VLuauSettings;
	};
	export const vLuau = require(ReplicatedStorage.Modules.vLuau) as VLuau;
}
