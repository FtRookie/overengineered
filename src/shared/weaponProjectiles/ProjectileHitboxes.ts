import { Players } from "@rbxts/services";
import { ArgsSignal } from "engine/shared/event/Signal";

/**
 * Parts that must never stop or register a projectile.
 *
 * An accessory's Handle is decoration, and letting one count is worse than unfair: a cast stops at the first
 * thing it meets, so a hat would absorb the round outright rather than merely catching it. Casts exclude
 * these, and the Touched path — which has no filter of its own — rejects them by name.
 */
export namespace ProjectileHitboxes {
	const IGNORED_NAME = "Handle";

	const ignored: Instance[] = [];
	const _changed = new ArgsSignal();
	/** Fired when the set changes, so anything holding its own RaycastParams can rebuild them. */
	export const changed: ReadonlyArgsSignal = _changed;

	export function isIgnored(part: BasePart): boolean {
		return part.Name === IGNORED_NAME;
	}

	export function all(): readonly Instance[] {
		return ignored;
	}

	const track = (instance: Instance) => {
		if (instance.Name !== IGNORED_NAME || !instance.IsA("BasePart")) return;

		ignored.push(instance);
		_changed.Fire();

		instance.Destroying.Once(() => {
			const index = ignored.indexOf(instance);
			if (index < 0) return;

			ignored.remove(index);
			_changed.Fire();
		});
	};

	const watch = (character: Model) => {
		for (const descendant of character.GetDescendants()) {
			track(descendant);
		}

		// Accessories arrive after the character does, and can be added mid-life.
		character.DescendantAdded.Connect(track);
	};

	export function initialize() {
		const watchPlayer = (player: Player) => {
			if (player.Character) watch(player.Character);
			player.CharacterAdded.Connect(watch);
		};

		for (const player of Players.GetPlayers()) {
			watchPlayer(player);
		}

		Players.PlayerAdded.Connect(watchPlayer);
	}
}
