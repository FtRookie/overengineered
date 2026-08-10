import { RunService, SoundService } from "@rbxts/services";
import { Objects } from "engine/shared/fixes/Objects";
import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { SoundLogic } from "shared/blockLogic/SoundLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["sound", "play", "volume", "loop", "screenspace"],
	outputOrder: ["isPlaying", "progress", "loudness"],
	input: {
		sound: {
			displayName: "Sound",
			types: {
				sound: {
					config: { id: "584691395" },
				},
			},
		},
		play: {
			displayName: "Play",
			types: {
				bool: { config: false },
			},
		},
		volume: {
			displayName: "Volume",
			types: {
				number: {
					config: 1,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 10,
					},
				},
			},
		},
		loop: {
			displayName: "Loop",
			tooltip: "Whether to loop the sound while Play input is true",
			types: {
				bool: { config: false },
			},
		},
		screenspace: {
			displayName: "Screenspace",
			tooltip: "Whether the audio is played in 2D or 3D, not replicated",
			types: {
				bool: { config: false },
			},
			connectorHidden: true,
		},
	},
	output: {
		isPlaying: {
			displayName: "Is playing",
			types: ["bool"],
		},
		progress: {
			displayName: "Progress",
			unit: "seconds",
			types: ["number"],
		},
		loudness: {
			displayName: "Loudness",
			unit: "Number, 0-1000",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

const updateSound = (instance: Sound, sound: BlockLogicTypes.SoundValue): boolean => {
	if (!sound.id || sound.id.size() === 0) {
		instance.Stop();
		instance.SoundId = "";
		return false;
	}

	if (sound.effects) {
		for (const effect of sound.effects) {
			if (!SoundLogic.typeCheck(effect)) {
				instance.SoundId = "";
				return false;
			}
		}
	}

	let restart;

	const newId = `rbxassetid://${sound.id}`;
	if (instance.SoundId === newId) {
		restart = false;
	} else {
		restart = true;
		instance.SoundId = newId;
	}

	instance.PlaybackSpeed = sound.speed ?? 1;
	instance.PlaybackRegionsEnabled = sound.start !== undefined || sound.length !== undefined;
	if (instance.PlaybackRegionsEnabled) {
		instance.PlaybackRegion = new NumberRange(sound.start ?? 0, (sound.start ?? 0) + (sound.length ?? 999));
	}

	if (!sound.effects || sound.effects.size() === 0) {
		instance.ClearAllChildren();
	} else {
		const existingEffects = instance.GetChildren().toSet();

		let idx = 0;
		for (const effect of sound.effects) {
			let effinstance = existingEffects.find((c) => c.ClassName === effect.type) as SoundEffect | undefined;
			if (effinstance) {
				existingEffects.delete(effinstance);
			} else {
				effinstance = new Instance(effect.type, instance);
			}

			for (const [k, v] of pairs(effect.properties)) {
				effinstance[k as "Priority"] = v as number;
			}

			effinstance.Priority = --idx;
		}

		for (const child of existingEffects) {
			child.Destroy();
		}
	}

	return restart;
};

const tSound = t.intersection(
	t.interface({
		id: t.string,
	}),
	t.partial({
		effects: t.array(t.union(...Objects.values(SoundLogic.effects))),
		speed: t.number,
		start: t.number,
		length: t.number,
	}),
) satisfies t.Type<BlockLogicTypes.SoundValue> as t.Type<BlockLogicTypes.SoundValue>;

const updateType = t.intersection(
	t.interface({
		block: t.instance("Model").nominal("blockModel"),
		play: t.boolean,
	}),
	t.partial({
		sound: tSound,
		progress: t.number,
		volume: t.numberWithBounds(0, 10),
		loop: t.boolean,
	}),
);
type UpdateType = t.Infer<typeof updateType>;

/**
 * A screenspace sound is moved off the block, so it can no longer be found by walking down to the part —
 * every lookup goes through here instead. The entry clears itself when the sound goes.
 */
const sounds = new Map<BlockModel, Sound>();
const getSound = (block: BlockModel): Sound => {
	const existing = sounds.get(block);
	if (existing) return existing;

	const created = new Instance("Sound");
	created.Parent = block.PrimaryPart;
	sounds.set(block, created);
	created.Destroying.Connect(() => sounds.delete(block));

	return created;
};

const update = ({ block, play, sound, loop, progress, volume }: UpdateType) => {
	if (!block) return;
	const instance = getSound(block);

	instance.Looped = (play ?? false) && (loop ?? false);
	if (volume !== undefined) {
		instance.Volume = volume;
		instance.RollOffMaxDistance = 10_000 * volume;
	}

	let restart = false;
	if (sound) restart = updateSound(instance, sound);

	if (progress !== undefined) instance.TimePosition = progress;

	if (instance.IsPlaying) {
		if (restart) {
			instance.Play();
		}
	} else {
		if (play && (sound?.id === undefined || sound.id.size() !== 0)) {
			instance.Play();
		}
	}
};

const events = {
	update: new BlockSynchronizer("b_speaker_update", updateType, update),
};
events.update.getExisting = (stored): UpdateType => {
	const sound = sounds.get(stored.block);
	if (!sound) return stored;

	return {
		block: stored.block,
		sound: stored.sound,

		play: sound.Playing,
		progress: sound.TimePosition,
		volume: sound.Volume,
		loop: sound.Looped,
	};
};

export type { Logic as SpeakerBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		// through the registry so the payload handler still finds it once screenspace moves it off the block
		const soundInstance = getSound(this.instance);
		this.onDestroy(() => soundInstance.Destroy());

		soundInstance.Played.Connect(() => this.output.isPlaying.set("bool", true));
		soundInstance.Ended.Connect(() => this.output.isPlaying.set("bool", false));
		soundInstance.Stopped.Connect(() => this.output.isPlaying.set("bool", false));
		this.output.isPlaying.set("bool", false);
		this.output.progress.set("number", 0);
		this.output.loudness.set("number", 0);

		this.onTicc(() => {
			this.output.loudness.set("number", soundInstance.PlaybackLoudness);
		});

		const playCache = this.initializeInputCache("play");
		const soundCache = this.initializeInputCache("sound");
		const volumeCache = this.initializeInputCache("volume");
		const loopCache = this.initializeInputCache("loop");

		// BlockSynchronizer keeps only the last payload per block and replays it to joining players, so every
		// send has to carry the whole state or the missing fields are lost for them
		const sendAll = (play: boolean) =>
			events.update.send({
				block: block.instance,
				play,
				sound: soundCache.tryGet(),
				loop: loopCache.tryGet() ?? false,
				volume: volumeCache.tryGet() ?? 0,
			});

		this.onk(["sound"], () => {
			// a sound picked while stopped is held until play goes high, rather than starting on its own
			if (!soundInstance.IsPlaying && !playCache.tryGet()) return;
			sendAll(true);
		});

		this.onk(["volume"], () => {
			if (!soundInstance.Playing) return;
			sendAll(true);
		});
		this.onk(["loop"], () => {
			if (!soundInstance.Playing) return;
			sendAll(true);
		});

		this.onk(["play"], ({ play }) => sendAll(play));

		// Local by design (see the input's tooltip): only this player hears the flat mix, everyone else keeps
		// the sound positioned at the block, so it is applied here rather than travelling in the payload.
		if (RunService.IsClient()) {
			this.onk(["screenspace"], ({ screenspace }) => {
				const parent = screenspace ? SoundService : this.instance.PrimaryPart;
				if (soundInstance.Parent === parent) return;

				// A playing sound carries its old spatialization across the move, so it has to be restarted
				// for the new parent to take effect; the seek keeps the restart inaudible.
				const resumeAt = soundInstance.IsPlaying ? soundInstance.TimePosition : undefined;
				soundInstance.Parent = parent;

				if (resumeAt !== undefined) {
					soundInstance.Play();
					soundInstance.TimePosition = resumeAt;
				}
			});
		}

		this.event.loop(0, () => {
			this.output.progress.set("number", soundInstance?.TimePosition ?? 0);
		});
	}
}

export const SpeakerBlock = {
	...BlockCreation.defaults,
	id: "speaker",
	displayName: "Speaker",
	description: "Definitely speaks something",
	limit: 50,
	search: {
		partialAliases: ["sound", "music", "speaker", "play"],
	},

	logic: { definition, ctor: Logic, events },
} as const satisfies BlockBuilder;
