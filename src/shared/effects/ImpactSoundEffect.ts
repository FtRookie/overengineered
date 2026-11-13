import { Debris, ReplicatedStorage, Workspace } from "@rbxts/services";
import { BlockManager } from "shared/building/BlockManager";
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
			const sound = Sound.cloneRouted(soundsFolder[soundIndex] as Sound);

			const block = BlockManager.tryGetBlockModelByPart(part);
			const scale = (block && BlockManager.manager.scale.get(block)) ?? Vector3.one;
			const size = (scale.X * scale.Y * scale.Z) ** (1 / 3);
			// a smaller object rings higher; the square root halves the physical 1/size so tiny blocks stay plausible
			const speed = math.clamp(size ** -0.5, 0.6, 2) * (0.95 + math.random() * 0.1);

			sound.RollOffMaxDistance = 1000;
			sound.Volume = Sound.getWorldVolume(part.GetPivot().Y) * 0.5 * math.min(1, size);
			sound.PlaybackSpeed *= speed;
			sound.Parent = part;
			sound.Play();

			Debris.AddItem(sound, sound.TimeLength / sound.PlaybackSpeed);
		}
	}
}
