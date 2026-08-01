import { UserInputService } from "@rbxts/services";

/**
 * Cursor icon arbitration.
 *
 * Icons must be uploaded image assets. `rbxasset://SystemCursors/*` looks like the obvious answer and is not:
 * the docs state those only work for Studio plugins and "will not work for other Mouse objects", and pointing
 * MouseIcon at one in a live experience risks leaving no cursor drawn at all.
 *
 * @see https://create.roblox.com/docs/studio/build-studio-widgets
 */

/**
 * Whoever currently owns the cursor. There is one cursor for the whole screen, so without an owner two
 * overlapping windows would each try to restore it and one would win arbitrarily, leaving a resize or move
 * cursor stuck over ordinary UI.
 */
let owner: object | undefined;

/**
 * Claim the cursor for `token`, or release it by passing no icon. A claim is refused while another token holds
 * it, and a release from anyone but the holder is ignored.
 */
export function setCursor(token: object, icon?: string) {
	if (icon === undefined) {
		if (owner !== token) return;

		owner = undefined;
		UserInputService.MouseIcon = "";
		return;
	}

	if (owner !== undefined && owner !== token) return;

	owner = token;
	UserInputService.MouseIcon = icon;
}
