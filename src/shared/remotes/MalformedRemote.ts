import { ArgsSignal } from "engine/shared/event/Signal";

const _kicked = new ArgsSignal<[player: Player, remote: string, details: string | undefined]>();

/** The kick for a remote payload that no unmodified client sends */
export namespace MalformedRemote {
	/** @server Fires after each kick, so the server can report it */
	export const kicked = _kicked.asReadonly();

	export function kick(player: Player, remote: string, details?: string) {
		player.Kick(`Network error at ${remote}`);
		_kicked.Fire(player, remote, details);
	}
}
