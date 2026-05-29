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

type SoundEntry = {
	/** Sound's authored volume from the asset. */
	originalVolume: number;
	/** Per-track multiplier (0..1) set by the player. */
	userVolume: number;
	sound: Sound;
};

export class MusicPlaylist {
	readonly allSounds: SoundEntry[];
	shuffledSoundList: typeof this.allSounds = [];
	songIndex: number = 0;

	/** Global music volume multiplier (0..1), applied on top of per-track userVolume. */
	private globalVolume = 1;

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
		this.allSounds = sounds.map((v) => ({ originalVolume: v.Volume, userVolume: 1, sound: v }));
		this.shuffledSoundList = shuffleArray(this.allSounds);
	}

	private applyEntryVolume(entry: SoundEntry) {
		entry.sound.Volume = entry.originalVolume * this.globalVolume * entry.userVolume;
	}

	playSpecificByName(name: string) {
		this.currentSound = this.allSounds.find((v) => v.sound.Name === name)?.sound;
		if (!this.currentSound) throw `No music with the name "${name}" was found`;
		this.currentSound.Play();
	}

	setVolume(volume: number) {
		this.globalVolume = volume;
		for (const v of this.allSounds) this.applyEntryVolume(v);
	}

	setUserVolume(sound: Sound, userVolume: number) {
		for (const v of this.allSounds) {
			if (v.sound !== sound) continue;
			v.userVolume = userVolume;
			this.applyEntryVolume(v);
			return;
		}
	}

	getVolumeForSound(sound: Sound) {
		for (const s of this.allSounds) {
			if (s.sound === sound) return s.userVolume;
		}
	}

	play() {
		if (this.allSounds.isEmpty()) return;
		const previousTrack = this.currentSound;
		const entry = this.shuffledSoundList[this.songIndex];
		const sound = entry.sound;
		this.currentSound = sound;
		this.applyEntryVolume(entry);

		this.currentSoundEndEvent = sound.Ended.Once(() => {
			// Track ended — clear nowPlaying during the gap, then play next.
			this.soundChanged.set({ previousTrack: sound, nowPlaying: undefined });
			wait(this.interval);
			this.play();
		});

		// Always start from the beginning — a previous seek (or a fully-played track) can
		// leave TimePosition non-zero, and Play() does not reliably reset it.
		sound.TimePosition = 0;
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
