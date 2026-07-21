import { Debris, ReplicatedStorage } from "@rbxts/services";
import { EffectBase } from "shared/effects/EffectBase";
import type { EffectCreator } from "shared/effects/EffectBase";

ReplicatedStorage.WaitForChild("Assets");

type Args = {
	readonly part: BasePart;
	readonly index?: number;
	readonly radius?: number;
};

// Particle emitters in the prefab are tuned for this radius; runtime radius scales
// Size/Speed/Lifetime relative to this baseline.
const BASELINE_RADIUS = 12;
// Playback speed of the explosion particles. 1 = normal, 0.5 = half-speed slow motion.
const PARTICLE_TIME_SCALE = 0.5;

const scaleNumberSequence = (seq: NumberSequence, scale: number): NumberSequence => {
	const out: NumberSequenceKeypoint[] = [];
	for (const kp of seq.Keypoints) {
		out.push(new NumberSequenceKeypoint(kp.Time, kp.Value * scale, kp.Envelope * scale));
	}
	return new NumberSequence(out);
};

@injectable
export class ExplosionEffect extends EffectBase<Args> {
	readonly soundsFolder = ReplicatedStorage.Assets.Sounds.Explosion.GetChildren();

	constructor(@inject creator: EffectCreator) {
		super(creator, "explosion_effect");
	}

	override justRun({ part, index, radius }: Args): void {
		if (!part) return;

		const soundIndex = index ?? math.random(0, this.soundsFolder.size() - 1);
		const sound = this.soundsFolder[soundIndex].Clone() as Sound;

		sound.Parent = part;
		sound.Play();

		this.playVisualEffect(part, radius ?? BASELINE_RADIUS);

		Debris.AddItem(sound, sound.TimeLength);
	}

	private playVisualEffect(part: BasePart, radius: number): void {
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
