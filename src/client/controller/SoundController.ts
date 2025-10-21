import { ReplicatedStorage, RunService, TweenService, Workspace } from "@rbxts/services";
import { LocalPlayerController } from "client/controller/LocalPlayerController";
import { Signals } from "client/Signals";
import { Interface } from "engine/client/gui/Interface";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { HostedService } from "engine/shared/di/HostedService";
import { Sound } from "shared/Sound";
import { TerrainDataInfo } from "shared/TerrainDataInfo";
import { PartUtils } from "shared/utils/PartUtils";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";

type Sounds = {
	readonly Build: {
		readonly BlockPlace: Sound;
		readonly BlockPlaceError: Sound;
		readonly BlockRotate: Sound;
		readonly BlockDelete: Sound;
	};
	readonly Start: Sound;
	readonly Click: Sound;
	readonly Warning: Sound;
	readonly Wind: Sound;
};

@injectable
class UnderwaterSoundEffect extends HostedService {
	constructor(@inject playerDataStorage: PlayerDataStorage) {
		super();

		const underwaterEffectsCache: EqualizerSoundEffect[] = [];
		const applyUnderwaterEffect = (sound: Sound) => {
			const effect = ReplicatedStorage.Assets.Sounds.Effects.Underwater.Clone();
			effect.Parent = sound;
			underwaterEffectsCache.push(effect);
		};
		const cleanupUnderwaterEffect = () => {
			for (const instance of underwaterEffectsCache) {
				instance?.Destroy();
			}
			underwaterEffectsCache.clear();
		};

		let isUnderwater = false;
		const cameraMoved = () => {
			const terrainType = playerDataStorage.config.get().terrain.kind;
			if (terrainType !== "Classic" && terrainType !== "Water") {
				return;
			}

			// Underwater effect
			const isUnderwaterCheck = Workspace.CurrentCamera!.CFrame.Y <= TerrainDataInfo.waterLevel + 5;
			if (isUnderwaterCheck !== isUnderwater) {
				isUnderwater = isUnderwaterCheck;

				if (isUnderwater) {
					PartUtils.applyToAllDescendantsOfType("Sound", Workspace, (sound) => {
						applyUnderwaterEffect(sound);
					});
					PartUtils.applyToAllDescendantsOfType("Sound", Interface.getPlayerGui(), (sound) => {
						applyUnderwaterEffect(sound);
					});
				} else {
					cleanupUnderwaterEffect();
				}

				return;
			}
		};

		this.event.subscribe(Signals.CAMERA.MOVED, cameraMoved);
		this.event.subscribeRegistration(() =>
			SoundController.subscribeSoundAdded((sound) => {
				if (!isUnderwater) return;
				applyUnderwaterEffect(sound);
			}),
		);
	}
}

class WindSoundEffect extends HostedService {
	constructor() {
		super();

		const sound = SoundController.getUISounds().Wind;
		const maxVolume = 6;
		const maxSoundSpeed = 2;
		const maxSpeed = 900;

		this.event.subscribe(RunService.Heartbeat, () => {
			const speed = LocalPlayer.rootPart.get()?.Velocity.Magnitude ?? 0;

			let ratio = (speed / maxSpeed) * 100;
			if (ratio > 100) {
				ratio = 100;
			}

			const volume = (maxVolume / 100) * ratio;
			const soundSpeed = (maxSoundSpeed / 100) * ratio;

			TweenService.Create(sound, new TweenInfo(0.25), {
				Volume: SoundController.getWorldVolume(volume),
				PlaybackSpeed: soundSpeed,
			}).Play();

			// sound.Volume = SoundController.getWorldVolume(volume);
			// sound.PlaybackSpeed = soundSpeed;
		});
	}
}

/** A class for controlling sounds and their effects */
export namespace SoundController {
	export function initializeAll(host: GameHostBuilder) {
		initializeUnderwaterEffect(host);
	}
	export function initializeUnderwaterEffect(host: GameHostBuilder) {
		host.services.registerService(UnderwaterSoundEffect);
		host.services.registerService(WindSoundEffect);
	}

	export function subscribeSoundAdded(func: (sound: Sound) => void): SignalConnection {
		const connection = Workspace.DescendantAdded.Connect((sound) => {
			if (!sound.IsA("Sound")) return;
			func(sound);
		});

		for (const instance of Workspace.GetDescendants()) {
			if (!instance.IsA("Sound")) continue;
			func(instance);
		}

		return connection;
	}

	export function getUISounds<T = {}>(): T & Sounds {
		return (Interface.getPlayerGui() as unknown as { Sounds: T & Sounds }).Sounds;
	}

	export function getWorldVolume(volume: number) {
		return Sound.getWorldVolume(LocalPlayerController.getPlayerRelativeHeight()) * volume;
	}

	export function randomSoundSpeed(): number {
		return math.random(8, 12) / 10;
	}
}
