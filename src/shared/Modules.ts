// Typed handles to the ModuleScripts under ReplicatedStorage.Modules.
import { ReplicatedStorage } from "@rbxts/services";

// vLuau (Fiu): a Luau interpreter written in Luau. luau_execute compiles `code` and returns a start
// closure without running it, so a pcall around it is a side-effect-free parse check.

export namespace Modules {
	export type VLuauSettings = {
		callHooks: { interruptHook?: () => void };
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
