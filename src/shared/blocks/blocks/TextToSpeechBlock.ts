import { RunService } from "@rbxts/services";
import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

// The clamp values are enforced by the TTS, so changing them wont do anything (also why they are quite specific)
const definition = {
	inputOrder: ["text", "play", "volume", "voiceid", "pitch", "speed", "playbackspeed", "doloop"],
	input: {
		text: {
			displayName: "Text",
			tooltip: "The text to be spoken",
			types: {
				string: {
					config: "Hello Overengineered!",
				},
			},
		},
		play: {
			displayName: "Play",
			tooltip: "Play the speech, stops if false",
			types: {
				bool: {
					config: true, // as to show it works without needed to change config
				},
			},
		},
		volume: {
			displayName: "Volume",
			types: {
				number: {
					config: 1,
					clamp: {
						min: 0,
						max: 3,
						showAsSlider: true,
					},
				},
			},
		},
		voiceid: {
			displayName: "Voice Id",
			types: {
				number: {
					config: 8,
					clamp: {
						min: 0,
						max: 9,
						showAsSlider: true,
						step: 1,
					},
				},
			},
		},
		pitch: {
			displayName: "Voice Pitch",
			tooltip: "Pitch of the audio, separate from its speed",
			types: {
				number: {
					config: 0,
					clamp: {
						min: -12,
						max: 12,
						showAsSlider: true,
					},
				},
			},
		},
		speed: {
			displayName: "Voice Speed",
			tooltip: "The speed of the audio, separate from its pitch",
			types: {
				number: {
					config: 1,
					clamp: {
						min: 0.5,
						max: 2,
						showAsSlider: true,
					},
				},
			},
		},
		playbackspeed: {
			displayName: "Playback Speed",
			tooltip: "Controls how quickly the audio is played, which controls its pitch",
			types: {
				number: {
					config: 1,
					clamp: {
						min: 0,
						max: 20,
						showAsSlider: true,
					},
				},
			},
		},
		doloop: {
			displayName: "Loop",
			tooltip: "If the audio loops",
			types: {
				bool: {
					config: false,
				},
			},
		},
	},
	outputOrder: ["isplaying", "isloaded", "timelength", "timeposition"],
	output: {
		isplaying: {
			displayName: "Is Playing",
			types: ["bool"],
		},
		isloaded: {
			displayName: "Is Loaded",
			types: ["bool"],
		},
		timelength: {
			displayName: "Time Length",
			unit: "seconds",
			types: ["number"],
		},
		timeposition: {
			displayName: "Time Position",
			unit: "seconds",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

const ttsUpdateType = t.intersection(
	t.interface({
		block: t.instance("Model").nominal("blockModel"),
		play: t.boolean,
		text: t.string,
		voiceId: t.string,
		speed: t.numberWithBounds(0.5, 2),
		playbackSpeed: t.numberWithBounds(0, 20),
		pitch: t.numberWithBounds(-12, 12),
		volume: t.numberWithBounds(0, 3),
		loop: t.boolean,
	}),
);
type ttsUpdateType = t.Infer<typeof ttsUpdateType>;

interface BlockAudioState {
	emitter?: AudioEmitter;
	audioFader?: AudioFader;
	tts?: AudioTextToSpeech;
	wire?: Wire;
	wire2?: Wire;
}
const ttsRegistry = new Map<Instance, BlockAudioState>();

const ttsUpdate = ({ block, play, text, voiceId, speed, playbackSpeed, pitch, volume, loop }: ttsUpdateType) => {
	if (!RunService.IsClient()) {
		warn("error - running for server");
		return;
	}
	if (!block) return;

	let state = ttsRegistry.get(block);
	if (!state) {
		state = {};
		ttsRegistry.set(block, state);
	}

	if (play) {
		let needRewire = false;

		// Create items if needed
		if (!state.emitter) {
			state.emitter = new Instance("AudioEmitter");
			state.emitter.Parent = (block.FindFirstChild("Part") as BasePart) ?? block;
			needRewire = true;
		}

		if (!state.audioFader) {
			state.audioFader = new Instance("AudioFader");
			state.audioFader.Parent = block;
			needRewire = true;
		}

		if (!state.tts) {
			state.tts = new Instance("AudioTextToSpeech");
			state.tts.Parent = block;
			needRewire = true;
		}

		// Create / reset wires if needed

		if (needRewire || !state.wire) {
			if (state.wire) state.wire.Destroy();
			state.wire = new Instance("Wire");
			state.wire.Name = "Wire1";
			state.wire.SourceInstance = state.tts;
			state.wire.TargetInstance = state.audioFader;
			state.wire.Parent = state.tts;
		}
		if (needRewire || !state.wire2) {
			if (state.wire2) state.wire2.Destroy();
			state.wire2 = new Instance("Wire");
			state.wire2.Name = "Wire2";
			state.wire2.SourceInstance = state.audioFader;
			state.wire2.TargetInstance = state.emitter;
			state.wire2.Parent = state.audioFader;
		}

		const tts = state.tts;

		tts.VoiceId = voiceId;
		tts.Speed = speed;
		tts.PlaybackSpeed = playbackSpeed;
		tts.Pitch = pitch;
		tts.Volume = volume;
		state.audioFader.Volume = volume;
		tts.Looping = loop;

		(async () => {
			tts.Text = text;
			const status = tts.LoadAsync();
			if (status === Enum.AssetFetchStatus.Success) {
				tts.Play();
			} else if (status === Enum.AssetFetchStatus.TimedOut) {
				warn("Loading TTS timed out");
			} else {
				warn("Failed to play:", status.Name);
			}
		})();
	} else {
		// Cleanup
		state.emitter?.Destroy();
		state.wire?.Destroy();
		state.wire2?.Destroy();
		if (state.tts) {
			state.tts.Unload();
			state.tts.Destroy();
		}
		ttsRegistry.delete(block);
	}
};

const events = {
	update: new BlockSynchronizer("b_tts_sound_update", ttsUpdateType, ttsUpdate),
} as const;

export class TTSBlockLogic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const textCache = this.initializeInputCache("text");
		const voiceIdCache = this.initializeInputCache("voiceid");
		const speedCache = this.initializeInputCache("speed");
		const playbackSpeedCache = this.initializeInputCache("playbackspeed");
		const pitchCache = this.initializeInputCache("pitch");
		const volumeCache = this.initializeInputCache("volume");
		const loopCache = this.initializeInputCache("doloop");

		let studioWarningSent = false; // Only warn once

		const syncToServer = (play: boolean) => {
			const text = textCache.get();
			if (!text) return;

			if (RunService.IsStudio() && !studioWarningSent) {
				// Sometimes it does, sometimes it doesn't
				$warn("TTS might not work in studio");
				studioWarningSent = true;
				this.disableAndBurn();
			}

			if (text.size() > 300) {
				$warn("TTS text too long - limit of 300 characters");
				this.disableAndBurn();
				return;
			}

			const data = {
				block: this.instance,
				play,
				text: text,
				voiceId: tostring(math.floor(voiceIdCache.tryGet() ?? 8)),
				speed: speedCache.get() ?? 1,
				playbackSpeed: playbackSpeedCache.get() ?? 1,
				pitch: pitchCache.get() ?? 0,
				volume: volumeCache.get() ?? 1,
				loop: loopCache.get() ?? false,
			};
			events.update.send(data);
		};

		// when any setting changes
		this.on((ctx) => {
			syncToServer(ctx.play);
		});

		this.onEnable(() => {
			syncToServer(false);
			const data = ttsRegistry.get(this.instance);
			if (!data) return;

			this.output.isplaying.set("bool", data.tts?.IsPlaying ?? false);
			this.output.isloaded.set("bool", data.tts?.IsLoaded ?? false);
			this.output.timelength.set("number", data.tts?.TimeLength ?? 0);
			this.output.timeposition.set("number", data.tts?.TimePosition ?? 0);
		});

		this.event.loop(0, () => {
			const data = ttsRegistry.get(this.instance);
			if (!data) return;

			// This is also what the SpeakerBlock does :)
			this.output.isplaying.set("bool", data.tts?.IsPlaying ?? false);
			this.output.isloaded.set("bool", data.tts?.IsLoaded ?? false);
			this.output.timelength.set("number", data.tts?.TimeLength ?? 0);
			this.output.timeposition.set("number", data.tts?.TimePosition ?? 0);
		});
	}
}

export const TTSBlock = {
	...BlockCreation.defaults,
	id: "texttospeech",
	displayName: "Text To Speech",
	description: "It says stuff behind your back.",
	limit: 6, // Unlike speaker it sends packets to the roblox TTS service (and which every player needs to load it)
	search: {
		partialAliases: ["tts", "text to speech", "speak", "🗣️", "📢"],
	},

	logic: { definition, ctor: TTSBlockLogic, events },
} as const satisfies BlockBuilder;
