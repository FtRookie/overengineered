export type PublicEffectKey = "publicSpeakers" | "publicTTS" | "publicParticles" | "publicTracers" | "publicLasers";

type Stopper = (shouldStop: (block: BlockModel) => boolean) => void;

/**
 * The server gates a public effect only when it is sent, so an effect another player's block already started
 * keeps running on this client after either player turns the setting off. Each block registers how to stop its own.
 */
export namespace PublicEffects {
	export const keys: readonly PublicEffectKey[] = [
		"publicSpeakers",
		"publicTTS",
		"publicParticles",
		"publicTracers",
		"publicLasers",
	];

	const stoppers = new Map<PublicEffectKey, Stopper[]>();

	export function register(key: PublicEffectKey, stopper: Stopper) {
		stoppers.getOrSet(key, () => []).push(stopper);
	}

	export function stop(key: PublicEffectKey, shouldStop: (block: BlockModel) => boolean) {
		const registered = stoppers.get(key);
		if (!registered) return;

		for (const stopper of registered) {
			stopper(shouldStop);
		}
	}

	export function ownerOf(block: BlockModel): number | undefined {
		return block.Parent?.Parent?.GetAttribute("ownerid") as number | undefined;
	}
}
