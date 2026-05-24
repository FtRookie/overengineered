import { Debris, ReplicatedStorage } from "@rbxts/services";
import { EffectBase } from "shared/effects/EffectBase";
import type { EffectCreator } from "shared/effects/EffectBase";

type Args = {
	readonly part: BasePart;
	readonly duration?: number;
	readonly extinguish?: boolean;
};
@injectable
export class FireEffect extends EffectBase<Args> {
	constructor(@inject creator: EffectCreator) {
		super(creator, "effect_fire");
	}

	override justRun({ part, duration, extinguish }: Args): void {
		if (!part) return;

		if (extinguish) {
			const fireNames = new Set<string>();
			for (const c of ReplicatedStorage.Assets.Effects.Fire.GetChildren()) fireNames.add(c.Name);
			for (const c of part.GetChildren()) if (fireNames.has(c.Name)) c.Destroy();
			return;
		}

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

	extinguish(part: BasePart) {
		this.send(part, { part, extinguish: true });
	}
}
