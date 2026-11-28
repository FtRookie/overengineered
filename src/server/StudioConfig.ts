import { ServerScriptService } from "@rbxts/services";
import { Lazy } from "engine/shared/Lazy";

// generated from .env, which Roblox cannot read; absent means read-only against production
type StudioConfig = {
	readonly writetoken?: string;
	readonly baseurl?: string;
	readonly kafkatoken?: string;
	readonly kafkaurl?: string;
	readonly privatesavetoken?: string;
};

/** Studio-only settings from `.studioconfig.json`, synced by Rojo as the `studioconfig` ModuleScript */
export const studioConfig = new Lazy((): StudioConfig => {
	const module = ServerScriptService.FindFirstChild("studioconfig");
	// a place assembled without Rojo has an empty Folder of this name
	if (module && !module.IsA("ModuleScript")) {
		$warn(
			`studioconfig is a ${module.ClassName}, not a ModuleScript, so this session is read-only against production`,
		);
		return {};
	}

	return module ? (require(module) as StudioConfig) : {};
});
