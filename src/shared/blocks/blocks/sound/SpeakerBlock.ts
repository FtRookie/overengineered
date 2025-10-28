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
	inputOrder: ["sound", "play", "volume", "loop"],
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

const update = ({ block, play, sound, loop, progress, volume }: UpdateType) => {
	if (!block) return;
	const instance = block.PrimaryPart?.FindFirstChildOfClass("Sound") ?? new Instance("Sound", block.PrimaryPart);

	instance.Looped = (play ?? false) && (loop ?? false);
	if (volume) {
		instance.Volume = volume;
		instance.RollOffMaxDistance = 10_000 * volume;
	}

	let restart = false;
	if (sound) restart = updateSound(instance, sound);

	if (progress) instance.TimePosition = progress;

	if (instance.IsPlaying) {
		if (restart) {
			instance.Play();
		}
	} else {
		if (play && (!sound?.id || sound.id.size() !== 0)) {
			instance.Play();
		}
	}
};

const events = {
	update: new BlockSynchronizer("b_speaker_update", updateType, update),
};
events.update.getExisting = (stored): UpdateType => {
	const sound = stored.block.PrimaryPart?.FindFirstChildOfClass("Sound");
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

		const soundInstance = new Instance("Sound", this.instance.PrimaryPart);
		soundInstance.Played.Connect(() => this.output.isPlaying.set("bool", true));
		soundInstance.Ended.Connect(() => this.output.isPlaying.set("bool", false));
		soundInstance.Stopped.Connect(() => this.output.isPlaying.set("bool", false));
		this.output.isPlaying.set("bool", false);
		this.output.progress.set("number", 0);
		this.output.loudness.set("number", 0);

		let nextSoundUpdate: BlockLogicTypes.SoundValue | undefined;
		this.onTicc(() => {
			this.output.loudness.set("number", soundInstance.PlaybackLoudness);
		});

		const playCache = this.initializeInputCache("play");

		this.onk(["sound"], ({ sound }) => {
			if (!soundInstance.IsPlaying) {
				if (!playCache.tryGet()) {
					nextSoundUpdate = sound;
					return;
				}
			}

			events.update.send({
				block: block.instance,
				play: true,
				loop: loopCache.tryGet() ?? false,
				sound,
			});
		});

		this.onk(["volume"], ({ volume }) => {
			if (!soundInstance.Playing) return;
			events.update.send({ block: block.instance, play: true, volume });
		});
		this.onk(["loop"], ({ loop }) => {
			if (!soundInstance.Playing) return;
			events.update.send({ block: block.instance, play: true, loop });
		});

		const volumeCache = this.initializeInputCache("volume");
		const loopCache = this.initializeInputCache("loop");
		this.onk(["play"], ({ play }) => {
			if (!play) {
				events.update.send({ block: block.instance, play: false });
				return;
			}

			events.update.send({
				block: block.instance,
				sound: nextSoundUpdate,
				play: true,
				loop: loopCache.tryGet() ?? false,
				volume: volumeCache.tryGet() ?? 0,
			});
			nextSoundUpdate = undefined;
		});

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
