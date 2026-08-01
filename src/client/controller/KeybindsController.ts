import { HostedService } from "engine/shared/di/HostedService";
import { Keys } from "engine/shared/fixes/Keys";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { KeyCombination } from "engine/client/Keybinds";
import type { Keybinds } from "engine/client/Keybinds";

/**
 * Drops anything that is not a real key name. Bindings come back as plain JSON, so a stale save or a renamed
 * KeyCode would otherwise reach BindAction as nil. A combination left with no keys is dropped whole; an action
 * left with no combinations stays, since that is how "unbound" is stored.
 */
const sanitize = (overrides: {
	readonly [action: string]: readonly (readonly string[])[];
}): { [action: string]: readonly KeyCombination[] } => {
	const result: { [action: string]: readonly KeyCombination[] } = {};

	for (const [action, combos] of pairs(overrides)) {
		result[action] = combos
			.map((combo) => combo.filter((key): key is KeyCode => Keys.isKey(key)))
			.filter((combo) => !combo.isEmpty());
	}

	return result;
};

const RAGDOLL_ACTION = "character_ragdoll";

/** Pushes the player's rebinds into the keybind registry, on load and whenever they change. */
@injectable
export class KeybindsController extends HostedService {
	constructor(@inject playerData: PlayerDataStorage, @inject keybinds: Keybinds) {
		super();

		const apply = () => {
			const config = playerData.config.get();
			const overrides = sanitize(config.keybinds.overrides);

			// The ragdoll key predates the keybind system and still has its own config field. It stays the
			// source until the player rebinds here, so nobody's existing choice is lost in the move.
			if (overrides[RAGDOLL_ACTION] === undefined) {
				const legacy = config.character.ragdoll.triggerKey;
				overrides[RAGDOLL_ACTION] = legacy === undefined || !Keys.isKey(legacy) ? [] : [[legacy]];
			}

			keybinds.setOverrides(overrides);
		};
		this.event.subscribe(playerData.config.changed, apply);
		apply();
	}
}
