import { Colors } from "shared/Colors";
import { GameEnvironment } from "shared/data/GameEnvironment";
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
	};
	type SearchBehaviourConfiguration = {
		readonly onSubmit: boolean;
		readonly delay: number;
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
	type TerrainConfiguration = {
		readonly kind: "Classic" | "Triangle" | "Flat" | "Water" | "Lava" | "Void";
		/** What shapes the land. `kind` above picks how it is DRAWN; this picks what is drawn. */
		readonly generator: "Default" | "Realistic";
		readonly resolution: number;
		readonly foliage: boolean;
		readonly loadDistance: number;
		readonly water: boolean;
		readonly snowOnly: boolean;
		readonly override?: {
			readonly enabled: boolean;
			readonly material: Enum.Material["Name"];
			readonly color: Color4;
		};
		readonly waterColor: Color4;
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
	};
	type MusicTrackVolume = {
		readonly assetID: string;
		readonly volume: number;
		readonly isMuted?: boolean;
	};
	type PlaylistConfiguration = {
		readonly playMode: "SHUFFLED" | "ORDERED" | "LOOPED";
		readonly volumes: readonly MusicTrackVolume[];
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
		export type DayCycle = ConfigType<"dayCycle", DayCycleConfiguration>;
		export type Beacons = ConfigType<"beacons", BeaconsConfiguration>;
		export type Camera = ConfigType<"camera", CameraConfiguration>;
		export type Graphics = ConfigType<"graphics", GraphicsConfiguration>;
		export type Visuals = ConfigType<"visuals", VisualsConfiguration>;
		export type SearchBehaviour = ConfigType<"searchBehaviour", SearchBehaviourConfiguration>;
		export type Units = ConfigType<"units", UnitsConfiguration>;
		export type MapUnload = ConfigType<"mapUnload", MapUnloadConfiguration>;
		export type Terrain = ConfigType<"terrain", TerrainConfiguration>;
		export type Tutorial = ConfigType<"tutorial", TutorialConfiguration>;
		export type Ragdoll = ConfigType<"ragdoll", RagdollConfiguration>;
		export type Physics = ConfigType<"physics", PhysicsConfiguration>;
		export type Playlist = ConfigType<"playlist", PlaylistConfiguration>;

		export interface Types {
			readonly bool: Bool;
			readonly number: Number;
			readonly color: Color;
			readonly key: Key;
			readonly dropdown: Dropdown;
			readonly clampedNumber: ClampedNumber;
			readonly dayCycle: DayCycle;
			readonly beacons: Beacons;
			readonly camera: Camera;
			readonly graphics: Graphics;
			readonly visuals: Visuals;
			readonly searchBehaviour: SearchBehaviour;
			readonly units: Units;
			readonly mapUnload: MapUnload;
			readonly terrain: Terrain;
			readonly tutorial: Tutorial;
			readonly ragdoll: Ragdoll;
			readonly physics: Physics;
			readonly playlist: Playlist;
		}

		export type Definitions = ConfigTypesToDefinition<keyof Types, Types>;
	}

	type PlayerConfig = ConfigDefinitionsToConfig<keyof PlayerConfigDefinition, PlayerConfigDefinition>;
	type OePlayerData = {
		readonly lastLaunchedVersion?: number;
		readonly lastJoin?: number;
		readonly warnings?: number;
	};

	type PlayerConfigDefinition = typeof PlayerConfigDefinition;
}

export const PlayerConfigDefinition = {
	autoLoad: {
		type: "bool",
		config: true as boolean,
	},
	publicSpeakers: {
		type: "bool",
		config: true as boolean,
	},
	publicTTS: {
		type: "bool",
		config: true as boolean,
	},
	publicParticles: {
		type: "bool",
		config: true as boolean,
	},
	publicTracers: {
		type: "bool",
		config: true as boolean,
	},
	enableProjectiles: {
		type: "bool",
		config: true as boolean,
	},
	pvp: {
		type: "bool",
		config: true as boolean,
	},
	autoPlotTeleport: {
		type: "bool",
		config: true as boolean,
	},
	autoPlotTeleportCenter: {
		type: "bool",
		config: false as boolean,
	},
	searchBehaviour: {
		type: "searchBehaviour",
		config: {
			onSubmit: false as boolean,
			delay: 0,
		},
	},
	sprintSpeed: {
		type: "clampedNumber",
		min: 20,
		max: 1000,
		config: 60 as number,
		step: 0.01,
	},
	jumpPower: {
		type: "clampedNumber",
		min: 0,
		max: 200,
		config: 50 as number,
		step: 0.01,
	},
	betterCamera: {
		type: "camera",
		config: {
			improved: true as boolean,
			strictFollow: false as boolean,
			playerCentered: true as boolean,
			fov: 70 as number,
		},
	},
	graphics: {
		type: "graphics",
		config: {
			localShadows: true as boolean,
			othersShadows: true as boolean,
			othersEffects: true as boolean,
			logicEffects: true as boolean,
		},
	},
	music: {
		type: "clampedNumber",
		min: 0,
		max: 100,
		config: 70 as number,
		step: 1,
	},
	mutedMusic: {
		type: "bool",
		config: false as boolean,
	},
	playlist: {
		type: "playlist",
		config: {
			playMode: "SHUFFLED",
			volumes: [],
		} as PlaylistConfiguration,
	},
	beacons: {
		type: "beacons",
		config: {
			plot: true as boolean,
			players: false as boolean,
		},
	},
	impact_destruction: {
		type: "bool",
		config: true as boolean,
	},
	blockHealthModifier: {
		type: "number",
		config: 1100,
	},
	blockMinimalDamageThreshold: {
		type: "number",
		config: 15, // in percents
	},

	dayCycle: {
		type: "dayCycle",
		config: {
			automatic: false as boolean,
			/** Hours, 0-24 */
			manual: 14 as number,
		},
	},
	uiScale: {
		type: "clampedNumber",
		config: 1 as number,
		min: 0.5,
		max: 1.5,
		step: 0.01,
	},
	units: {
		type: "units",
		config: {
			targetSpeed: 800,
			speed: "Studs/s" as UnitsConfiguration["speed"],
			altitude: "Studs" as UnitsConfiguration["altitude"],
			position: "Studs" as UnitsConfiguration["position"],
			gravity: "Studs/s²" as UnitsConfiguration["gravity"],
		},
	},
	mapUnload: {
		type: "mapUnload",
		config: asObject(GetUnloadables().mapToMap((e) => $tuple(e.Name, true))), // i3ym
	},
	terrain: {
		type: "terrain",
		config: {
			kind: "Triangle" as TerrainConfiguration["kind"],
			generator: "Default" as TerrainConfiguration["generator"],
			resolution: 8 as number,
			foliage: true as boolean,
			loadDistance: 24 as number,
			water: false as boolean,
			snowOnly: false as boolean,
			triangleAddSandBelowSeaLevel: false as boolean,
			override: {
				enabled: false as boolean,
				color: { color: new Color3(1, 1, 1), alpha: 1 },
				material: Enum.Material.Plastic.Name,
			},
			waterColor: { color: new Color3(0.078431375, 0.54901963, 0.6), alpha: 1 },
		},
	},
	tutorial: {
		type: "tutorial",
		config: {
			basics: false as boolean,
		},
	},
	ragdoll: {
		type: "ragdoll",
		config: {
			autoFall: true as boolean,
			triggerByKey: false as boolean,
			triggerKey: "X" as KeyCode | undefined,
			autoRecovery: true as boolean,
			autoRecoveryByMoving: true as boolean,
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
	physics: {
		type: "physics",
		config: {
			customGravity: GameEnvironment.EarthGravity,
			advanced_aerodynamics: false as boolean,
			simplified_aerodynamics: true as boolean,
			windVelocity: Vector3.zero,
		},
	},
	syntaxHighlight: {
		type: "bool",
		config: true as boolean,
	},
} as const satisfies ConfigTypesToDefinition<keyof PlayerConfigTypes.Types, PlayerConfigTypes.Types>;
