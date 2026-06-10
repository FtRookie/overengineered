import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { SoundLogic } from "shared/blockLogic/SoundLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

export namespace SoundEffectBlockCreator {
	namespace SpeedEffect {
		const definition = {
			inputOrder: ["sound", "speed"],
			input: {
				sound: {
					displayName: "Sound",
					types: {
						sound: { config: { id: "584691395" } },
					},
				},
				speed: {
					displayName: "Speed",
					tooltip: "Playback speed. Also changes pitch",
					types: {
						number: { config: 1 },
					},
				},
			},
			output: {
				output: {
					displayName: "Output sound",
					types: ["sound"],
				},
			},
		} satisfies BlockLogicFullBothDefinitions;

		class Logic extends InstanceBlockLogic<typeof definition> {
			constructor(block: InstanceBlockLogicArgs) {
				super(definition, block);

				this.onk(["sound", "speed"], (arg) => {
					this.output.output.set("sound", {
						...arg.sound,
						speed: arg.speed,
					});
				});
			}
		}

		export const Block = {
			...BlockCreation.defaults,
			displayName: `Sound Effect: Speed`,
			description: "Changes the playback speed of the sound, along with its pitch",

			modelSource: {
				model: BlockCreation.Model.fAutoCreated("DoubleSoundLogicBlockPrefab", `SOUND SPEED`),
				category: () => BlockCreation.Categories.sound,
			},
			id: `soundeff_speed`,

			logic: { definition, ctor: Logic },
		};
	}
	namespace SoundCutEffect {
		const definition = {
			inputOrder: ["sound", "start", "length"],
			input: {
				sound: {
					displayName: "Sound",
					types: {
						sound: { config: { id: "584691395" } },
					},
				},
				start: {
					displayName: "Start",
					unit: "seconds",
					types: {
						number: { config: 0 },
					},
				},
				length: {
					displayName: "Length",
					unit: "seconds",
					types: {
						number: { config: 1 },
					},
				},
			},
			output: {
				output: {
					displayName: "Output sound",
					types: ["sound"],
				},
			},
		} satisfies BlockLogicFullBothDefinitions;

		class Logic extends InstanceBlockLogic<typeof definition> {
			constructor(block: InstanceBlockLogicArgs) {
				super(definition, block);

				this.onk(["sound", "start", "length"], (arg) => {
					this.output.output.set("sound", {
						...arg.sound,
						start: arg.start,
						length: arg.length,
					});
				});
			}
		}

		export const Block = {
			...BlockCreation.defaults,
			displayName: `Sound Cut`,
			description: "Trims the sound to a specific start time and duration",

			modelSource: {
				model: BlockCreation.Model.fAutoCreated("DoubleSoundLogicBlockPrefab", `SOUND CUT`),
				category: () => BlockCreation.Categories.sound,
			},
			id: `soundeff_cut`,

			logic: { definition, ctor: Logic },
		};
	}

	export const all: readonly BlockBuilder[] = [
		SpeedEffect.Block,
		SoundCutEffect.Block,
		ezcreate({
			id: "ChorusSoundEffect",
			name: "Chorus",
			description: "Sounds like multiple sounds playing together",
			modelText: "CHORUS",
			prefab: "TripleSoundLogicBlockPrefab",
		}),
		ezcreate({
			id: "CompressorSoundEffect",
			name: "Compressor",
			description: "Levels out the volume between loud and quiet parts",
			modelText: "COMPR",
			prefab: "TripleSoundLogicBlockPrefab",
		}),
		ezcreate({
			id: "DistortionSoundEffect",
			name: "Distortion",
			description: "Makes the sound rough and buzzy",
			modelText: "DISTORT",
			prefab: "DoubleSoundLogicBlockPrefab",
		}),
		ezcreate({
			id: "EchoSoundEffect",
			name: "Echo",
			description: "Repeats the sound with decreasing volume, like shouting into a cave",
			modelText: "ECHO",
			prefab: "TripleSoundLogicBlockPrefab",
		}),
		ezcreate({
			id: "EqualizerSoundEffect",
			name: "Equalizer",
			description: "Allows you to adjust the volume of the low, middle, and high frequencies of the sound.",
			modelText: "EQ",
			prefab: "TripleSoundLogicBlockPrefab", // TODO: Custom model (prefab but icon)
		}),
		ezcreate({
			id: "FlangeSoundEffect",
			name: "Flange",
			description: "Makes you feel like someone glued the speaker to a spring.",
			modelText: "FLANGE",
			prefab: "TripleSoundLogicBlockPrefab",
		}),
		ezcreate({
			id: "PitchShiftSoundEffect",
			name: "Pitch",
			description: "Shifts the pitch up or down without changing the speed",
			modelText: "PITCH",
			prefab: "DoubleSoundLogicBlockPrefab",
		}),
		ezcreate({
			id: "ReverbSoundEffect",
			name: "Reverb",
			description: "Applies the effect of being in a big room.",
			modelText: "REVERB",
			prefab: "TripleSoundLogicBlockPrefab",
		}),
		ezcreate({
			id: "TremoloSoundEffect",
			name: "Tremolo",
			description: "Oscillates volume to create a wave effect",
			modelText: "TREM",
			prefab: "TripleSoundLogicBlockPrefab",
		}),
	];

	function ezcreate(props: {
		id: SoundLogic.Instances;
		name: string;
		description: string;
		modelText: string;
		prefab: BlockCreation.Model.PrefabName;
	}) {
		const { id, name, description } = props;
		return create(id, {
			displayName: `Sound Effect: ${name}`,
			description,

			modelSource: {
				model: BlockCreation.Model.fAutoCreated(
					props.prefab,
					props.prefab === "SoundLogicBlockPrefab" ? props.modelText : `SOUND ${props.modelText}`,
				),
				category: () => BlockCreation.Categories.sound,
			},
		});
	}

	function create(
		key: SoundLogic.Instances,
		props: MakeRequired<Partial<BlockBuilder>, "displayName" | "description">,
	): BlockBuilder {
		const maker = SoundLogic.effectMaker(key);
		const keys = asMap(maker.props as { [k in string]: unknown }).keys();

		const pascalCaseToName = (str: string) => {
			let ret = "";
			for (let i = 1; i <= str.size(); i++) {
				const char = str.sub(i, i);
				if (i !== 1 && char.upper() === char) {
					ret += ` ${char}`;
					continue;
				}
				ret += char;
			}

			return ret;
		};

		const definition = {
			inputOrder: ["sound", ...keys.map((k) => k.lower())],
			input: {
				sound: {
					displayName: "Sound",
					types: {
						sound: { config: { id: "584691395" } },
					},
				},
				...asObject(keys.mapToMap((k) => $tuple(k.lower(), maker.makeConfig(k as never, pascalCaseToName(k))))),
			},
			output: {
				output: {
					displayName: "Output sound",
					types: ["sound"],
				},
			},
		} satisfies BlockLogicFullBothDefinitions;

		class Logic extends InstanceBlockLogic<typeof definition> {
			constructor(block: InstanceBlockLogicArgs) {
				super(definition, block);

				this.onk(["sound", ...(keys.map((c) => c.lower()) as never)], (arg) => {
					this.output.output.set("sound", {
						...arg.sound,
						effects: [
							...(arg.sound.effects ?? []),
							{
								type: key,
								properties: asObject(keys.mapToMap((k) => $tuple(k, arg[k.lower() as never]))),
							},
						],
					});
				});
			}
		}

		return {
			...BlockCreation.defaults,
			...props,
			id: `soundeff_${key}`,

			logic: { definition, ctor: Logic },
		};
	}
}
