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
type PlayerConfigV5 = PlayerConfigV4 & { graphics: Omit<GraphicsConfiguration, "logicEffects"> };
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
				...PlayerConfigDefinition.terrain.config,
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
				...PlayerConfigDefinition.terrain.config,
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
				...PlayerConfigDefinition.terrain.config,
				...(prev.terrain ?? {}),
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
			autoPlotTeleport: PlayerConfigDefinition.autoPlotTeleport.config,
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
			music: prev.music ? 70 : 0,
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
	playlist: PlaylistConfiguration;
};
const v20: UpdatablePlayerConfigVersion<PlayerConfigV18, PlayerConfigV18> = {
	version: 20,

	update(prev: Partial<PlayerConfigV18>): Partial<PlayerConfigV19> {
		return {
			...prev,
			playlist: PlayerConfigDefinition.playlist.config,
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
			pvp: PlayerConfigDefinition.pvp.config,
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

const versions = [
	v1,
	v2,
	v3,
	v4,
	v5,
	v6,
	v7,
	v8,
	v9,
	v10,
	v11,
	v12,
	v13,
	v14,
	v15,
	v16,
	v17,
	v18,
	v19,
	v20,
	v21,
	v22,
	v23,
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
