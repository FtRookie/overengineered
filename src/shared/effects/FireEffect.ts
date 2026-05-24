import { Debris, ReplicatedStorage } from "@rbxts/services";
import { EffectBase } from "shared/effects/EffectBase";
import type { EffectCreator } from "shared/effects/EffectBase";

type Args = {
	readonly part: BasePart;
	readonly duration?: number;
};
@injectable
export class FireEffect extends EffectBase<Args> {
	constructor(@inject creator: EffectCreator) {
		super(creator, "effect_fire");
	}

	override justRun({ part, duration }: Args): void {
		if (!part) return;

		const effects = ReplicatedStorage.Assets.Effects.Fire.GetChildren();
		effects.forEach((value) => {
			const obj = value.Clone();
			obj.Parent = part;

			if (obj.IsA("Sound")) {
				if (math.random(1, 4) === 1) {
					obj.Play();
				} else {
					obj.Destroy();
					return;
				}
			}

			// Delete effect
			Debris.AddItem(obj, duration);
		});
	}

	// todo remove fire effects for specific blocks
	extinguish() {
		// todo: implement
	}
}
