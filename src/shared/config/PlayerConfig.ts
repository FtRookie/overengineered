import { Colors } from "shared/Colors";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { GameEnvironment } from "shared/data/GameEnvironment";
import { destructibleSpecs } from "shared/environment/Destructibles";
import { GetUnloadables } from "shared/MapLoadingConfigurator";

declare global {
	type DayCycleConfiguration = {
		readonly automatic: boolean;
		readonly manual: number;
	};
	type BeaconsConfiguration = {
		readonly plot: boolean;
		readonly players: boolean;
	};
	type CameraConfiguration = {
		readonly improved: boolean;
		readonly strictFollow: boolean;
		readonly playerCentered: boolean;
		readonly fov: number;
	};
	type GraphicsConfiguration = {
		readonly localShadows: boolean;
		readonly othersShadows: boolean;
		readonly othersEffects: boolean;
		readonly logicEffects: boolean;
		readonly vaporCones: boolean;
		readonly camera: CameraConfiguration;
	};
	type SearchBehaviourConfiguration = {
		readonly onSubmit: boolean;
		readonly delay: number;
		readonly resetOnSearch: boolean;
	};
	type VisualsSelectionBox = {
		readonly borderColor: Color3;
		readonly borderTransparency: number;
		readonly borderThickness: number;
		readonly surfaceColor: Color3;
		readonly surfaceTransparency: number;
	};
	type WireSelectionConfig = {
		readonly markerTransparency: number;
		readonly markerSizeMultiplier: number;
		readonly wireTransparency: number;
		readonly wireThicknessMultiplier: number;
	};
	type LogicDebugColorConfig = {
		readonly fontSize: number;
		readonly textStroke: Color4;
		readonly boldText: boolean;
		readonly AVAILATER: Color4;
		readonly GARBAGE: Color4;
		readonly DISABLED: Color4;
		readonly nan: Color4;
		readonly true: Color4;
		readonly false: Color4;
		readonly numberZero: Color4;
		readonly numberPositive: Color4;
		readonly numberNegative: Color4;
		readonly colorAsColor: boolean;
	};
	type IdeColorConfig = {
		readonly background: Color4;
		readonly iden: Color4;
		readonly keyword: Color4;
		readonly builtin: Color4;
		readonly field: Color4;
		readonly method: Color4;
		readonly string: Color4;
		readonly number: Color4;
		readonly comment: Color4;
		readonly operator: Color4;
		readonly unknown: Color4;
	};
	type VisualsConfiguration = {
		readonly selection: VisualsSelectionBox;
		readonly multiSelection: VisualsSelectionBox;
		readonly wires: WireSelectionConfig;
		readonly logicDebug: LogicDebugColorConfig;
		readonly ide: IdeColorConfig;
	};
	type UnitsConfiguration = {
		readonly targetSpeed: number;
		readonly speed: "Studs/s" | "m/s" | "km/h" | "MPH" | "Mach";
		readonly altitude: "Studs" | "Meters" | "Kilometers" | "Feet";
		readonly position: "Studs" | "Meters" | "Kilometers" | "Miles";
		readonly gravity: "Studs/s²" | "Meters/s²";
	};
	type MapUnloadConfiguration = {
		[k in string]: boolean;
	};
	type DestructiblesConfiguration = {
		[k in string]: boolean;
	};
	type TerrainConfiguration = {
		readonly kind: "Classic" | "Triangle" | "Flat" | "Water" | "Lava" | "Void";
		readonly generator: "Default" | "Realistic";
		readonly resolution: number;
		readonly foliage: boolean;
		readonly loadDistance: number;
		readonly forwardLoading: boolean;
		readonly culling: boolean;
		readonly snowOnly: boolean;
		readonly override?: {
			readonly enabled: boolean;
			readonly material: Enum.Material["Name"];
			readonly color: Color4;
		};
		readonly cloud: {
			readonly auto: boolean;
			readonly density: number;
			readonly cover: number;
		};
		readonly water: {
			readonly enabled: boolean;
			readonly color: Color4;
			readonly reflectance: number;
			readonly waveSize: number;
			readonly waveSpeed: number;
		};
		readonly triangleAddSandBelowSeaLevel: boolean;
	};
	type TutorialConfiguration = {
		readonly basics: boolean;
	};
	type RagdollConfiguration = {
		readonly autoFall: boolean;
		readonly triggerByKey: boolean;
		readonly triggerKey: KeyCode | undefined;
		readonly autoRecovery: boolean;
		readonly autoRecoveryByMoving: boolean;
	};
	type PhysicsConfiguration = {
		readonly customGravity: number;
		readonly simplified_aerodynamics: boolean;
		readonly advanced_aerodynamics: boolean;
		readonly windVelocity: Vector3;
		readonly impactDestruction: ImpactDestructionConfiguration;
	};
	type MusicTrackVolume = {
		readonly assetID: string;
		readonly volume: number;
		readonly isMuted?: boolean;
	};
	type ReplicationConfiguration = {
		readonly publicSpeakers: boolean;
		readonly publicTTS: boolean;
		readonly publicParticles: boolean;
		readonly publicTracers: boolean;
		readonly enableProjectiles: boolean;
		readonly pvp: boolean;
	};
	type CharacterConfiguration = {
		readonly sprintSpeed: number;
		readonly jumpPower: number;
		readonly mortality: boolean;
		readonly ragdoll: RagdollConfiguration;
	};
	type PlotConfiguration = {
		readonly autoLoad: boolean;
		readonly autoPlotTeleport: boolean;
		readonly autoPlotTeleportCenter: boolean;
	};
	type ImpactDestructionConfiguration = {
		readonly blockHealthModifier: number;
		readonly blockMinimalDamageThreshold: number;
		readonly enabled: boolean;
	};
	type AudioConfiguration = {
		readonly masterVolume: number;
		readonly muted: boolean;
		readonly playMode: "SHUFFLED" | "ORDERED" | "LOOPED";
		readonly volumes: readonly MusicTrackVolume[];
	};
	// key names, not Enum.KeyCode, so a binding is plain JSON. An empty list means "use the default".
	type KeybindsConfiguration = {
		readonly overrides: { readonly [action: string]: readonly (readonly KeyCode[])[] };
	};
	type SoundConfiguration = {
		readonly master: number;
		readonly volumes: { readonly [address: string]: number };
		/** How strongly a moving source shifts pitch. 0 disables the Doppler effect entirely. */
		readonly dopplerScale: number;
		/** Studs SoundService treats as a metre when simulating Doppler; defaults to the game's own scale. */
		readonly distanceFactor: number;
		/** Silence what a supersonic source has outrun. */
		readonly supersonicScaling: boolean;
		/** Crack once as a supersonic craft's cone sweeps over the listener. */
		readonly supersonicBooms: boolean;
	};
	/** Size is absent for windows that cannot be resized, and for entries saved before they could be. */
	type WindowPositionsConfiguration = {
		readonly [k in string]: { readonly x: number; readonly y: number; readonly w?: number; readonly h?: number };
	};
	type GraphingConfiguration = {
		readonly sampleHidden: boolean;
		/** Side of a plotted sample, in pixels. */
		readonly pointSize: number;
		/** Thickness of the line joining two samples, in pixels. */
		readonly segmentThickness: number;
	};
	type InterfaceConfiguration = {
		readonly graphing: GraphingConfiguration;
		readonly uiScale: number;
		readonly windowPositions: WindowPositionsConfiguration;
		readonly syntaxHighlight: boolean;
		readonly unequipClearSelection: boolean;
		readonly searchBehaviour: SearchBehaviourConfiguration;
		readonly beacons: BeaconsConfiguration;
		readonly units: UnitsConfiguration;
	};
	type EnvironmentConfiguration = {
		readonly dayCycle: DayCycleConfiguration;
		readonly destructibles: DestructiblesConfiguration;
		readonly mapUnload: MapUnloadConfiguration;
		readonly terrain: TerrainConfiguration;
		readonly physics: PhysicsConfiguration;
	};

	namespace PlayerConfigTypes {
		export type Bool = ConfigType<"bool", boolean>;
		export type Key = ConfigType<"key", KeyCode>;
		export type Number = ConfigType<"number", number>;
		export type Color = ConfigType<"color", Color3>;
		export type Dropdown<T extends string = string> = ConfigType<"dropdown", T> & {
			readonly items: readonly T[];
		};
		export type ClampedNumber = ConfigType<"clampedNumber", number> & {
			readonly min: number;
			readonly max: number;
			readonly step: number;
		};
		export type Graphics = ConfigType<"graphics", GraphicsConfiguration>;
		export type Visuals = ConfigType<"visuals", VisualsConfiguration>;
		export type Tutorial = ConfigType<"tutorial", TutorialConfiguration>;
		export type Environment = ConfigType<"environment", EnvironmentConfiguration>;
		export type Replication = ConfigType<"replication", ReplicationConfiguration>;
		export type Character = ConfigType<"character", CharacterConfiguration>;
		export type Plot = ConfigType<"plot", PlotConfiguration>;
		export type Audio = ConfigType<"audio", AudioConfiguration>;
		export type Sound = ConfigType<"sound", SoundConfiguration>;
		export type Interface = ConfigType<"interface", InterfaceConfiguration>;
		export type Keybinds = ConfigType<"keybinds", KeybindsConfiguration>;

		export interface Types {
			readonly bool: Bool;
			readonly number: Number;
			readonly color: Color;
			readonly key: Key;
			readonly dropdown: Dropdown;
			readonly clampedNumber: ClampedNumber;
			readonly graphics: Graphics;
			readonly visuals: Visuals;
			readonly tutorial: Tutorial;
			readonly environment: Environment;
			readonly replication: Replication;
			readonly character: Character;
			readonly plot: Plot;
			readonly audio: Audio;
			readonly sound: Sound;
			readonly keybinds: Keybinds;
			readonly interface: Interface;
		}

		export type Definitions = ConfigTypesToDefinition<keyof Types, Types>;
	}

	type PlayerConfig = ConfigDefinitionsToConfig<keyof PlayerConfigDefinition, PlayerConfigDefinition>;
	type OePlayerData = {
		readonly lastLaunchedVersion?: number;
		readonly lastJoin?: number;
		readonly lastSeenLog?: string;
		readonly warnings?: number;
	};

	type PlayerConfigDefinition = typeof PlayerConfigDefinition;
}

export const PlayerConfigDefinition = {
	replication: {
		type: "replication",
		config: {
			publicSpeakers: true as boolean,
			publicTTS: true as boolean,
			publicParticles: true as boolean,
			publicTracers: true as boolean,
			enableProjectiles: true as boolean,
			pvp: true as boolean,
		},
	},
	character: {
		type: "character",
		config: {
			sprintSpeed: 60 as number,
			jumpPower: 50 as number,
			mortality: false as boolean,
			ragdoll: {
				autoFall: true as boolean,
				triggerByKey: false as boolean,
				triggerKey: "X" as KeyCode | undefined,
				autoRecovery: true as boolean,
				autoRecoveryByMoving: true as boolean,
			},
		},
	},
	plot: {
		type: "plot",
		config: {
			autoLoad: true as boolean,
			autoPlotTeleport: true as boolean,
			autoPlotTeleportCenter: false as boolean,
		},
	},
	audio: {
		type: "audio",
		config: {
			masterVolume: 70 as number,
			muted: false as boolean,
			playMode: "SHUFFLED",
			volumes: [],
		} as AudioConfiguration,
	},
	sound: {
		type: "sound",
		config: {
			master: 100 as number,
			volumes: {},
			dopplerScale: 1 as number,
			distanceFactor: GameDefinitions.METERS_TO_STUDS as number,
			supersonicScaling: true as boolean,
			supersonicBooms: true as boolean,
		} as SoundConfiguration,
	},
	keybinds: {
		type: "keybinds",
		config: { overrides: {} } as KeybindsConfiguration,
	},
	interface: {
		type: "interface",
		config: {
			uiScale: 1 as number,
			windowPositions: {} as WindowPositionsConfiguration,
			syntaxHighlight: true as boolean,
			unequipClearSelection: false as boolean,
			searchBehaviour: {
				onSubmit: false as boolean,
				delay: 0 as number,
				resetOnSearch: true as boolean,
			},
			beacons: {
				plot: true as boolean,
				players: false as boolean,
			},
			units: {
				targetSpeed: 800 as number,
				speed: "Studs/s" as UnitsConfiguration["speed"],
				altitude: "Studs" as UnitsConfiguration["altitude"],
				position: "Studs" as UnitsConfiguration["position"],
				gravity: "Studs/s²" as UnitsConfiguration["gravity"],
			},
			graphing: {
				sampleHidden: true as boolean,
				pointSize: 3 as number,
				segmentThickness: 2 as number,
			},
		},
	},
	graphics: {
		type: "graphics",
		config: {
			localShadows: true as boolean,
			othersShadows: true as boolean,
			othersEffects: true as boolean,
			logicEffects: true as boolean,
			vaporCones: true as boolean,
			camera: {
				improved: true as boolean,
				strictFollow: false as boolean,
				playerCentered: true as boolean,
				fov: 70 as number,
			},
		},
	},
	environment: {
		type: "environment",
		config: {
			dayCycle: {
				automatic: false as boolean,
				manual: 14 as number,
			},
			physics: {
				customGravity: GameEnvironment.EarthGravity,
				advanced_aerodynamics: false as boolean,
				simplified_aerodynamics: true as boolean,
				windVelocity: Vector3.zero,
				impactDestruction: {
					enabled: true as boolean,
					blockHealthModifier: 1100 as number,
					blockMinimalDamageThreshold: 15 as number, // in percents
				},
			},
			destructibles: asObject(destructibleSpecs.mapToMap((s) => $tuple(s.id, true))),
			mapUnload: asObject(GetUnloadables().mapToMap((e) => $tuple(e.Name, true))), // i3ym
			terrain: {
				kind: "Triangle" as TerrainConfiguration["kind"],
				generator: "Default" as TerrainConfiguration["generator"],
				resolution: 8 as number,
				foliage: true as boolean,
				loadDistance: 24 as number,
				forwardLoading: false as boolean,
				culling: true as boolean,
				snowOnly: false as boolean,
				triangleAddSandBelowSeaLevel: false as boolean,
				override: {
					enabled: false as boolean,
					color: { color: new Color3(1, 1, 1), alpha: 1 },
					material: Enum.Material.Plastic.Name,
				},
				cloud: {
					auto: true,
					density: 0.5,
					cover: 0.5,
				},
				water: {
					enabled: false as boolean,
					color: { color: new Color3(0.078431375, 0.54901963, 0.6), alpha: 0.1 },
					reflectance: 0.5 as number,
					waveSize: 0.15 as number,
					waveSpeed: 20 as number,
				},
			},
		},
	},
	tutorial: {
		type: "tutorial",
		config: {
			basics: false as boolean,
		},
	},
	visuals: {
		type: "visuals",
		config: {
			selection: {
				borderColor: Color3.fromRGB(13, 105, 172),
				borderTransparency: 0,
				borderThickness: 0.05,
				surfaceColor: Color3.fromRGB(13, 105, 172),
				surfaceTransparency: 1,
			},
			multiSelection: {
				borderColor: Color3.fromRGB(0, 127, 255),
				borderTransparency: 0,
				borderThickness: 0.05,
				surfaceColor: Color3.fromRGB(0, 127, 255),
				surfaceTransparency: 1,
			},
			wires: {
				wireTransparency: 0.6,
				markerSizeMultiplier: 1,
				markerTransparency: 0.6,
				wireThicknessMultiplier: 1,
			},
			logicDebug: {
				fontSize: 14,
				textStroke: { color: Colors.white, alpha: 0 },
				boldText: true,
				AVAILATER: { color: Colors.yellow, alpha: 1 },
				GARBAGE: { color: Color3.fromHex("#964A00"), alpha: 1 },
				DISABLED: { color: Colors.red, alpha: 1 },
				nan: { color: Colors.red, alpha: 1 },
				true: { color: new Color3(0.3, 0.6, 1), alpha: 1 },
				false: { color: new Color3(0.1, 0.2, 0.65), alpha: 1 },
				numberZero: { color: Color3.fromHex("#222222"), alpha: 1 },
				numberPositive: { color: new Color3(0.5, 1, 0.5), alpha: 1 },
				numberNegative: { color: new Color3(1, 0.5, 0.5), alpha: 1 },
				colorAsColor: true,
			},
			ide: {
				background: { color: Color3.fromHex("#0d1117"), alpha: 1 },
				iden: { color: Color3.fromHex("#c9d1d9"), alpha: 1 },
				keyword: { color: Color3.fromHex("#f85149"), alpha: 1 },
				builtin: { color: Color3.fromHex("#58a6ff"), alpha: 1 },
				field: { color: Color3.fromHex("#79c0ff"), alpha: 1 },
				method: { color: Color3.fromHex("#dcdcaa"), alpha: 1 },
				string: { color: Color3.fromHex("#a5d6ff"), alpha: 1 },
				number: { color: Color3.fromHex("#58a6ff"), alpha: 1 },
				comment: { color: Color3.fromHex("#8b949e"), alpha: 1 },
				operator: { color: Color3.fromHex("#c9d1d9"), alpha: 1 },
				unknown: { color: Color3.fromHex("#ff0000"), alpha: 1 },
			},
		},
	},
} as const satisfies ConfigTypesToDefinition<keyof PlayerConfigTypes.Types, PlayerConfigTypes.Types>;
