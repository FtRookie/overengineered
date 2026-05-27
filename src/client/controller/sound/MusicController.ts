import { RunService, Workspace } from "@rbxts/services";
import { MusicPlaylist } from "client/controller/sound/MusicPlaylist";
import { SoundController } from "client/controller/SoundController";
import { HostedService } from "engine/shared/di/HostedService";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { PlayModeController } from "client/modes/PlayModeController";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

export type MusicEntry = {
	playlistID: string;
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
	private readonly allPlaylists: MusicPlaylist[] = [this.spacePlaylist, this.buildingBackgroundPlaylist];
	readonly stopAll = (): MusicEntry | undefined => {
		let wasPlaying!: MusicEntry;
		this.allPlaylists.forEach((v) => {
			const sound = v.currentSound;
			if (sound?.IsPlaying)
				wasPlaying = {
					playlistID: v.name,
					track: sound,
				};
			v.stop();
		});
		return wasPlaying;
	};
	readonly events = {
		trackChanged: new ObservableValue<GameMusicChangedEvent>({
			previousTrack: undefined,
			nowPlaying: undefined,
		}),
	} as const;

	constructor(@inject playerData: PlayerDataStorage, @inject playerMode: PlayModeController) {
		super();

		this.event.subscribe(playerData.config.changed, (name) => {
			const confVol = RunService.IsStudio() ? 0 : name.music;
			this.allPlaylists.forEach((v) => v.setVolume(confVol / 100));
		});

		this.event.subscribe(playerMode.playmode.changed, (mode) => {
			const previousTrack = this.stopAll();
			if (mode === "build") {
				this.buildingBackgroundPlaylist.play();
				this.events.trackChanged.set({
					previousTrack,
					nowPlaying: {
						playlistID: this.buildingBackgroundPlaylist.name,
						track: this.buildingBackgroundPlaylist.currentSound,
					},
				});
			}
		});

		const gotInSpace = () => {
			if (this.spacePlaylist.currentSound) return;
			const previousTrack = this.stopAll();
			this.spacePlaylist.play();

			this.events.trackChanged.set({
				previousTrack,
				nowPlaying: {
					playlistID: this.spacePlaylist.name,
					track: this.spacePlaylist.currentSound,
				},
			});
		};

		const gotFromSpace = () => {
			if (!this.spacePlaylist.currentSound) return;
			const previousTrack = this.stopAll();
			this.events.trackChanged.set({
				previousTrack,
				nowPlaying: undefined,
			});
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
			const previousTrack = this.stopAll();
			this.events.trackChanged.set({
				previousTrack,
				nowPlaying: undefined,
			});
		});
	}
}
