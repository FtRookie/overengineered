import { GameEnvironment } from "shared/data/GameEnvironment";

export namespace Sound {
	export function getWorldVolume(height: number) {
		return math.clamp(
			1 - (height / GameEnvironment.ZeroAirHeight) * (1 - GameEnvironment.MinSoundValue),
			GameEnvironment.MinSoundValue,
			1,
		);
	}

	/**
	 * Clones an asset the way effects spawn them, but carries the SoundGroup across. Clone() drops a
	 * SoundGroup that points outside the template (which the mixer set on it), so a bare clone escapes the
	 * volume sliders. Use this at every runtime sound-spawn site instead of a plain Clone(). A no-op
	 * passthrough for non-sounds, so a mixed folder (particles + lights + sound) can route through it too.
	 */
	export function cloneRouted<T extends Instance>(template: T): T {
		const clone = template.Clone();
		if (clone.IsA("Sound") && template.IsA("Sound")) {
			clone.SoundGroup = template.SoundGroup;
		}

		return clone;
	}
}
