import { Debris, ReplicatedStorage, Workspace } from "@rbxts/services";
import { EffectBase } from "shared/effects/EffectBase";
import { Sound } from "shared/Sound";
import type { EffectCreator } from "shared/effects/EffectBase";

ReplicatedStorage.WaitForChild("Assets");

type Args = {
	readonly blocks: readonly BasePart[];
	readonly index?: number;
};
@injectable
export class ImpactSoundEffect extends EffectBase<Args> {
	private readonly materialSounds: { readonly [key: string]: Instance[] } = {
		Default: ReplicatedStorage.Assets.Sounds.Impact.Materials.Metal.GetChildren(),

		Metal: ReplicatedStorage.Assets.Sounds.Impact.Materials.Metal.GetChildren(),
		Glass: ReplicatedStorage.Assets.Sounds.Impact.Materials.Glass.GetChildren(),
		Wood: ReplicatedStorage.Assets.Sounds.Impact.Materials.Wood.GetChildren(),
		WoodPlanks: ReplicatedStorage.Assets.Sounds.Impact.Materials.Wood.GetChildren(),
	};

	constructor(@inject creator: EffectCreator) {
		super(creator, "impact_sound_effect");
	}

	override justRun({ blocks, index }: Args): void {
		if (!blocks || blocks.size() === 0) return;

		for (const part of blocks) {
			if (!part.IsDescendantOf(Workspace)) continue;

			const soundsFolder = this.materialSounds[part.Material.Name] ?? this.materialSounds["Default"];
			const soundIndex = index ?? math.random(0, soundsFolder.size() - 1);
			const sound = soundsFolder[soundIndex].Clone() as Sound;

			sound.RollOffMaxDistance = 1000;
			sound.Volume = Sound.getWorldVolume(part.GetPivot().Y) * 0.5;
			sound.Parent = part;
			sound.Play();

			Debris.AddItem(sound, sound.TimeLength);
		}
	}
}
