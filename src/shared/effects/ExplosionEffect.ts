import { Debris, ReplicatedStorage, Workspace } from "@rbxts/services";
import { EffectBase } from "shared/effects/EffectBase";
import { Sound } from "shared/Sound";
import type { EffectCreator } from "shared/effects/EffectBase";

ReplicatedStorage.WaitForChild("Assets");

type Args = {
	readonly part: BasePart;
	readonly index?: number;
	readonly radius?: number;
	/** Where to play instead of on `part`, for a part each client sees at its own lagging position */
	readonly position?: Vector3;
};

// Particle emitters in the prefab are tuned for this radius; runtime radius scales
// Size/Speed/Lifetime relative to this baseline.
const BASELINE_RADIUS = 12;
// Playback speed of the explosion particles. 1 = normal, 0.5 = half-speed slow motion.
const PARTICLE_TIME_SCALE = 0.5;

const scaleNumberSequence = (seq: NumberSequence, scale: number): NumberSequence =>
	new NumberSequence(
		seq.Keypoints.map((kp) => new NumberSequenceKeypoint(kp.Time, kp.Value * scale, kp.Envelope * scale)),
	);

@injectable
export class ExplosionEffect extends EffectBase<Args> {
	readonly soundsFolder = ReplicatedStorage.Assets.Sounds.Explosion.GetChildren();

	constructor(@inject creator: EffectCreator) {
		super(creator, "explosion_effect");
	}

	override justRun({ part, index, radius, position }: Args): void {
		if (!part && !position) return;

		// emitters and sounds in an Attachment play from its WorldPosition (Creator Docs), and Terrain hosts one
		// anywhere without a part
		let host: BasePart | Attachment = part;
		if (position) {
			const attachment = new Instance("Attachment");
			attachment.WorldPosition = position;
			attachment.Parent = Workspace.Terrain;
			Debris.AddItem(attachment, 5);
			host = attachment;
		}

		const soundIndex = index ?? math.random(0, this.soundsFolder.size() - 1);
		const sound = Sound.cloneRouted(this.soundsFolder[soundIndex] as Sound);

		sound.Parent = host;
		sound.Play();

		this.playVisualEffect(host, radius ?? BASELINE_RADIUS);

		Debris.AddItem(sound, sound.TimeLength);
	}

	private playVisualEffect(part: BasePart | Attachment, radius: number): void {
		const scale = radius / BASELINE_RADIUS;
		ReplicatedStorage.Assets.Effects.Explosion.GetChildren().forEach((effect) => {
			task.spawn(() => {
				const instance = effect.Clone() as ParticleEmitter;
				instance.TimeScale = PARTICLE_TIME_SCALE;
				if (scale !== 1) {
					instance.Size = scaleNumberSequence(instance.Size, scale);
					instance.Speed = new NumberRange(instance.Speed.Min * scale, instance.Speed.Max * scale);
				}
				instance.Parent = part;
				instance.Enabled = true;
				task.wait(0.1);
				instance.Enabled = false;
			});
		});
	}
}
