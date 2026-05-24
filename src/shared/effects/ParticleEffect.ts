import { BlockManager } from "shared/building/BlockManager";
import { EffectBase } from "shared/effects/EffectBase";
import type { EffectCreator } from "shared/effects/EffectBase";

type Args = {
	readonly particle: ParticleEmitter;
	readonly isEnabled?: boolean;
	readonly acceleration?: Vector3;
	readonly scale?: number;
	readonly color?: Color3;
	readonly colorSequence?: ColorSequence;
};
@injectable
export class ParticleEffect extends EffectBase<Args> {
	static instance?: ParticleEffect;

	constructor(@inject creator: EffectCreator) {
		super(creator, "particle_effect");
		ParticleEffect.instance = this;
	}

	override justRun({ particle, isEnabled, acceleration, color, scale, colorSequence }: Args): void {
		if (!particle || !particle.Parent) return;

		const part = particle.Parent;
		if (!BlockManager.isActiveBlockPart(part)) return;

		if (scale) {
			particle.Size = new NumberSequence(
				particle.Size.Keypoints.map((k) => new NumberSequenceKeypoint(k.Time, k.Value * scale, k.Envelope)),
			);
		}

		if (isEnabled !== undefined) particle.Enabled = isEnabled;
		if (acceleration !== undefined) particle.Acceleration = acceleration;
		if (color) particle.Color = new ColorSequence(color);
		if (colorSequence) particle.Color = colorSequence;
	}
}
