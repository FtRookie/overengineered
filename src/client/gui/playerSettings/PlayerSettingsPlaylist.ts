import { RunService } from "@rbxts/services";
import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { PartialControl } from "engine/client/gui/PartialControl";
import type { MusicController, MusicEntry } from "client/controller/sound/MusicController";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

export class PlayerSettingsPlaylist extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		// this.$onInjectAuto((musicController: MusicController) => {
		// 	this.event.subscribe(musicController.events.trackChanged.changed, ({ nowPlaying, previousTrack }) => {
		// 		print("Now Playing", nowPlaying);
		// 		// show now playing tab probably
		// 		if (!nowPlaying) return; // probably need a handler for the sliding thing too (like achievements)
		// 		const track = nowPlaying.track;
		// 		if (!track) return;
		// 		const [author, name] = track.Name.split("-").map((v) => v.trim());
		// 		print(author);
		// 		print(name);
		// 	});
		// });

		const sc = Interface.getInterface<{
			Popups: { Crossplatform: { Playlist: { Content: GuiObject } } };
		}>().Popups.Crossplatform.Playlist.Content.Clone();
		sc.Parent = gui;

		this.onInject((di) => {
			this.parent(di.resolveForeignClass(PlaylistGui, [sc as never]));
		});
	}
}

export type PlaylistGuiParts = {
	readonly ProgressBars: {
		PlayingBar: GuiObject & {
			Fill: GuiObject;
			ValueLabel: TextLabel;
		};
		VolumeBar: GuiObject;
	};
	readonly ScrollingFrame: ScrollingFrame & {
		TemplateMusicTrack: GuiObject;
	};
	readonly CurrentlyPlayingTab: GuiObject & {
		readonly TrackName: TextLabel;
	};
	readonly Settings: GuiObject & {
		Switch: GuiObject & {
			Ordered: GuiObject;
			Shuffle: GuiObject;
		};
	};
};

const getFormattedTime = (seconds: number) => {
	const min = math.floor(seconds / 60);
	const sec = math.floor(seconds % 60);
	return string.format("%d:%02d", min, sec);
};
@injectable
export class PlaylistGui extends PartialControl<PlaylistGuiParts> {
	constructor(gui: GuiObject, @inject musicController: MusicController) {
		super(gui);

		const template = this.asTemplate(this.parts.ScrollingFrame.TemplateMusicTrack);

		const mp = new Map<Sound, MusicTrackEntryGuiElement>();
		const sf = this.parent(new Control(this.parts.ScrollingFrame));
		for (const p of musicController.allPlaylists) {
			for (const s of p.allSounds) {
				const e = new MusicTrackEntryGuiElement(template(), {
					playlistID: p.name,
					track: s.sound,
				});
				mp.set(s.sound, e);
				sf.parent(e);
			}
		}
		//setPlayingState
		this.event.subscribe(RunService.Heartbeat, () => {
			const currentMusic = musicController.trackChanged.get().nowPlaying?.track;
			if (!currentMusic) {
				this.parts.CurrentlyPlayingTab.TrackName.Text = "Nothing";
				this.parts.ProgressBars.PlayingBar.Fill.Size = new UDim2(1, 0, 1, 0);
				this.parts.ProgressBars.PlayingBar.ValueLabel.Text = `- / -`;
				return;
			}

			const progress = currentMusic.TimePosition / currentMusic.TimeLength;
			this.parts.ProgressBars.PlayingBar.Fill.Size = new UDim2(progress, 0, 1, 0);
			this.parts.ProgressBars.PlayingBar.ValueLabel.Text = `${getFormattedTime(currentMusic.TimePosition)}/${getFormattedTime(currentMusic.TimeLength)} (${getFormattedTime(currentMusic.TimeLength - currentMusic.TimePosition)} left)`;
		});

		const playinLikeRn = musicController.trackChanged.get().nowPlaying?.track;
		this.parts.CurrentlyPlayingTab.TrackName.Text = playinLikeRn?.Name ?? "No track playing";

		this.event.subscribeObservable(
			musicController.trackChanged,
			({ nowPlaying, previousTrack }) => {
				const currentMusic = nowPlaying?.track;
				this.parts.CurrentlyPlayingTab.TrackName.Text = currentMusic?.Name ?? "No track playing";
				if (currentMusic) mp.get(currentMusic)?.setPlayingState(true);

				const wasPlaying = previousTrack?.track;
				if (wasPlaying) mp.get(wasPlaying)?.setPlayingState(false);
			},
			true,
		);
	}
}

export type PlaylistSingularTrackGuiParts = {
	readonly Frame: GuiObject & {
		Meta: GuiObject & {
			AuthorLabel: TextLabel;
			NameLabel: TextLabel;
		};

		PlayingIcon: {
			PlayingLabel: TextLabel;
		};
		readonly PlaylistName: TextBox;
	};
	readonly VolumeBar: GuiObject;
};

class MusicTrackEntryGuiElement extends PartialControl<PlaylistSingularTrackGuiParts> {
	constructor(
		gui: GuiObject,
		readonly info: MusicEntry,
	) {
		super(gui);

		let [author, name] = info.track?.Name.split("-").map((v) => v.trim()) ?? [];

		if (!name) {
			name = author ?? "UNNAMED";
			author = "UNKNOWN";
		}

		this.parts.Frame.Meta.AuthorLabel.Text = author;
		this.parts.Frame.Meta.NameLabel.Text = name;
		this.parts.Frame.PlaylistName.Text = info.playlistID;
		this.parts.Frame.PlayingIcon.PlayingLabel.Visible = false;
	}

	setPlayingState(state: boolean) {
		this.parts.Frame.PlayingIcon.PlayingLabel.Visible = state;
	}
}
