import { TweenService } from "@rbxts/services";
import { ObservableValue } from "engine/shared/event/ObservableValue";

type SoundChangedEvent = {
	previousTrack: Sound | undefined;
	nowPlaying: Sound | undefined;
};

const shuffleArray = <T>(array: T[]) => {
	const result: T[] = [...array];
	for (let i = 0; i < result.size(); i++) {
		const indx = math.floor(math.random() * result.size());
		[result[i], result[indx]] = [result[indx], result[i]];
	}
	return result;
};

export class MusicPlaylist {
	readonly allSounds: { originalVolume: number; updatedVolume: number; sound: Sound }[];
	shuffledSoundList: typeof this.allSounds = [];
	songIndex: number = 0;

	currentSound: Sound | undefined;
	private currentSoundEndEvent: RBXScriptConnection | undefined;
	readonly soundChanged = new ObservableValue<SoundChangedEvent>({
		previousTrack: undefined,
		nowPlaying: undefined,
	});

	constructor(
		readonly name: string,
		sounds: Sound[],
		readonly interval: number,
	) {
		this.allSounds = sounds.map((v) => ({ originalVolume: v.Volume, updatedVolume: v.Volume, sound: v }));
		this.shuffledSoundList = shuffleArray(this.allSounds);
	}

	playSpecificByName(name: string) {
		this.currentSound = this.allSounds.find((v) => v.sound.Name === name)?.sound;
		if (!this.currentSound) throw `No music with the name "${name}" was found`;
		this.currentSound.Play();
	}

	setVolume(volume: number) {
		for (const v of this.allSounds) {
			v.updatedVolume = v.sound.Volume = v.originalVolume * volume;
		}
	}

	play() {
		if (this.allSounds.isEmpty()) return;
		const previousTrack = this.currentSound;
		const entry = this.shuffledSoundList[this.songIndex];
		const sound = entry.sound;
		this.currentSound = sound;
		sound.Volume = entry.updatedVolume;

		this.currentSoundEndEvent = sound.Ended.Once(() => {
			// Track ended — clear nowPlaying during the gap, then play next.
			this.soundChanged.set({ previousTrack: sound, nowPlaying: undefined });
			wait(this.interval);
			this.play();
		});

		sound.Play();
		// Announce the newly started track immediately.
		this.soundChanged.set({ previousTrack, nowPlaying: sound });

		this.songIndex++;
		if (this.songIndex >= this.allSounds.size()) {
			this.songIndex = 0;
			this.shuffledSoundList = shuffleArray(this.allSounds);
		}
	}

	stop() {
		this.currentSoundEndEvent?.Disconnect();

		if (this.currentSound) {
			const sound = this.currentSound;
			const tween = TweenService.Create(sound, new TweenInfo(2), { Volume: 0 });

			tween.Play();
			tween.Completed.Connect(() => sound.Stop());
		}
		this.currentSound = undefined;
	}
}
