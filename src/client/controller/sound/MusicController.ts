import { Workspace } from "@rbxts/services";
import { MusicPlaylist } from "client/controller/sound/MusicPlaylist";
import { SoundController } from "client/controller/SoundController";
import { HostedService } from "engine/shared/di/HostedService";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { PlayModeController } from "client/modes/PlayModeController";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

export type MusicEntry = {
	playlistID: string;
	originalPlaylist: MusicPlaylist;
	track?: Sound;
};

type GameMusicChangedEvent = {
	previousTrack: MusicEntry | undefined;
	nowPlaying: MusicEntry | undefined;
};

type GameMusicPlaylists = {
	readonly Space: Folder;
	readonly BuildingBackground: Folder;
};

@injectable
export class MusicController extends HostedService {
	private readonly musicFolder = SoundController.getUISounds<{ Music: GameMusicPlaylists }>().Music;

	private readonly spacePlaylist = new MusicPlaylist("Space", this.musicFolder.Space.GetChildren() as Sound[], 15);
	private readonly buildingBackgroundPlaylist = new MusicPlaylist(
		"Building",
		this.musicFolder.BuildingBackground.GetChildren() as Sound[],
		25,
	);
	readonly allPlaylists: MusicPlaylist[] = [this.spacePlaylist, this.buildingBackgroundPlaylist];
	readonly stopAll = (): MusicEntry | undefined => {
		const werePlaying = this.getAllCurrentlyPlaying();
		werePlaying.forEach((v) => v.track?.Stop());
		return werePlaying[0];
	};

	readonly trackChanged = new ObservableValue<GameMusicChangedEvent>({
		previousTrack: undefined,
		nowPlaying: undefined,
	});

	constructor(@inject playerData: PlayerDataStorage, @inject playerMode: PlayModeController) {
		super();

		this.event.subscribe(playerData.config.changed, (name) => {
			const confVol = name.music;
			this.allPlaylists.forEach((v) => v.setVolume(confVol / 100));
		});

		// subscribe to all playlists changing tracks
		for (const p of this.allPlaylists)
			this.event.subscribeObservable(
				p.soundChanged,
				(v) => {
					this.trackChanged.set({
						previousTrack: this.trackChanged.get()?.nowPlaying,
						nowPlaying: {
							playlistID: p.name,
							originalPlaylist: p,
							track: v.nowPlaying,
						},
					});
				},
				true,
			);

		this.event.subscribeObservable(
			playerMode.playmode,
			(mode) => {
				this.stopAll();
				if (mode === "build") {
					this.buildingBackgroundPlaylist.play();
				}
			},
			true,
		);

		const gotInSpace = () => {
			if (this.spacePlaylist.currentSound) return;
			this.stopAll();
			this.spacePlaylist.play();
		};

		const gotFromSpace = () => {
			if (!this.spacePlaylist.currentSound) return;
			this.stopAll();
		};

		let grav = Workspace.Gravity;
		this.event.subscribe(Workspace.GetPropertyChangedSignal("Gravity"), () => {
			const newGrav = Workspace.Gravity;
			if (grav !== newGrav) {
				if (newGrav <= 0) gotInSpace();
				else gotFromSpace();
			}
			grav = newGrav;
		});

		this.onDisable(() => {
			this.stopAll();
		});
	}

	// I can just cache the music. But I won't. This operation isn't required to be effective.
	getAllCurrentlyPlaying(): MusicEntry[] {
		const arr: MusicEntry[] = [];
		this.allPlaylists.forEach((v) => {
			const sound = v.currentSound;
			if (sound?.IsPlaying)
				arr.push({
					playlistID: v.name,
					originalPlaylist: v,
					track: sound,
				});
		});
		return arr;
	}
}
