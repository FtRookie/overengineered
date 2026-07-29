import { RunService } from "@rbxts/services";
import { t } from "engine/shared/t";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { WeaponProjectile } from "shared/weaponProjectiles/BaseProjectileLogic";

type WeaponSound = Sound & { pitch: PitchShiftSoundEffect };

const fireStateType = t.interface({
	block: t.instance("Model").nominal("blockModel"),
	firing: t.boolean,
	/**
	 * Seconds between shots. Sent rather than derived: a spectator's copy of the module graph is only
	 * recalculated for its own plot in ride mode, so it cannot work the rate out for itself.
	 */
	interval: t.numberWithBounds(0, 60),
	/** The emitting blocks whose Sound should play, for the same reason. */
	emitters: t.array(t.instance("Model").nominal("blockModel")),
});
type FireState = t.Infer<typeof fireStateType>;

/** One timer per firing weapon, driving every client's playback — including the shooter's. */
const active = new Map<BlockModel, RBXScriptConnection>();

const stop = (block: BlockModel) => {
	active.get(block)?.Disconnect();
	active.delete(block);
};

/**
 * Replays the weapon's cadence locally instead of taking a remote per round — at 800 rpm that would be
 * thirteen a second, per gun. The rate is fixed for as long as the trigger is held, so a start/stop pair is
 * all that has to cross the wire.
 */
const apply = ({ block, firing, interval, emitters }: FireState) => {
	if (!RunService.IsClient()) return;

	stop(block);
	if (!firing || interval <= 0) return;

	// Same gate the projectiles themselves pass: a block's owner comes off its plot, since the payload
	// carries the block rather than a Player.
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

		/** `emitters` is only read when something actually changed, so the caller can build it lazily. */
		set(firing: boolean, interval: number, emitters: () => BlockModel[]) {
			if (firing === this.firing && interval === this.interval) return;

			this.firing = firing;
			this.interval = interval;
			event.send({ block: this.block, firing, interval, emitters: firing ? emitters() : [] });
		}
	}
}
