import { Workspace } from "@rbxts/services";
import { MusicPlaylist } from "client/controller/sound/MusicPlaylist";
import { SoundController } from "client/controller/SoundController";
import { HostedService } from "engine/shared/di/HostedService";
import type { PlayModeController } from "client/modes/PlayModeController";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

type Sounds = {
	readonly Space: Folder;
	readonly BuildingBackground: Folder;
};

@injectable
export class MusicController extends HostedService {
	private readonly musicFolder = SoundController.getUISounds<{ Music: Sounds }>().Music;

	private readonly spacePlaylist = new MusicPlaylist(this.musicFolder.Space.GetChildren() as Sound[], 15);
	private readonly buildingBackgroundPlaylist = new MusicPlaylist(
		this.musicFolder.BuildingBackground.GetChildren() as Sound[],
		25,
	);
	private readonly allPlaylists: MusicPlaylist[] = [this.spacePlaylist, this.buildingBackgroundPlaylist];
	readonly stopAll = () => this.allPlaylists.forEach((v) => v.stop());

	constructor(@inject playerData: PlayerDataStorage, @inject playerMode: PlayModeController) {
		super();

		this.event.subscribe(playerData.config.changed, (name) => {
			this.allPlaylists.forEach((v) => v.setVolume(name.music / 100));
		});

		this.event.subscribe(playerMode.playmode.changed, (mode) => {
			this.stopAll();
			if (mode === "build") this.buildingBackgroundPlaylist.play();
		});

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

		this.onDisable(() => this.stopAll());
	}
}
