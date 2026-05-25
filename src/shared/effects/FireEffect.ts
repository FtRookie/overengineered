import { ReplicatedStorage, TweenService } from "@rbxts/services";
import { EffectBase } from "shared/effects/EffectBase";
import type { EffectCreator } from "shared/effects/EffectBase";

type Args = {
	readonly part: BasePart;
	readonly duration?: number;
	readonly extinguish?: boolean;
};

const NATURAL_FADE_SEC = 25;

function startFade(obj: Instance, goal: { [key: string]: unknown }): void {
	const natural = TweenService.Create(obj, new TweenInfo(NATURAL_FADE_SEC, Enum.EasingStyle.Linear), goal);
	natural.Play();

	natural.Completed.Connect((status) => {
		if (status === Enum.PlaybackState.Completed) obj.Destroy();
	});

	// Extinguishing — instant kill, no fade.
	const conn = obj.GetAttributeChangedSignal("_FireExtinguishing").Connect(() => {
		if (obj.GetAttribute("_FireExtinguishing") !== true) return;
		conn.Disconnect();
		natural.Cancel();
		obj.Destroy();
	});
}

@injectable
export class FireEffect extends EffectBase<Args> {
	static instance?: FireEffect;

	constructor(@inject creator: EffectCreator) {
		super(creator, "effect_fire");
		FireEffect.instance = this;
	}

	override justRun({ part, extinguish }: Args): void {
		if (!part) return;

		if (extinguish) {
			// Tagged effects switch into the fast extinguishing fade. Untagged ones
			// matching template names (legacy from before _FireEffect attribute was
			// added) get destroyed immediately as a fallback.
			const fireNames = new Set<string>();
			for (const c of ReplicatedStorage.Assets.Effects.Fire.GetChildren()) fireNames.add(c.Name);
			for (const c of part.GetDescendants()) {
				if (c.GetAttribute("_FireEffect") === true) c.SetAttribute("_FireExtinguishing", true);
				else if (fireNames.has(c.Name)) c.Destroy();
			}
			return;
		}

		// Anchored parts can't burn — no movement, no destruction, visual is pointless.
		if (part.Anchored) return;

		for (const value of ReplicatedStorage.Assets.Effects.Fire.GetChildren()) {
			const obj = value.Clone();
			obj.SetAttribute("_FireEffect", true);
			obj.Parent = part;

			let goal: { [key: string]: unknown };
			if (obj.IsA("ParticleEmitter")) goal = { Rate: 0 };
			else if (obj.IsA("PointLight")) goal = { Brightness: 0 };
			else if (obj.IsA("Sound")) {
				if (math.random(1, 4) !== 1) {
					obj.Destroy();
					continue;
				}
				obj.Play();
				goal = { Volume: 0 };
			} else continue;

			startFade(obj, goal);
		}
	}

	extinguish(part: BasePart) {
		this.send(part, { part, extinguish: true });
	}
}
