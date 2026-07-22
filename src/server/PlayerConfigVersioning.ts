import { PlayerConfigDefinition } from "shared/config/PlayerConfig";

interface PlayerConfigVersion<TCurrent> {
	readonly version: number;
}
interface UpdatablePlayerConfigVersion<TCurrent, TPrev> extends PlayerConfigVersion<TCurrent> {
	update(prev: Partial<TPrev>): Partial<TCurrent>;
}

type PlayerConfigV1 = {
	readonly version: number;

	readonly betterCamera: boolean;
	readonly music: boolean;
	readonly beacons: boolean;
	readonly impact_destruction: boolean;
	readonly others_gfx: boolean;
	readonly dayCycle: DayCycleConfiguration;
};
const v1: PlayerConfigVersion<PlayerConfigV1> = {
	version: 1,
};

type PlayerConfigV2 = Replace<PlayerConfigV1, "beacons", BeaconsConfiguration>;
const v2: UpdatablePlayerConfigVersion<PlayerConfigV2, PlayerConfigV1> = {
	version: 2,

	update(prev: Partial<PlayerConfigV1>): Partial<PlayerConfigV2> {
		return {
			...prev,
			version: this.version,
			beacons: {
				plot: prev.beacons ?? true,
				players: false,
			},
		};
	},
};

type PlayerConfigV3 = PlayerConfigV2 & { readonly terrainFoliage: boolean };
const v3: UpdatablePlayerConfigVersion<PlayerConfigV3, PlayerConfigV2> = {
	version: 3,

	update(prev: Partial<PlayerConfigV2>): Partial<PlayerConfigV3> {
		return {
			...prev,
			version: this.version,
			terrainFoliage: true,
		};
	},
};

type PlayerConfigV4 = Replace<PlayerConfigV3, "betterCamera", CameraConfiguration>;
const v4: UpdatablePlayerConfigVersion<PlayerConfigV4, PlayerConfigV3> = {
	version: 4,

	update(prev: Partial<PlayerConfigV3>): Partial<PlayerConfigV4> {
		return {
			...prev,
			version: this.version,
			betterCamera: {
				improved: prev.betterCamera ?? true,
				strictFollow: true,
				playerCentered: false,
				fov: 70,
			},
		};
	},
};

// Added graphics config
type PlayerConfigV5 = PlayerConfigV4 & { graphics: Omit<GraphicsConfiguration, "logicEffects" | "camera"> };
const v5: UpdatablePlayerConfigVersion<PlayerConfigV5, PlayerConfigV4> = {
	version: 5,

	update(prev: Partial<PlayerConfigV4>): Partial<PlayerConfigV5> {
		return {
			...prev,
			version: this.version,
			graphics: {
				localShadows: false,
				othersShadows: false,
				othersEffects: true,
			},
		};
	},
};

// Added terrain config
type PlayerConfigV6 = PlayerConfigV5 & { terrain: Omit<TerrainConfiguration, "loadDistance" | "override"> };
const v6: UpdatablePlayerConfigVersion<PlayerConfigV6, PlayerConfigV5> = {
	version: 6,

	update(prev: Partial<PlayerConfigV5>): Partial<PlayerConfigV6> {
		return {
			...prev,
			version: this.version,
			terrain: {
				...PlayerConfigDefinition.environment.config.terrain,
				foliage: prev.terrainFoliage ?? true,
			},
		};
	},
};

// Added terrain load distance
type PlayerConfigV7 = PlayerConfigV6 & { terrain: Omit<TerrainConfiguration, "override"> };
const v7: UpdatablePlayerConfigVersion<PlayerConfigV7, PlayerConfigV6> = {
	version: 7,

	update(prev: Partial<PlayerConfigV6>): Partial<PlayerConfigV7> {
		return {
			...prev,
			version: this.version,
			terrain: {
				...PlayerConfigDefinition.environment.config.terrain,
				...prev.terrain,
			},
		};
	},
};

// Moved others_gfx to graphics
type PlayerConfigV8 = Omit<PlayerConfigV7, "others_gfx">;
const v8: UpdatablePlayerConfigVersion<PlayerConfigV8, PlayerConfigV7> = {
	version: 8,

	update(prev: Partial<PlayerConfigV7>): Partial<PlayerConfigV8> {
		return {
			...prev,
			version: this.version,
			graphics: {
				...PlayerConfigDefinition.graphics.config,
				...prev.graphics,
				othersEffects: prev.others_gfx ?? true,
			},
		};
	},
};

// Added tutorial
type PlayerConfigV9 = PlayerConfigV8 & { readonly tutorial: TutorialConfiguration };
const v9: UpdatablePlayerConfigVersion<PlayerConfigV9, PlayerConfigV8> = {
	version: 9,

	update(prev: Partial<PlayerConfigV8>): Partial<PlayerConfigV9> {
		return {
			...prev,
			version: this.version,
			tutorial: PlayerConfigDefinition.tutorial.config,
		};
	},
};

// Reset the config to fix all bugs
type PlayerConfigV10 = PlayerConfig & { readonly version: number };
const v10: UpdatablePlayerConfigVersion<PlayerConfigV10, PlayerConfigV9> = {
	version: 10,

	update(prev: Partial<PlayerConfigV9>): Partial<PlayerConfigV10> {
		return {
			version: this.version,
		};
	},
};

// [DISABLED] Set terrain to snow for the winter
const v11: UpdatablePlayerConfigVersion<PlayerConfigV10, PlayerConfigV10> = {
	version: 11,

	update(prev: Partial<PlayerConfigV10>): Partial<PlayerConfigV10> {
		return {
			...prev,
			version: this.version,
		};
	},
};

// Add material, color setting for terrain
type PlayerConfigV11 = PlayerConfigV10 & { terrain: TerrainConfiguration };
const v12: UpdatablePlayerConfigVersion<PlayerConfigV10, PlayerConfigV11> = {
	version: 12,

	update(prev: Partial<PlayerConfigV10>): Partial<PlayerConfigV11> {
		return {
			...prev,
			terrain: {
				...PlayerConfigDefinition.environment.config.terrain,
				...((prev as { readonly terrain?: TerrainConfiguration }).terrain ?? {}),
			},
			version: this.version,
		};
	},
};

// Add stomehihng
type PlayerConfigV12 = PlayerConfigV10 & { graphics: GraphicsConfiguration };
const v13: UpdatablePlayerConfigVersion<PlayerConfigV11, PlayerConfigV12> = {
	version: 13,

	update(prev: Partial<PlayerConfigV11>): Partial<PlayerConfigV12> {
		return {
			...prev,
			graphics: {
				...PlayerConfigDefinition.graphics.config,
				...(prev.graphics ?? {}),
			},
			version: this.version,
		};
	},
};

// Add autoPlotTeleport
type PlayerConfigV13 = PlayerConfigV12 & { autoPlotTeleport: boolean };
const v14: UpdatablePlayerConfigVersion<PlayerConfigV12, PlayerConfigV13> = {
	version: 14,

	update(prev: Partial<PlayerConfigV12>): Partial<PlayerConfigV13> {
		return {
			autoPlotTeleport: PlayerConfigDefinition.plot.config.autoPlotTeleport,
			...prev,
			version: this.version,
		};
	},
};

// Add autoPlotTeleport
type PlayerConfigV14 = PlayerConfigV13 & { music: number };
const v15: UpdatablePlayerConfigVersion<PlayerConfigV13, PlayerConfigV14> = {
	version: 15,

	update(prev: Partial<PlayerConfigV13>): Partial<PlayerConfigV14> {
		return {
			...prev,
			music: (prev as { readonly music?: boolean }).music ? 70 : 0,
			version: this.version,
		};
	},
};

// Add publicSpeakers
type PlayerConfigV15 = PlayerConfigV14 & { publicSpeakers: boolean };
const v16: UpdatablePlayerConfigVersion<PlayerConfigV14, PlayerConfigV14> = {
	version: 16,

	update(prev: Partial<PlayerConfigV14>): Partial<PlayerConfigV15> {
		return {
			...prev,
			publicSpeakers: false,
			version: this.version,
		};
	},
};

// Add autoPlotTeleport
type PlayerConfigV16 = PlayerConfigV15 & { publicParticles: boolean };
const v17: UpdatablePlayerConfigVersion<PlayerConfigV15, PlayerConfigV15> = {
	version: 17,

	update(prev: Partial<PlayerConfigV15>): Partial<PlayerConfigV16> {
		return {
			...prev,
			publicParticles: true,
			version: this.version,
		};
	},
};

// Add publicTracers
type PlayerConfigV17 = PlayerConfigV16 & { publicTracers: boolean };
const v18: UpdatablePlayerConfigVersion<PlayerConfigV16, PlayerConfigV16> = {
	version: 18,
	update(prev: Partial<PlayerConfigV16>): Partial<PlayerConfigV17> {
		return {
			...prev,
			publicTracers: true,
			version: this.version,
		};
	},
};

// Add units config to interface
type PlayerConfigV18 = PlayerConfigV17 & {
	units: {
		targetSpeed: number;
		speed: UnitsConfiguration["speed"];
		altitude: UnitsConfiguration["altitude"];
		position: UnitsConfiguration["position"];
		gravity: UnitsConfiguration["gravity"];
	};
};
const v19: UpdatablePlayerConfigVersion<PlayerConfigV17, PlayerConfigV17> = {
	version: 19,

	update(prev: Partial<PlayerConfigV17>): Partial<PlayerConfigV18> {
		return {
			...prev,
			units: {
				targetSpeed: 800,
				speed: "Studs/s" as UnitsConfiguration["speed"],
				altitude: "Studs" as UnitsConfiguration["altitude"],
				position: "Studs" as UnitsConfiguration["position"],
				gravity: "Studs/s²" as UnitsConfiguration["gravity"],
			},
			version: this.version,
		};
	},
};

// Add playlist config (play mode + per-track volumes)
type PlayerConfigV19 = PlayerConfigV18 & {
	playlist: { readonly playMode: "SHUFFLED" | "ORDERED" | "LOOPED"; readonly volumes: readonly MusicTrackVolume[] };
};
const v20: UpdatablePlayerConfigVersion<PlayerConfigV18, PlayerConfigV18> = {
	version: 20,

	update(prev: Partial<PlayerConfigV18>): Partial<PlayerConfigV19> {
		return {
			...prev,
			playlist: {
				playMode: PlayerConfigDefinition.audio.config.playMode,
				volumes: PlayerConfigDefinition.audio.config.volumes,
			},
			version: this.version,
		};
	},
};

// Add pvp toggle
type PlayerConfigV20 = PlayerConfigV19 & { pvp: boolean };
const v21: UpdatablePlayerConfigVersion<PlayerConfigV19, PlayerConfigV19> = {
	version: 21,

	update(prev: Partial<PlayerConfigV19>): Partial<PlayerConfigV20> {
		return {
			...prev,
			pvp: PlayerConfigDefinition.replication.config.pvp,
			version: this.version,
		};
	},
};

// Adds publicTTS
type PlayerConfigV21 = PlayerConfigV20 & { publicTTS: boolean };
const v22: UpdatablePlayerConfigVersion<PlayerConfigV20, PlayerConfigV20> = {
	version: 22,

	update(prev: Partial<PlayerConfigV20>): Partial<PlayerConfigV21> {
		return {
			...prev,
			publicTTS: true,
			version: this.version,
		};
	},
};

// Coerce music to a number — early saves stored it as a bool, which crashes the volume math (x / 100).
const v23: UpdatablePlayerConfigVersion<PlayerConfigV21, PlayerConfigV21> = {
	version: 23,

	update(prev: Partial<PlayerConfigV21>): Partial<PlayerConfigV21> {
		const music = prev.music as unknown;
		return {
			...prev,
			music: typeIs(music, "number") ? music : music === true ? 70 : 0,
			version: this.version,
		};
	},
};

// Add projectile visibility toggle
type PlayerConfigV24 = PlayerConfigV21 & { enableProjectiles: boolean };
const v24: UpdatablePlayerConfigVersion<PlayerConfigV21, PlayerConfigV21> = {
	version: 24,

	update(prev: Partial<PlayerConfigV21>): Partial<PlayerConfigV24> {
		return {
			...prev,
			enableProjectiles: PlayerConfigDefinition.replication.config.enableProjectiles,
			version: this.version,
		};
	},
};

// Terrain shape is now chosen separately from how it is rendered
type PlayerConfigV25 = PlayerConfigV21 & { readonly terrain: TerrainConfiguration & { readonly generator: string } };
const v25: UpdatablePlayerConfigVersion<PlayerConfigV25, PlayerConfigV21> = {
	version: 25,

	update(prev: Partial<PlayerConfigV21>): Partial<PlayerConfigV25> {
		return {
			...prev,
			terrain: {
				...(prev as { readonly terrain?: TerrainConfiguration }).terrain!,
				generator: PlayerConfigDefinition.environment.config.terrain.generator,
			},
			version: this.version,
		};
	},
};

// Grouped the flat top-level keys into nested groups, folded playlist+music into `audio`, renamed betterCamera -> camera
type PlayerConfigV26Prev = PlayerConfigV25 & {
	readonly publicSpeakers?: boolean;
	readonly publicTTS?: boolean;
	readonly publicParticles?: boolean;
	readonly publicTracers?: boolean;
	readonly enableProjectiles?: boolean;
	readonly pvp?: boolean;
	readonly sprintSpeed?: number;
	readonly jumpPower?: number;
	readonly autoLoad?: boolean;
	readonly autoPlotTeleport?: boolean;
	readonly autoPlotTeleportCenter?: boolean;
	readonly blockHealthModifier?: number;
	readonly blockMinimalDamageThreshold?: number;
	readonly music?: number;
	readonly mutedMusic?: boolean;
	readonly playlist?: {
		readonly playMode: "SHUFFLED" | "ORDERED" | "LOOPED";
		readonly volumes: readonly MusicTrackVolume[];
	};
	readonly uiScale?: number;
	readonly syntaxHighlight?: boolean;
	readonly betterCamera?: CameraConfiguration;
	readonly ragdoll?: RagdollConfiguration;
	readonly impact_destruction?: boolean;
	readonly searchBehaviour?: SearchBehaviourConfiguration;
	readonly beacons?: BeaconsConfiguration;
	readonly units?: UnitsConfiguration;
	readonly graphics?: GraphicsConfiguration;
	readonly dayCycle?: DayCycleConfiguration;
	readonly mapUnload?: MapUnloadConfiguration;
	readonly physics?: PhysicsConfiguration;
};
type PlayerConfigV26 = PlayerConfig & { readonly version: number };
const v26: UpdatablePlayerConfigVersion<PlayerConfigV26, PlayerConfigV26Prev> = {
	version: 26,

	update(prev: Partial<PlayerConfigV26Prev>): Partial<PlayerConfigV26> {
		const d = PlayerConfigDefinition;
		return {
			...prev,
			version: this.version,
			replication: {
				publicSpeakers: prev.publicSpeakers ?? d.replication.config.publicSpeakers,
				publicTTS: prev.publicTTS ?? d.replication.config.publicTTS,
				publicParticles: prev.publicParticles ?? d.replication.config.publicParticles,
				publicTracers: prev.publicTracers ?? d.replication.config.publicTracers,
				enableProjectiles: prev.enableProjectiles ?? d.replication.config.enableProjectiles,
				pvp: prev.pvp ?? d.replication.config.pvp,
			},
			character: {
				sprintSpeed: prev.sprintSpeed ?? d.character.config.sprintSpeed,
				jumpPower: prev.jumpPower ?? d.character.config.jumpPower,
				ragdoll: prev.ragdoll ?? d.character.config.ragdoll,
			},
			plot: {
				autoLoad: prev.autoLoad ?? d.plot.config.autoLoad,
				autoPlotTeleport: prev.autoPlotTeleport ?? d.plot.config.autoPlotTeleport,
				autoPlotTeleportCenter: prev.autoPlotTeleportCenter ?? d.plot.config.autoPlotTeleportCenter,
			},
			audio: {
				masterVolume: prev.music ?? d.audio.config.masterVolume,
				muted: prev.mutedMusic ?? d.audio.config.muted,
				playMode: prev.playlist?.playMode ?? d.audio.config.playMode,
				volumes: prev.playlist?.volumes ?? d.audio.config.volumes,
			},
			interface: {
				uiScale: prev.uiScale ?? d.interface.config.uiScale,
				syntaxHighlight: prev.syntaxHighlight ?? d.interface.config.syntaxHighlight,
				searchBehaviour: prev.searchBehaviour ?? d.interface.config.searchBehaviour,
				beacons: prev.beacons ?? d.interface.config.beacons,
				units: prev.units ?? d.interface.config.units,
			},
			graphics: {
				...d.graphics.config,
				...prev.graphics,
				camera: prev.betterCamera ?? d.graphics.config.camera,
			},
			environment: {
				dayCycle: prev.dayCycle ?? d.environment.config.dayCycle,
				mapUnload: prev.mapUnload ?? d.environment.config.mapUnload,
				terrain: (prev.terrain ?? d.environment.config.terrain) as typeof d.environment.config.terrain,
				physics: {
					...(prev.physics ?? d.environment.config.physics),
					impactDestruction: {
						blockHealthModifier:
							prev.blockHealthModifier ??
							d.environment.config.physics.impactDestruction.blockHealthModifier,
						blockMinimalDamageThreshold:
							prev.blockMinimalDamageThreshold ??
							d.environment.config.physics.impactDestruction.blockMinimalDamageThreshold,
						enabled: prev.impact_destruction ?? d.environment.config.physics.impactDestruction.enabled,
					},
				},
			},
		};
	},
};

// Group the water enable toggle + color under terrain.water, alongside the new wave size/speed
type PlayerConfigV27 = PlayerConfig & { readonly version: number };
const v27: UpdatablePlayerConfigVersion<PlayerConfigV27, PlayerConfigV26> = {
	version: 27,

	update(prev: Partial<PlayerConfigV26>): Partial<PlayerConfigV27> {
		const dwater = PlayerConfigDefinition.environment.config.terrain.water;
		const terrain = (prev.environment?.terrain ?? {}) as unknown as {
			readonly water?: boolean;
			readonly waterColor?: typeof dwater.color;
		};
		return {
			...prev,
			version: this.version,
			environment: {
				...prev.environment!,
				terrain: {
					...prev.environment!.terrain,
					water: {
						enabled: terrain.water ?? dwater.enabled,
						// alpha was unused before; set it to the Workspace default transparency, keep the chosen color
						color: { color: (terrain.waterColor ?? dwater.color).color, alpha: dwater.color.alpha },
						reflectance: dwater.reflectance,
						waveSize: dwater.waveSize,
						waveSpeed: dwater.waveSpeed,
					},
				},
			},
		} as Partial<PlayerConfigV27>;
	},
};

// water.reflectance was added to the group after v27, so saves already at v27 lack it, and addDefaults does not
// reach a field three levels deep (environment.terrain.water.reflectance) — back-fill it here. Idempotent.
type PlayerConfigV28 = PlayerConfig & { readonly version: number };
const v28: UpdatablePlayerConfigVersion<PlayerConfigV28, PlayerConfigV27> = {
	version: 28,

	update(prev: Partial<PlayerConfigV27>): Partial<PlayerConfigV28> {
		const water = prev.environment?.terrain?.water;
		if (!water) return { ...prev, version: this.version };

		return {
			...prev,
			version: this.version,
			environment: {
				...prev.environment!,
				terrain: {
					...prev.environment!.terrain,
					water: {
						...water,
						reflectance:
							water.reflectance ?? PlayerConfigDefinition.environment.config.terrain.water.reflectance,
					},
				},
			},
		};
	},
};

const versions = [
	...([v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15] as const),
	...([v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28] as const),
] as const;
const current = versions[versions.size() - 1] as typeof versions extends readonly [...unknown[], infer T] ? T : never;

export namespace PlayerConfigUpdater {
	export function update(config: object | { readonly version: number }) {
		if (!("version" in config)) {
			config = {
				...config,
				version: v10.version,
			};
		}

		const version = "version" in config ? config.version : v10.version;
		for (let i = version + 1; i <= current.version; i++) {
			const newver = versions.find((v) => v.version === i);
			if (!newver || !("update" in newver)) continue;

			$log(`Updating player config to v${newver.version}`);
			config = newver.update(config as never);
		}

		return config as ReturnType<(typeof current)["update"]>;
	}
}
