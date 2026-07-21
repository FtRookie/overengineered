import { RunService } from "@rbxts/services";
import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { SliderControl } from "client/gui/controls/SliderControl";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { PartialControl } from "engine/client/gui/PartialControl";
import type { MusicController, MusicEntry } from "client/controller/sound/MusicController";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

export class PlayerSettingsPlaylist extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		const sc = Interface.getInterface<{
			Popups: { Crossplatform: { Playlist: { Content: GuiObject } } };
		}>().Popups.Crossplatform.Playlist.Content.Clone();
		sc.Parent = gui;

		this.onInject((di) => {
			this.parent(di.resolveForeignClass(PlaylistGui, [sc as never]));
		});
	}
}

// TODO: add ability to make music non-environmental
// TODO: allow players to select enabled tracks
// TODO: implement shuffle/ordered buttons

export type PlaylistGuiParts = {
	readonly ProgressBars: {
		PlayingBar: GuiObject & {
			Filled: GuiObject;
			VolumeLabel: TextLabel;
		};
		VolumeBar: GuiObject & {
			Filled: GuiObject;
			Knob: GuiObject;
		};
		VolumeLabel: TextBox;
		ImageButton: ImageButton;
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
	constructor(gui: GuiObject, @inject musicController: MusicController, @inject playerData: PlayerDataStorage) {
		super(gui);

		// Playing progress bar doubles as a seek slider. While the user drags it we set
		// `seeking` so the Heartbeat below stops pulling it back to the live position.
		const playingBar = this.parts.ProgressBars.PlayingBar;
		const playingSlider = this.parent(new SliderControl(playingBar, { min: 0, max: 1, step: 0.001 }));
		let seeking = false;
		this.event.subscribe(playingSlider.moved, () => (seeking = true));
		this.event.subscribe(playingSlider.submitted, (v) => {
			seeking = false;
			const currentMusic = musicController.trackChanged.get().nowPlaying?.track;
			if (!currentMusic || currentMusic.TimeLength === 0) return;
			currentMusic.TimePosition = v * currentMusic.TimeLength;
		});

		// Global music volume slider (moved here from General settings).
		const volumeBar = this.parts.ProgressBars.VolumeBar;
		const volumeSlider = this.parent(new SliderControl(volumeBar, { min: 0, max: 100, step: 1 }));

		const configGeneralVolume = playerData.config.get().audio.masterVolume;
		volumeSlider.value.set(configGeneralVolume);
		this.parts.ProgressBars.VolumeLabel.Text = `${configGeneralVolume}%`;

		// Mute toggle. The icon reflects an explicit mute OR volume at 0, so it must refresh both on the
		// toggle and whenever the volume slider moves.
		let isMuted = playerData.config.get().audio.muted;
		const refreshMuteIcon = () => {
			this.parts.ProgressBars.ImageButton.Image =
				isMuted || volumeSlider.value.get() === 0 ? "rbxassetid://14861956881" : "rbxassetid://14861958607";
		};
		const setMuted = (muted: boolean) => {
			isMuted = muted;
			refreshMuteIcon();
			playerData.sendPlayerConfig({ audio: { muted } });
		};

		// Live preview while dragging, persist on release.
		this.event.subscribe(volumeSlider.submitted, (v) =>
			playerData.sendPlayerConfig({ audio: { masterVolume: v } }),
		);
		this.event.subscribe(volumeSlider.moved, (v: number) => {
			const volume = math.round(v);
			for (const p of musicController.allPlaylists) p.setVolume(volume / 100);
			this.parts.ProgressBars.VolumeLabel.Text = `${volume}%`;
			refreshMuteIcon();
		});

		const template = this.asTemplate(this.parts.ScrollingFrame.TemplateMusicTrack);

		const mp = new Map<Sound, MusicTrackEntryGuiElement>();
		const sf = this.parent(new Control(this.parts.ScrollingFrame));
		for (const p of musicController.allPlaylists) {
			for (const s of p.allSounds) {
				const e = new MusicTrackEntryGuiElement(
					template(),
					{
						playlistID: p.name,
						originalPlaylist: p,
						track: s.sound,
					},
					playerData,
				);
				mp.set(s.sound, e);
				sf.parent(e);
			}
		}

		// Toggle mute on click/tap — Activated fires for both mouse and touch on a GuiButton.
		refreshMuteIcon();
		this.event.subscribe(this.parts.ProgressBars.ImageButton.Activated, () => setMuted(!isMuted));

		//setPlayingState
		this.event.subscribe(RunService.PostSimulation, () => {
			const currentMusic = musicController.trackChanged.get().nowPlaying?.track;
			if (!currentMusic || currentMusic.TimeLength === 0) {
				this.parts.CurrentlyPlayingTab.TrackName.Text = "Nothing";
				if (!seeking) playingSlider.value.set(0);
				this.parts.ProgressBars.PlayingBar.VolumeLabel.Text = `- / -`;
				return;
			}

			// Follow playback unless the user is actively seeking. The slider's value
			// drives the Filled bar via ProgressBarControl, so we don't touch Filled here.
			if (!seeking) {
				playingSlider.value.set(currentMusic.TimePosition / currentMusic.TimeLength);
			}

			const pos = playingSlider.value.get() * currentMusic.TimeLength;
			this.parts.ProgressBars.PlayingBar.VolumeLabel.Text = `${getFormattedTime(pos)}/${getFormattedTime(currentMusic.TimeLength)} (${getFormattedTime(math.floor(currentMusic.TimeLength - pos))} left)`;
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
		readonly Meta: GuiObject & {
			AuthorLabel: TextLabel;
			NameLabel: TextLabel;
		};

		readonly PlayingIcon: {
			PlayingLabel: TextLabel;
		};
		readonly PlaylistName: TextBox;
	};
	readonly VolumeBar: GuiObject & {
		Filled: GuiObject;
		Knob: GuiObject;
	};

	VolumeLabel: TextLabel;
	ImageButton: ImageButton;
};

class MusicTrackEntryGuiElement extends PartialControl<PlaylistSingularTrackGuiParts> {
	constructor(
		gui: GuiObject,
		readonly info: MusicEntry,
		readonly playerData: PlayerDataStorage,
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

		const track = info.track;
		if (!track) return;

		const volumeBar = this.parts.VolumeBar;
		const slider = this.parent(new SliderControl(volumeBar, { min: 0, max: 1, step: 0.01 }));

		const updateLabel = (v: number) => (this.parts.VolumeLabel.Text = `${math.round(v * 100)}%`);

		let isMuted = false;
		const appliedVolumes = playerData.config.get().audio.volumes.filter((v) => {
			const c = v.assetID === track.SoundId;
			if (c) isMuted = v.isMuted ?? false;
			return c;
		});
		if (appliedVolumes.isEmpty())
			appliedVolumes.push({
				assetID: track.SoundId,
				volume: info.originalPlaylist.getVolumeForSound(track) ?? 0.5,
			});
		const volumeInfo = appliedVolumes[0];

		const refreshMuteIcon = () => {
			this.parts.ImageButton.Image =
				isMuted || slider.value.get() === 0 ? "rbxassetid://14861812886" : "rbxassetid://14861815333";
		};

		// Effective track volume: the slider value, or silence while muted. THIS is what actually moves
		// the audio — muting just drops the per-track multiplier to 0.
		const applyVolume = (v: number) => info.originalPlaylist.setUserVolume(track, isMuted ? 0 : v);

		// Live preview while dragging — no config write (avoids per-frame spam). Icon follows the volume.
		const preview = (v: number) => {
			applyVolume(v);
			updateLabel(v);
			refreshMuteIcon();
		};

		this.event.subscribe(slider.moved, preview);

		// save on knob release
		this.event.subscribe(slider.submitted, (v: number) => {
			preview(v);
			const others = playerData.config.get().audio.volumes.filter((e) => e.assetID !== track.SoundId);
			playerData.sendPlayerConfig({
				audio: { volumes: [...others, { assetID: track.SoundId, volume: v, isMuted }] },
			});
		});

		// mute toggle — Activated fires for both mouse and touch. Re-applies the volume so it really
		// silences/restores the track, and saves the slider volume (not the muted 0) so unmute restores it.
		const setMuted = (muted: boolean) => {
			isMuted = muted;
			applyVolume(slider.value.get());
			refreshMuteIcon();
			const others = playerData.config.get().audio.volumes.filter((e) => e.assetID !== track.SoundId);
			playerData.sendPlayerConfig({
				audio: {
					volumes: [...others, { assetID: track.SoundId, volume: slider.value.get(), isMuted: muted }],
				},
			});
		};

		this.event.subscribe(this.parts.ImageButton.Activated, () => setMuted(!isMuted));

		// Apply the saved/initial volume on open so the sound matches the slider, then sync the icon.
		slider.value.set(volumeInfo.volume);
		preview(volumeInfo.volume);
	}

	setPlayingState(state: boolean) {
		this.parts.Frame.PlayingIcon.PlayingLabel.Visible = state;
	}
}
