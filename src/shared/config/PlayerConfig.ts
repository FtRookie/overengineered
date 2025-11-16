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
	type VisualsConfiguration = {
		readonly selection: VisualsSelectionBox;
		readonly multiSelection: VisualsSelectionBox;
		readonly wires: WireSelectionConfig;
	};

	type TerrainConfiguration = {
		readonly kind: "Classic" | "Triangle" | "Flat" | "Water" | "Lava" | "Void";
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
		readonly simplified_aerodynamics: boolean;
		readonly advanced_aerodynamics: boolean;
		readonly windVelocity: Vector3;
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
		export type Terrain = ConfigType<"terrain", TerrainConfiguration>;
		export type Tutorial = ConfigType<"tutorial", TutorialConfiguration>;
		export type Ragdoll = ConfigType<"ragdoll", RagdollConfiguration>;
		export type Physics = ConfigType<"physics", PhysicsConfiguration>;

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
			readonly terrain: Terrain;
			readonly tutorial: Tutorial;
			readonly ragdoll: Ragdoll;
			readonly physics: Physics;
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
		config: false as boolean,
	},
	publicParticles: {
		type: "bool",
		config: true as boolean,
	},
	autoPlotTeleport: {
		type: "bool",
		config: true as boolean,
	},
	sprintSpeed: {
		type: "clampedNumber",
		min: 20,
		max: 200,
		config: 60 as number,
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
	terrain: {
		type: "terrain",
		config: {
			kind: "Triangle" as TerrainConfiguration["kind"],
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
		},
	},
	physics: {
		type: "physics",
		config: {
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
