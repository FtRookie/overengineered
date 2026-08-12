import { RunService } from "@rbxts/services";
import { t } from "engine/shared/t";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { WeaponProjectile } from "shared/weaponProjectiles/BaseProjectileLogic";

/** A weapon's firing sound, with the pitch effect every weapon jitters per shot. */
export type WeaponSound = Sound & { pitch: PitchShiftSoundEffect };

const fireStateType = t.interface({
	block: t.instance("Model").nominal("blockModel"),
	firing: t.boolean,
	interval: t.numberWithBounds(0, 60), // seconds between shots
	emitters: t.array(t.instance("Model").nominal("blockModel")), // blocks whose Sound should play
});
type FireState = t.Infer<typeof fireStateType>;

/** One timer per firing weapon, driving every client's playback — including the shooter's. */
const active = new Map<BlockModel, RBXScriptConnection>();

const stop = (block: BlockModel) => {
	active.get(block)?.Disconnect();
	active.delete(block);
};

/**
 * Replays the weapon's cadence locally instead of a remote per round — at 800 rpm that would be thirteen a
 * second, per gun. The rate is fixed while the trigger is held, so a start/stop pair is all that crosses the
 * wire.
 */
const apply = ({ block, firing, interval, emitters }: FireState) => {
	if (!RunService.IsClient()) return;

	stop(block);
	if (!firing || interval <= 0) return;

	// Same gate the projectiles pass: a block's owner comes off its plot, since the payload carries the
	// block rather than a Player.
	const ownerId = block.Parent?.Parent?.GetAttribute("ownerid") as number | undefined;
	if (!WeaponProjectile.shouldSpawnFor(ownerId)) return;

	const sounds: WeaponSound[] = [];
	for (const emitter of emitters) {
		const sound = emitter.FindFirstChild("Sound", true) as WeaponSound | undefined;
		if (sound) sounds.push(sound);
	}
	if (sounds.isEmpty()) return;

	// 0 rather than time() + interval, so the first round is heard on the frame the trigger goes down.
	let nextShot = 0;
	active.set(
		block,
		RunService.PostSimulation.Connect(() => {
			if (block.Parent === undefined) {
				stop(block);
				return;
			}

			const now = time();
			if (now < nextShot) return;
			nextShot = now + interval;

			// fixme: the same jitter is written out again in LaserEmitterBlock — one of the two should
			// move to whichever module ends up owning weapon audio.
			for (const sound of sounds) {
				sound.pitch.Octave = math.random(1000, 1200) / 10000;
				sound.Play();
			}
		}),
	);
};

export namespace WeaponFireSound {
	export const event = new BlockSynchronizer("b_weapon_fire", fireStateType, apply);

	/**
	 * Shared by every weapon that emits this sound. Must be one object: `ServerBlockLogicController` dedups its
	 * block-validity middleware by `logic.events` identity, so a per-builder literal registers the same
	 * middleware once per weapon.
	 */
	export const events = { fire: event } as const;

	/**
	 * Holds a weapon's last replicated state so the remote only goes out when it actually changes.
	 *
	 * fixme: emitter identity is not part of the comparison — losing one of two identical barrels mid-burst
	 * leaves the interval unchanged, so spectators keep hearing the lost barrel until the trigger is
	 * released. Losing the only barrel changes the rate, which does resend.
	 */
	export class Broadcaster {
		private firing = false;
		private interval = 0;

		constructor(private readonly block: BlockModel) {}

		/** `emitters` is read only when something changed, so the caller can build it lazily. */
		set(firing: boolean, interval: number, emitters: () => BlockModel[]) {
			if (firing === this.firing && interval === this.interval) return;

			this.firing = firing;
			this.interval = interval;
			// interval and emitters are sent, not derived: a spectator's copy of the module graph is only recalculated
			// for its own plot in ride mode, so it can't work the fire rate out for itself
			event.send({ block: this.block, firing, interval, emitters: firing ? emitters() : [] });
		}
	}
}
