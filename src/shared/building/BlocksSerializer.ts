import { JSON } from "engine/shared/fixes/Json";
import { Objects } from "engine/shared/fixes/Objects";
import { BlockWireManager } from "shared/blockLogic/BlockWireManager";
import { _BlockConfigRegistrySave } from "shared/building/BlockConfigRegistrySave";
import { BlockManager } from "shared/building/BlockManager";
import { Config } from "shared/config/Config";
import { Serializer } from "shared/Serializer";
import type { BlockConfigPart, PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockConfigRegistry } from "shared/building/BlockConfigRegistrySave";
import type { BuildingPlot } from "shared/building/BuildingPlot";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";

const blockConfigRegistry = _BlockConfigRegistrySave as BlockConfigRegistry;
type blockConfigRegistry = typeof _BlockConfigRegistrySave;

namespace V1 {
	export type PlacedBlockConfig = {
		readonly [k in string]: unknown;
	};

	/** Connections to the INPUT connectors */
	export type PlacedBlockLogicConnections = {
		readonly [k in BlockConnectionName]: PlacedBlockDataConnection;
	};
	export type PlacedBlockDataConnection = {
		/** OUTPUT block uiid */
		readonly blockUuid: BlockUuid;
		/** OUTPUT connector name */
		readonly connectionName: BlockConnectionName;
	};
}

type SerializedBlocks<TBlocks extends SerializedBlockBase> = {
	readonly version: number;
	readonly blocks: readonly TBlocks[];
	/** Wall-clock ms the build was serialized for saving. Absent on legacy saves — treat those as oldest. */
	readonly savedAt?: number;
};

interface SerializedBlockBase {
	readonly id: BlockId;
}
interface SerializedBlockV0 extends SerializedBlockBase {
	readonly location: CFrame;
	readonly material?: Enum.Material | undefined;
	readonly color?: Color3 | undefined;
	readonly config?: V1.PlacedBlockConfig | undefined;
}
interface SerializedBlockV2 extends SerializedBlockV0 {
	readonly uuid: BlockUuid;
}
interface SerializedBlockV3 extends SerializedBlockV2 {
	/** @deprecated Do not use; was deleted */
	readonly connections?: V1.PlacedBlockLogicConnections | undefined;
}
interface SerializedBlockV4 extends ReplaceWith<
	SerializedBlockV3,
	{ readonly config?: PlacedBlockConfig | undefined }
> {}
interface SerializedBlockV5 extends ReplaceWith<SerializedBlockV4, { readonly scale?: Vector3 | undefined }> {}
interface SerializedBlockV6 extends ReplaceWith<
	SerializedBlockV5,
	{ readonly customData?: PlacedBlockData["customData"] | undefined }
> {}
interface SerializedBlockV7 extends ReplaceWith<SerializedBlockV6, { readonly color?: Color4 | undefined }> {
	readonly welds?: BlockWelds;
	readonly collidable?: boolean;
}

export type LatestSerializedBlock = SerializedBlockV7;
export type LatestSerializedBlocks = SerializedBlocks<LatestSerializedBlock>;

namespace Filter {
	const white = Color3.fromRGB(255, 255, 255);
	const plastic = Enum.Material.Plastic;

	export function deleteDefaultValues(block: Writable<ReplaceWith<LatestSerializedBlock, { config?: {} }>>) {
		if (block.color?.color === white && block.color.alpha === 1) {
			delete block.color;
		}
		if (block.material === plastic) {
			delete block.material;
		}
		if (block.config && Objects.size(block.config) === 0) {
			delete block.config;
		}
		if (block.connections && Objects.size(block.connections) === 0) {
			delete block.connections;
		}
	}

	export function cleanup(blocks: Map<BlockUuid, Writable<LatestSerializedBlock>>) {
		for (const [, v] of blocks) {
			if (!v.welds) continue;

			const weldCopy: BlockWeld[] = [];
			for (const weld of v.welds) {
				if (weld.welded) {
					continue;
				}
				if (!blocks.has(weld.otherUuid)) {
					continue;
				}

				weldCopy.push(weld);
			}

			v.welds = weldCopy;
		}
	}
}

const read = {
	blockV3: (block: BlockModel, buildingCenter: CFrame): LatestSerializedBlock => {
		const data: LatestSerializedBlock = {
			...BlockManager.getBlockDataByBlockModel(block),
			location: buildingCenter.ToObjectSpace(block.GetPivot()),
			["instance" as never]: undefined,
		};
		Filter.deleteDefaultValues(data);

		return data;
	},
} as const;
const place = {
	blocksOnPlot: (plot: BuildingPlot, data: readonly LatestSerializedBlock[]) => {
		const deserializedData = data.map((blockData) =>
			BlocksSerializer.serializedBlockToPlaceRequest(blockData, plot.origin),
		);

		const response = plot.multiPlaceOperation.execute(deserializedData);
		if (!response.success) {
			$err(`Could not place blocks: ${response.message}`);
		}
	},
} as const;

interface BlockSerializer<TBlocks extends SerializedBlocks<SerializedBlockBase>> {
	readonly version: number;
}
interface UpgradableBlocksSerializer<
	TBlocks extends SerializedBlocks<SerializedBlockBase>,
	TPrev extends BlockSerializer<SerializedBlocks<SerializedBlockBase>>,
> extends BlockSerializer<TBlocks> {
	upgradeFrom(prev: TPrev extends BlockSerializer<infer T> ? T : never, blockList: BlockList): TBlocks;
}

//

const v4: BlockSerializer<SerializedBlocks<SerializedBlockV0>> = {
	version: 4,
};

// added uuid
const v5: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV2>, typeof v4> = {
	version: 5,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV0>): SerializedBlocks<SerializedBlockV2> {
		return {
			version: this.version,
			blocks: prev.blocks.map((b, i): SerializedBlockV2 => ({
				...b,
				uuid: tostring(i) as BlockUuid,
			})),
		};
	},
};

// added logic connecitons
const v6: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v5> = {
	version: 6,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV2>): SerializedBlocks<SerializedBlockV3> {
		return {
			version: this.version,
			blocks: prev.blocks.map((b, i): SerializedBlockV3 => ({
				...b,
				connections: {},
			})),
		};
	},
};

// changed serialization to actual JSON
const v7: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v6> = {
	version: 7,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		return {
			version: this.version,
			blocks: prev.blocks.map((b): SerializedBlockV3 => ({
				...b,
				config:
					b.config === undefined
						? undefined
						: Objects.fromEntries(
								Objects.entriesArray(b.config).map(
									(e) => [e[0], e[1] === "Y" ? true : e[1] === "N" ? false : e[1]] as const,
								),
							),
			})),
		};
	},
};

// updated block config layout
const v8: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v7> = {
	version: 8,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		type reg = blockConfigRegistry;
		type partial<T extends object> = {
			readonly [k in keyof T]?: T[k] extends object ? partial<T[k]> : T[k];
		};

		const update = (block: SerializedBlockV3) => {
			if (block.id === "servomotorblock") {
				type config = partial<{
					readonly [k in keyof reg["servomotorblock"]["input"]]: reg["servomotorblock"]["input"][k]["config"];
				}>;

				const cfg = block.config as
					| {
							speed?: number;
							rotate_add?: KeyCode;
							rotate_sub?: KeyCode;
							switch?: boolean;
							angle?: number;
					  }
					| undefined;

				const config: object = {
					speed: cfg?.speed,
					angle: {
						rotate_add: cfg?.rotate_add,
						rotate_sub: cfg?.rotate_sub,
						switchmode: cfg?.switch,
						angle: cfg?.angle,
					},
				};

				return config;
			}
			if (block.id === "smallrocketengine" || block.id === "rocketengine") {
				type config = partial<{
					readonly [k in keyof reg["rocketengine"]["input"]]: reg["rocketengine"]["input"][k]["config"];
				}>;

				const cfg = block.config as
					| {
							thrust_add?: KeyCode;
							thrust_sub?: KeyCode;
							switchmode?: boolean;
							strength?: number;
					  }
					| undefined;

				const config: config = {
					thrust: {
						thrust: {
							add: cfg?.thrust_add ?? "W",
							sub: cfg?.thrust_sub ?? "S",
						},
						switchmode: cfg?.switchmode,
					},
				};

				return config;
			}
			if (block.id === "motorblock") {
				type config = partial<{
					readonly [k in keyof reg["motorblock"]["input"]]: reg["motorblock"]["input"][k]["config"];
				}>;

				const cfg = block.config as
					| {
							speed?: number;
							rotate_add?: KeyCode;
							rotate_sub?: KeyCode;
							switch?: boolean;
					  }
					| undefined;

				const config: object = {
					rotationSpeed: {
						rotate_add: cfg?.rotate_add,
						rotate_sub: cfg?.rotate_sub,
						switchmode: cfg?.switch,
						speed: cfg?.speed,
					},
				};

				return config;
			}
			if (block.id === "disconnectblock") {
				type disconnect = {
					input: {
						disconnect: {
							displayName: "Disconnect key";
							type: "keybool";
							default: boolean;
							config: {
								key: KeyCode;
								switch: boolean;
								reversed: boolean;
							};
							canBeSwitch: false;
							canBeReversed: false;
						};
					};
					output: {};
				};
				type config = partial<{
					readonly [k in keyof disconnect["input"]]: disconnect["input"][k]["config"];
				}>;

				const cfg = block.config as
					| {
							disconnect?: KeyCode;
					  }
					| undefined;

				const config: config = {
					disconnect: {
						key: cfg?.disconnect,
					},
				};

				return config;
			}
			if (block.id === "tnt") {
				type config = partial<{
					readonly [k in keyof reg["tnt"]["input"]]: reg["tnt"]["input"][k]["config"];
				}>;

				const cfg = block.config as
					| {
							explode?: KeyCode;
							radius?: number;
							pressure?: number;
							flammable?: boolean;
							impact?: boolean;
					  }
					| undefined;

				const config: config = {
					explode: {
						key: cfg?.explode,
					},
					flammable: cfg?.flammable,
					radius: cfg?.radius,
					impact: cfg?.impact,
					pressure: cfg?.pressure,
				};

				return config;
			}

			return block.config;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map((b): SerializedBlockV3 => ({
				...b,
				config: update(b) as never,
			})),
		};
	},
};

// updated block config layout
const v9: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v8> = {
	version: 9,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		type reg = blockConfigRegistry;
		type partial<T extends object> = {
			readonly [k in keyof T]?: T[k] extends object ? partial<T[k]> : T[k];
		};

		const update = (block: SerializedBlockV3) => {
			if (block.id === "motorblock") {
				type config = partial<{
					readonly [k in keyof reg["motorblock"]["input"]]: reg["motorblock"]["input"][k]["config"];
				}>;

				const cfg = block.config as
					| {
							rotationSpeed: {
								rotate_add?: KeyCode;
								rotate_sub?: KeyCode;
								switchmode?: boolean;
								speed?: number;
							};
					  }
					| undefined;

				const config: config = {
					rotationSpeed: {
						rotation: {
							add: cfg?.rotationSpeed.rotate_add,
							sub: cfg?.rotationSpeed.rotate_sub,
						},
						switchmode: cfg?.rotationSpeed.switchmode,
						speed: cfg?.rotationSpeed.speed,
					},
				};

				return config;
			}
			if (block.id === "servomotorblock") {
				type config = partial<{
					readonly [k in keyof reg["servomotorblock"]["input"]]: reg["servomotorblock"]["input"][k]["config"];
				}>;

				const cfg = block.config as
					| {
							speed: number;
							angle: {
								speed?: number;
								rotate_add?: KeyCode;
								rotate_sub?: KeyCode;
								switchmode?: boolean;
								angle?: number;
							};
					  }
					| undefined;

				const config: config = {
					speed: cfg?.speed,
					angle: {
						rotation: {
							add: cfg?.angle.rotate_add,
							sub: cfg?.angle.rotate_sub,
						},
						switchmode: cfg?.angle.switchmode,
						angle: cfg?.angle.angle,
					},
				};

				return config;
			}

			return block.config;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map((b): SerializedBlockV3 => ({
				...b,
				config: update(b),
			})),
		};
	},
};

// fix blocks not aligned with the grid (disabled due to v11 doing the same again)
const v10: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v9> = {
	version: 10,
	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		return prev;
	},
};

// fix blocks not aligned with the grid
const v11: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v10> = {
	version: 11,
	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		const update = (block: SerializedBlockV3): SerializedBlockV3 => {
			const pos = block.location.Position;
			const fixedpos = new Vector3(
				math.round(pos.X * 2) / 2,
				math.round(pos.Y * 2) / 2,
				math.round(pos.Z * 2) / 2,
			);
			const newcf = block.location.Rotation.add(fixedpos);

			return {
				...block,
				location: newcf,
			};
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// rename ultrasonic to lidar
const v12: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v11> = {
	version: 12,
	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		const update = (block: SerializedBlockV3): SerializedBlockV3 => {
			if ((block.id as string) === "ultrasonicsensor") {
				return {
					...block,
					id: "lidarsensor" as BlockId,
				};
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// rotate roundwedgeout to 0, -90, 0
const v13: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v12> = {
	version: 13,
	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		const update = (block: SerializedBlockV3): SerializedBlockV3 => {
			if ((block.id as string) === "roundwedgeout") {
				return {
					...block,
					id: "convexprism" as never,
					location: block.location.mul(CFrame.fromEulerAnglesXYZ(0, math.rad(-90), 0)),
				};
			}
			if ((block.id as string) === "roundwedgein") {
				return {
					...block,
					id: "concaveprism" as never,
					location: block.location.mul(CFrame.fromEulerAnglesXYZ(0, math.rad(-90), 0)),
				};
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// rotate innercorner -> innerwedge, rotate
const v14: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v13> = {
	version: 14,
	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		const update = (block: SerializedBlockV3): SerializedBlockV3 => {
			if ((block.id as string) === "innerwedge") {
				return {
					...block,
					id: "innercorner" as never,
				};
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// update constant from number to or
const v15: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v14> = {
	version: 15,
	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		const update = (block: SerializedBlockV3): SerializedBlockV3 => {
			if (block.id === ("constant" as BlockId)) {
				return {
					...block,
					config: Objects.fromEntries(
						Objects.entriesArray(block.config ?? {}).map(([k, v]) => [
							k,
							{ type: "number", value: v ?? 0 },
						]),
					),
				};
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// update ADD SUB DIV MIL from number to number | vector3
const v16: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v15> = {
	version: 16,
	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		const update = (block: SerializedBlockV3): SerializedBlockV3 => {
			if (
				block.id === ("operationadd" as BlockId) ||
				block.id === ("operationsub" as BlockId) ||
				block.id === ("operationmul" as BlockId) ||
				block.id === ("operationdiv" as BlockId)
			) {
				return {
					...block,
					config: Objects.fromEntries(
						Objects.entriesArray(block.config ?? {}).map(([k, v]) => [
							k,
							{ type: "number", value: v ?? 0 },
						]),
					),
				};
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// update de/serialization of color & material
// REMOVED; caused the loss of block material and color
const v17: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v16> = {
	version: 17,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		return {
			version: this.version,
			blocks: prev.blocks as never,
		};
	},
};

// fix de/serialization of color & material from v17
const v18: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v17> = {
	version: 18,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		return {
			version: this.version,
			blocks: prev.blocks,
		};
	},
};

// remove coblox from some blocks
const v19: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v18> = {
	version: 19,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		const update = (block: SerializedBlockV3): SerializedBlockV3 => {
			if (block.id === "halfblock") {
				return {
					...block,
					location: block.location.ToWorldSpace(new CFrame(0, -0.5, 0)),
				};
			}
			if (block.id === "halfball") {
				return {
					...block,
					location: block.location.ToWorldSpace(new CFrame(-0.5, 0, 0)),
				};
			}
			if (
				block.id === "halfwedge1x1" ||
				block.id === "halfwedge1x2" ||
				block.id === "halfwedge1x3" ||
				block.id === "halfwedge1x4"
			) {
				return {
					...block,
					location: block.location.ToWorldSpace(new CFrame(0, -0.5, 0)),
				};
			}
			if (
				block.id === "halfcornerwedge1x1mirrored" ||
				block.id === "halfcornerwedge2x1mirrored" ||
				block.id === "halfcornerwedge3x1mirrored" ||
				block.id === "halfcornerwedge4x1mirrored"
			) {
				return {
					...block,
					location: block.location.ToWorldSpace(new CFrame(0, 0, -0.5)),
				};
			}
			if (
				block.id === "halfcornerwedge1x1" ||
				block.id === "halfcornerwedge2x1" ||
				block.id === "halfcornerwedge3x1" ||
				block.id === "halfcornerwedge4x1"
			) {
				return {
					...block,
					location: block.location.ToWorldSpace(CFrame.Angles(0, -90, 0).add(new Vector3(0, 0, 0.5))),
				};
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// update lots of blocks
const v20: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v19> = {
	version: 20,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		const fixedTripleGeneric = (block: SerializedBlockV3): SerializedBlockV3 => {
			const fixTripleGenericOffset = (cframe: CFrame) =>
				cframe.add(cframe.VectorToWorldSpace(new Vector3(-0.5, -0.5, 0)));
			return {
				...block,
				location: fixTripleGenericOffset(block.location),
			};
		};
		const fixedDoubleGeneric = (block: SerializedBlockV3): SerializedBlockV3 => {
			const fixDoubleGenericOffset = (cframe: CFrame) =>
				cframe.add(cframe.VectorToWorldSpace(new Vector3(0, -0.5, 0)));
			return {
				...block,
				location: fixDoubleGenericOffset(block.location),
			};
		};
		const fixedSingleGeneric = fixedTripleGeneric;
		const withoutOperation = (block: SerializedBlockV3): SerializedBlockV3 => ({
			...block,
			id:
				block.id.find("operation")[0] !== undefined
					? (block.id.sub("operation".size() + 1) as BlockId)
					: block.id,
		});

		const doubleGeneric = new ReadonlySet([
			"operationrand",
			"operationmod",
			"operationxor",
			"operationnor",
			"operationxnor",
			"operationand",
			"operationor",
			"operationnand",
			"operationgreaterthanorequals",
			"operationlessthan",
			"operationnotequals",
			"operationequals",
			"operationlessthanorequals",
			"operationgreaterthan",
			"operationdiv",
			"operationadd",
			"operationsub",
			"operationmul",
			"operationnsqrt",
			"operationpow",
			"operationatan2",

			"keysensor",
			"ownerlocator",
			"laser",
			"anglesensor",
			"gpssensor",
			"leddisplay",
			"screen",
			"speedometer",
			"altimeter",
		]) as unknown as ReadonlySet<BlockId>;
		const singleGeneric = new ReadonlySet([
			"operationrad",
			"operationatan",
			"operationasin",
			"operationabs",
			"operationlog10",
			"operationceil",
			"operationloge",
			"operationsign",
			"operationfloor",
			"operationsqrt",
			"operationround",
			"operationacos",
			"operationsin",
			"operationdeg",
			"operationtan",
			"operationcos",
			"operationlog",
			"operationnot",
			"operationnumbertobyte",
		]) as unknown as ReadonlySet<BlockId>;
		const tripleGeneric = new ReadonlySet([
			"operationvec3combiner",
			"operationvec3splitter",
			"operationclamp",
			"multiplexer",
			"constant",
		]) as unknown as ReadonlySet<BlockId>;

		const update = (block: SerializedBlockV3): SerializedBlockV3 => {
			if (block.id === "speedometer") {
				block = {
					...block,
					config: undefined,
					connections: undefined,
				};
			}
			if (block.id === ("accelerometer" as BlockId)) {
				return {
					...fixedDoubleGeneric(block),
					id: "speedometer",
				};
			}
			if (block.id === ("relay" as BlockId)) {
				return {
					...fixedDoubleGeneric(block),
					id: "multiplexer",
					config: {
						truevalue: block.config?.value ?? undefined!,
						value: block.config?.state ?? undefined!,
						state: undefined!,
					},
					connections: {
						...block.connections,
						["truevalue" as BlockConnectionName]:
							block.connections?.["value" as BlockConnectionName] ?? undefined!,
						["value" as BlockConnectionName]:
							block.connections?.["state" as BlockConnectionName] ?? undefined!,
						["state" as BlockConnectionName]: undefined!,
					},
				};
			}
			if (block.id === ("multiplexer" as BlockId)) {
				block = {
					...block,
					config: {
						truevalue: { type: "number", value: block.config?.truenumber ?? 0 },
						falsevalue: { type: "number", value: block.config?.falsenumber ?? 0 },
						truenumber: undefined!,
						falsenumber: undefined!,
					},
					connections: {
						...block.connections,
						["truevalue" as BlockConnectionName]:
							block.connections?.["truenumber" as BlockConnectionName] ?? undefined!,
						["falsevalue" as BlockConnectionName]:
							block.connections?.["falsenumber" as BlockConnectionName] ?? undefined!,
						["truenumber" as BlockConnectionName]: undefined!,
						["falsenumber" as BlockConnectionName]: undefined!,
					},
				};
			}

			if (block.id === ("lidarsensor" as BlockId)) {
				block = {
					...block,
					id: "laser",
					location: block.location.mul(CFrame.Angles(-math.pi / 2, 0, 0)),
					config: {
						maxDistance: block.config?.max_distance ?? undefined!,
						max_distance: undefined!,
					},
					connections: {
						...block.connections,
						["maxDistance" as BlockConnectionName]:
							block.connections?.["max_distance" as BlockConnectionName] ?? undefined,
						["max_distance" as BlockConnectionName]: undefined!,
					},
				};
			}

			if (block.id === "ownerlocator") {
				block = {
					...block,
					location: block.location.mul(CFrame.Angles(0, -math.pi / 2, -math.pi / 2)),
				};
			}

			if (block.id === ("operationbuffer" as BlockId)) {
				return withoutOperation(block);
			}
			if (singleGeneric.has(block.id)) {
				return withoutOperation(fixedSingleGeneric(block));
			}
			if (doubleGeneric.has(block.id)) {
				return withoutOperation(fixedDoubleGeneric(block));
			}
			if (tripleGeneric.has(block.id)) {
				return withoutOperation(fixedTripleGeneric(block));
			}

			return block;
		};

		const blockmap = new Map(prev.blocks.map((b) => [b.uuid, b] as const));
		for (const [, block] of blockmap) {
			if (block.connections === undefined) continue;

			for (const [name, connection] of pairs(block.connections)) {
				if (connection.connectionName !== "result") continue;

				const otherblock = blockmap.get(connection.blockUuid);
				if (otherblock?.id !== "speedometer") continue;

				Objects.writable(block).connections = {
					...block.connections,
					[name]: undefined!,
				};
			}
		}

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// fix laser
const v21: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v20> = {
	version: 21,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		const update = (block: SerializedBlockV3): SerializedBlockV3 => {
			if (block.id === "laser") {
				return {
					...block,
					config: {
						maxDistance: block.config?.max_distance ?? undefined!,
						max_distance: undefined!,
					},
					connections: {
						...block.connections,
						["rayTransparency" as BlockConnectionName]:
							block.connections?.["dotTransparency" as BlockConnectionName] ?? undefined,
						["raySize" as BlockConnectionName]:
							block.connections?.["dotSize" as BlockConnectionName] ?? undefined,
						["dotTransparency" as BlockConnectionName]: undefined!,
						["dotSize" as BlockConnectionName]: undefined!,
					},
				};
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// fix some block models
const v22: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v21> = {
	version: 22,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		const update = (block: SerializedBlockV3): SerializedBlockV3 => {
			if (block.id === "halfball") {
				return {
					...block,
					location: block.location.mul(CFrame.Angles(0, 0, math.rad(-90))),
				};
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// update wheel models
const v23: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v22> = {
	version: 23,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		const update = (block: SerializedBlockV3): SerializedBlockV3 => {
			if (block.id === "wheel") {
				return { ...block, id: "bigwheel" };
			}
			if (block.id === ("smallwheel" as BlockId)) {
				return { ...block, id: "wheel" };
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// filter out unnesessary stuff
const v24: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV3>, typeof v23> = {
	version: 24,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>): SerializedBlocks<SerializedBlockV3> {
		const update = (block: SerializedBlockV3): SerializedBlockV3 => {
			const ret = { ...block };
			// Filter.deleteDefaultValues(ret);

			return ret;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// update config structure
const v25: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV4>, typeof v24> = {
	version: 25,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV3>, blockList: BlockList): SerializedBlocks<SerializedBlockV4> {
		const updateTypes = (block: SerializedBlockV3): SerializedBlockV4 => {
			const config = {
				...Objects.mapValues(block.config ?? {}, (k, v) => {
					const def = (blockConfigRegistry as BlockConfigRegistry)[block.id as keyof BlockConfigRegistry]!
						.input[k];
					if (!def) {
						$err(`Got nil trying to load key ${k} in block ${block.id}`);
					}

					assert(def.type !== "multikey");

					let ctype: keyof BlockLogicTypes.Primitives;
					let controlConfig: BlockConfigPart<keyof BlockLogicTypes.Controls>["controlConfig"] | undefined;
					if (def.type === "or") {
						v = (v as { value: defined }).value;

						if (typeIs(v, "Vector3")) {
							if ("color" in def.types) ctype = "color";
							else ctype = "vector3";
						} else if (typeIs(v, "number")) {
							if ("number" in def.types) ctype = "number";
							else ctype = "byte";
						} else if (typeIs(v, "boolean")) {
							ctype = "bool";
						} else if (typeIs(v, "string")) {
							if ("key" in def.types) ctype = "key";
							else ctype = "string";
						} else if (typeIs(v, "table")) {
							ctype = "bytearray";
						} else {
							ctype = firstKey(def.types)! as never;
						}
					} else if (def.type === "clampedNumber") {
						ctype = "number";
					} else if (
						def.type === "servoMotorAngle" ||
						def.type === "controllableNumber" ||
						def.type === "motorRotationSpeed" ||
						def.type === "thrust"
					) {
						ctype = "number";
						v = Config.addDefaults({ a: v as never }, { a: def }).a;

						if (def.type === "motorRotationSpeed") {
							const value = v as {
								readonly rotation: {
									readonly add: KeyCode;
									readonly sub: KeyCode;
								};
								readonly speed: number;
								readonly switchmode: boolean;
							};

							controlConfig = {
								enabled: true,
								keys: [
									{ key: value.rotation.add, value: value.speed },
									{ key: value.rotation.sub, value: -value.speed },
								],
								startValue: 0,
								mode: {
									type: "instant",
									instant: { mode: value.switchmode ? "onDoublePress" : "onRelease" },
									smooth: {
										speed: 20,
										mode: value.switchmode ? "stopOnDoublePress" : "stopOnRelease",
									},
								},
							} satisfies BlockConfigPart<"number">["controlConfig"];
						} else if (def.type === "thrust") {
							const value = v as {
								readonly thrust: {
									readonly add: KeyCode;
									readonly sub: KeyCode;
								};
								readonly switchmode: boolean;
							};

							let max = 100;
							if (block.id === "piston") {
								max = (block.config?.distance as number | undefined) ?? max;
							}

							controlConfig = {
								enabled: true,
								keys: [
									{ key: value.thrust.add, value: 100 },
									{ key: value.thrust.sub, value: 0 },
								],
								startValue: 0,
								mode: {
									type: value.switchmode ? "instant" : "smooth",
									instant: { mode: value.switchmode ? "onDoublePress" : "onRelease" },
									smooth: { speed: 20, mode: value.switchmode ? "resetOnRelease" : "stopOnRelease" },
								},
							} satisfies BlockConfigPart<"number">["controlConfig"];
						} else if (def.type === "controllableNumber") {
							const value = v as {
								readonly value: number;
								readonly control: {
									readonly add: KeyCode;
									readonly sub: KeyCode;
								};
							};

							controlConfig = {
								enabled: true,
								keys: [
									{ key: value.control.add, value: value.value },
									{ key: value.control.sub, value: def.min },
								],
								startValue: 0,
								mode: {
									type: "smooth",
									instant: { mode: "onRelease" },
									smooth: { speed: 20, mode: "stopOnRelease" },
								},
							} satisfies BlockConfigPart<"number">["controlConfig"];
						} else if (def.type === "servoMotorAngle") {
							const value = v as {
								readonly rotation: {
									readonly add: KeyCode;
									readonly sub: KeyCode;
								};
								readonly switchmode: boolean;
								readonly angle: number;
							};

							controlConfig = {
								enabled: true,
								keys: [
									{ key: value.rotation.add, value: -value.angle },
									{ key: value.rotation.sub, value: value.angle },
								],
								startValue: 0,
								mode: {
									type: "instant",
									instant: { mode: value.switchmode ? "onDoublePress" : "onRelease" },
									smooth: {
										speed: 20,
										mode: value.switchmode ? "stopOnDoublePress" : "stopOnRelease",
									},
								},
							} satisfies BlockConfigPart<"number">["controlConfig"];
						}

						v = 0;
					} else if (def.type === "keybool") {
						ctype = "bool";
						const value = v as {
							readonly key: string;
							readonly switch: boolean;
							readonly reversed: boolean;
						};

						controlConfig = {
							enabled: true,
							key: value.key,
							switch: value.switch,
							reversed: value.reversed,
						} satisfies BlockConfigPart<"bool">["controlConfig"];

						v = false;
					} else {
						ctype = def.type;
					}

					return {
						type: ctype,
						config: v as never,
						controlConfig,
					};
				}),
				...Objects.mapValues(
					block.connections ?? {},
					(k, v): { type: "wire"; config: BlockLogicTypes.WireValue } => ({
						type: "wire",
						config: { ...v, prevConfig: undefined },
					}),
				),
			};

			const ret: SerializedBlockV4 = {
				...block,
				["connnections" as keyof SerializedBlockV4]: undefined!,
				config,
			};

			return ret;
		};
		const updateIds = (block: SerializedBlockV4): SerializedBlockV4 => {
			if (block.id === "radioreciever") {
				block = {
					...block,
					id: "radioreceiver",
				};
			}

			return block;
		};

		const blocks = prev.blocks.map((b) => updateIds(updateTypes(b)));
		const blockMap = blocks.mapToMap((b) => $tuple(b.uuid, b));
		const wires = BlockWireManager.from(blocks, blockList, undefined, true);
		const byteSplitterFixMap: { readonly [k in string]: string } = {
			"1": "128",
			"2": "64",
			"4": "32",
			"8": "16",
			"16": "8",
			"32": "4",
			"64": "2",
			"128": "1",
		};

		const updateBlock = (block: SerializedBlockV4): SerializedBlockV4 => {
			if (
				block.id === "halfcylinder1x1" ||
				block.id === "halfcylinder1x2" ||
				block.id === "halfcylinder2x1" ||
				block.id === "halfcylinder2x2"
			) {
				return {
					...block,
					location: block.location.mul(CFrame.Angles(0, 0, math.rad(-90))),
				};
			}
			if (block.id === "lamp" || block.id === "smalllamp") {
				block = {
					...block,
					config: {
						...block.config,
						lightRange: block.config?.lightRrange as never,
						lightRrange: undefined!,
					},
				};
			}
			if (block.id === "piston") {
				block = {
					...block,
					config: {
						...block.config,
						distance: undefined!,
					},
				};
			}

			if (!block.config) {
				block = { ...block, config: {} };
			}

			const def = blockList.blocks[block.id]?.logic?.definition;
			if (def) {
				for (const [k] of pairs(def.input)) {
					if (block.config && (!block.config[k] || block.config[k].type === "unset")) {
						const wireType = wires.get(block.uuid)!.get(k)!.availableTypes.get()[0];

						$log(`Replaced ${block.uuid} ${k} type ${block.config[k]?.type ?? "nil"} with ${wireType}`);
						if (!wireType) continue;

						block = {
							...block,
							config: {
								...block.config,
								[k]: {
									type: wireType,
									config: def.input[k].types[wireType]!.config,
								} as PlacedBlockConfig[string],
							},
						};
					}
				}
			}

			for (const [k, v] of pairs(block.config ?? {})) {
				if (v.type !== "wire") continue;

				const connectedBlock = blockMap.get(v.config.blockUuid);
				if (!connectedBlock) continue;

				if (connectedBlock.id !== "bytesplitter") continue;

				block = {
					...block,
					config: {
						...block.config,
						[k]: {
							type: "wire",
							config: {
								...v.config,
								connectionName: byteSplitterFixMap[v.config.connectionName] as BlockConnectionName,
							},
						},
					},
				};

				$log("Rerouting a byte splitter connection from number", v.config.connectionName);
			}

			return block;
		};

		return {
			version: this.version,
			blocks: blocks.map(updateBlock),
		};
	},
};

// update controllable number mode
const v26: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV4>, typeof v25> = {
	version: 26,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV4>, blockList: BlockList): SerializedBlocks<SerializedBlockV4> {
		const update = (block: SerializedBlockV4): SerializedBlockV4 => {
			if (!block.config) return block;

			const b = blockList.blocks[block.id]?.logic?.definition;
			if (!b) return block;

			for (const [k, v] of pairs(block.config)) {
				if (!v.controlConfig) continue;
				if (v.type !== "number") continue;
				if ("instant" in v.controlConfig.mode) continue;
				if (!b.input[k].types.number?.control) continue;

				interface PrevNumberControlMode {
					readonly smooth: boolean;
					readonly smoothSpeed: number;
					readonly resetOnStop: boolean;
					readonly stopOnRelease: boolean;
				}

				const prevMode = v.controlConfig.mode as Partial<PrevNumberControlMode>;

				const newMode = {
					...b.input[k].types.number.control.config.mode,
					smooth: { ...b.input[k].types.number.control.config.mode.smooth },
					instant: { ...b.input[k].types.number.control.config.mode.instant },
				};

				if (prevMode.smooth !== undefined) {
					newMode.type = prevMode.smooth ? "smooth" : "instant";
				}

				if (prevMode.smoothSpeed !== undefined) {
					newMode.smooth.speed = prevMode.smoothSpeed;
				}

				if (prevMode.stopOnRelease !== undefined && prevMode.resetOnStop !== undefined) {
					newMode.instant.mode =
						prevMode.stopOnRelease && prevMode.resetOnStop
							? "onRelease"
							: !prevMode.stopOnRelease && prevMode.resetOnStop
								? "onDoublePress"
								: "never";

					newMode.smooth.mode =
						prevMode.stopOnRelease && prevMode.resetOnStop
							? "resetOnRelease"
							: !prevMode.stopOnRelease && prevMode.resetOnStop
								? "resetOnDoublePress"
								: prevMode.stopOnRelease && !prevMode.resetOnStop
									? "stopOnRelease"
									: !prevMode.stopOnRelease && !prevMode.resetOnStop
										? "stopOnDoublePress"
										: "never";
				}

				//

				block = {
					...block,
					config: {
						...block.config,
						[k]: {
							...v,
							controlConfig: {
								enabled: v.controlConfig.enabled,
								keys: v.controlConfig.keys,
								startValue: v.controlConfig.startValue,
								mode: newMode,
							} satisfies BlockLogicTypes.NumberControl["config"],
						},
					},
				};
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// remove duplicates in logic definition between input/output
const v27: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV4>, typeof v26> = {
	version: 27,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV4>, blockList: BlockList): SerializedBlocks<SerializedBlockV4> {
		const update = (block: SerializedBlockV4): SerializedBlockV4 => {
			if (block.id === "counter") {
				return {
					...block,
					config: {
						...(block.config ?? {}),
						newvalue: block.config?.value as never,
						value: undefined!,
					},
				};
			}
			if (block.id === "vec3objectworldtransformer") {
				return {
					...block,
					config: {
						...(block.config ?? {}),
						inposition: block.config?.position as never,
						position: undefined!,
					},
				};
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// removed piston speed
const v28: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV4>, typeof v27> = {
	version: 28,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV4>, blockList: BlockList): SerializedBlocks<SerializedBlockV4> {
		const update = (block: SerializedBlockV4): SerializedBlockV4 => {
			if (block.id === "piston") {
				return {
					...block,
					config: {
						...(block.config ?? {}),
						speed: undefined!,
					},
				};
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// fix config duplicate {config:{config,type}}
const v29: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV4>, typeof v28> = {
	version: 29,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV4>, blockList: BlockList): SerializedBlocks<SerializedBlockV4> {
		const update = (block: SerializedBlockV4): SerializedBlockV4 => {
			if (!block.config) return block;

			const fixConfigErrors = <T>(config: T): T => {
				if (typeIs(config, "table") && "type" in config && "config" in config) {
					return config.config as T;
				}

				return config;
			};

			for (const [k, v] of pairs(block.config)) {
				block = {
					...block,
					config: {
						...block.config,
						[k]: {
							...v,
							config: fixConfigErrors(v.config),
						} as BlockConfigPart<"string">,
					},
				};
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// remove apparently not removed connections
const v30: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV4>, typeof v29> = {
	version: 30,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV4>): SerializedBlocks<SerializedBlockV4> {
		const update = (block: SerializedBlockV4): SerializedBlockV4 => {
			return {
				...block,
				["connections" as never]: undefined!,
			};
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// rotated all blocks to 0, 0, 0
const v31: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV4>, typeof v30> = {
	version: 31,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV4>): SerializedBlocks<SerializedBlockV4> {
		const update = (block: SerializedBlockV4): SerializedBlockV4 => {
			if (
				block.id === "cylindricaltnt" ||
				block.id === "cylinder1x1" ||
				block.id === "cylinder1x2" ||
				block.id === "cylinder2x1" ||
				block.id === "cylinder2x2"
			) {
				return {
					...block,
					location: block.location.mul(CFrame.Angles(0, 0, math.rad(-90))),
				};
			}
			if (
				block.id === "halfcornerwedgemirrored1x1" ||
				block.id === "halfcornerwedgemirrored1x2" ||
				block.id === "halfcornerwedgemirrored2x1" ||
				block.id === "halfcornerwedgemirrored2x2"
			) {
				return {
					...block,
					location: block.location.mul(CFrame.Angles(0, math.rad(-90), 0)),
				};
			}

			return block;
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// Add customData
const v32: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV5>, typeof v31> = {
	version: 32,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV5>): SerializedBlocks<SerializedBlockV6> {
		return {
			version: this.version,
			blocks: prev.blocks,
		};
	},
};

// Add customData
const v33: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV7>, typeof v32> = {
	version: 33,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV6>): SerializedBlocks<SerializedBlockV7> {
		return {
			version: this.version,
			blocks: prev.blocks.map((b): SerializedBlockV7 => ({
				...b,
				color: b.color ? (typeIs(b.color, "Color3") ? { color: b.color, alpha: 1 } : b.color) : undefined,
			})),
		};
	},
};

// Replace military turbine model customData
const v34: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockBase>, typeof v32> = {
	version: 34,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockBase>): SerializedBlocks<SerializedBlockBase> {
		return {
			version: this.version,
			blocks: prev.blocks.map((b): SerializedBlockBase => ({
				...b,
				id: b.id === "jetenginemilitary" ? "jetenginemilitaryold" : b.id,
			})),
		};
	},
};

// Fix radio receiver id
const v35: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockBase>, typeof v34> = {
	version: 35,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockBase>): SerializedBlocks<SerializedBlockBase> {
		return {
			version: this.version,
			blocks: prev.blocks.map((b): SerializedBlockBase => ({
				...b,
				id: b.id === "radioreciever" ? "radioreceiver" : b.id,
			})),
		};
	},
};

// rescale deprecated elongated variants (beam/wedge/tetra/cornerwedge Nx1 & 1xN) onto their 1x1 base.
// the scale is measured from the retained prefabs at load, so the length axis is never hardcoded.
const v36: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV7>, typeof v35> = {
	version: 36,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV7>, blockList: BlockList): SerializedBlocks<SerializedBlockV7> {
		const baseOf: { readonly [oldId: string]: string } = {
			beam2x1: "block",
			beam3x1: "block",
			beam4x1: "block",

			wedge1x2: "wedge1x1",
			wedge1x3: "wedge1x1",
			wedge1x4: "wedge1x1",

			halfwedge1x2: "halfwedge1x1",
			halfwedge1x3: "halfwedge1x1",
			halfwedge1x4: "halfwedge1x1",

			cornerwedge2x1: "cornerwedge1x1",
			cornerwedge3x1: "cornerwedge1x1",
			cornerwedge4x1: "cornerwedge1x1",

			innertetra2x1: "innertetra",
			innertetra3x1: "innertetra",
			innertetra4x1: "innertetra",

			tetrahedron2x1: "tetrahedron",
			tetrahedron3x1: "tetrahedron",
			tetrahedron4x1: "tetrahedron",

			halfcornerwedge2x1: "halfcornerwedge1x1",
			halfcornerwedge3x1: "halfcornerwedge1x1",
			halfcornerwedge4x1: "halfcornerwedge1x1",

			halfcornerwedge2x1mirrored: "halfcornerwedge1x1mirrored",
			halfcornerwedge3x1mirrored: "halfcornerwedge1x1mirrored",
			halfcornerwedge4x1mirrored: "halfcornerwedge1x1mirrored",

			wing1x2: "wing1x1",
			wing1x3: "wing1x1",
			wing1x4: "wing1x1",

			wedgewing1x2: "wedgewing1x1",
			wedgewing1x3: "wedgewing1x1",
			wedgewing1x4: "wedgewing1x1",

			cylinder1x2: "cylinder1x1",
			cylinder2x1: "cylinder1x1",
			cylinder2x2: "cylinder1x1",

			halfcylinder1x2: "halfcylinder1x1",
			halfcylinder2x1: "halfcylinder1x1",
			halfcylinder2x2: "halfcylinder1x1",
		};

		// Visual extents in the model's own pivot frame, ignoring the collision box. The auto-created
		// colbox is placed at identity rotation carrying the visual's *local* size (BlockListBuilder), so a
		// rotated visual leaves the colbox axes wrong — PrimaryPart.Size (what SharedBuilding.calculateScale
		// reads) would give the wrong aspect. Projecting each visual part's oriented box onto the pivot axes
		// avoids that.
		const measureVisual = (model: BlockModel): Vector3 => {
			const pivot = model.GetPivot();
			let min = Vector3.zero;
			let max = Vector3.zero;
			let has = false;

			for (const part of model.GetDescendants()) {
				if (!part.IsA("BasePart")) continue;
				const name = part.Name.fullLower();
				if (name === "colbox" || name === "radarview") continue;

				const rel = pivot.ToObjectSpace(part.CFrame);
				const h = part.Size.div(2);
				const r = rel.RightVector;
				const u = rel.UpVector;
				const l = rel.LookVector;
				const ext = new Vector3(
					math.abs(r.X) * h.X + math.abs(u.X) * h.Y + math.abs(l.X) * h.Z,
					math.abs(r.Y) * h.X + math.abs(u.Y) * h.Y + math.abs(l.Y) * h.Z,
					math.abs(r.Z) * h.X + math.abs(u.Z) * h.Y + math.abs(l.Z) * h.Z,
				);
				const lo = rel.Position.sub(ext);
				const hi = rel.Position.add(ext);

				if (!has) {
					min = lo;
					max = hi;
					has = true;
				} else {
					min = min.Min(lo);
					max = max.Max(hi);
				}
			}

			return max.sub(min);
		};

		const scaleCache = new Map<string, Vector3>();
		const scaleFor = (oldId: string, base: string) =>
			scaleCache.getOrSet(oldId, () => {
				const oldModel = blockList.blocks[oldId]?.model;
				const baseModel = blockList.blocks[base]?.model;
				// fixme: Phase 2 — before deleting the hidden shell prefabs, bake the logged scale vectors into
				// literals per oldId here. Otherwise this fallback loads the block unscaled, with only a log.
				if (!oldModel || !baseModel) {
					$log(`Cannot rescale ${oldId}: a prefab is missing (deleted shell?). Leaving unscaled.`);
					return Vector3.one;
				}

				return measureVisual(oldModel).div(measureVisual(baseModel));
			});

		const update = (block: SerializedBlockV7): SerializedBlockV7 => {
			const base = baseOf[block.id];
			if (base === undefined) return block;

			const scale = scaleFor(block.id, base);
			$log(`Rescaling deprecated block ${block.id} -> ${base} x(${scale}) (uuid ${block.uuid})`);

			return {
				...block,
				id: base as BlockId,
				scale: (block.scale ?? Vector3.one).mul(scale),
			};
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

// AESA radar "boresight" was mistakenly exposed, removes that key because players
// were never meant to see it
const v37: UpgradableBlocksSerializer<SerializedBlocks<SerializedBlockV7>, typeof v36> = {
	version: 37,

	upgradeFrom(prev: SerializedBlocks<SerializedBlockV7>): SerializedBlocks<SerializedBlockV7> {
		const stripBoresight = <T extends object>(map: T | undefined): T | undefined => {
			if (map === undefined || !("boresight" in map)) return map;

			const copy = { ...map } as Record<string, unknown>;
			delete copy.boresight;
			return copy as T;
		};

		const update = (block: SerializedBlockV7): SerializedBlockV7 => {
			if (block.id !== "aesaradar") return block;

			return {
				...block,
				config: stripBoresight(block.config),
				connections: stripBoresight(block.connections),
			};
		};

		return {
			version: this.version,
			blocks: prev.blocks.map(update),
		};
	},
};

//

const versions = [
	...([v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20] as const),
	...([v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35, v36, v37] as const),
] as const;
const current = versions[versions.size() - 1] as typeof versions extends readonly [...unknown[], infer T] ? T : never;

const getVersion = (version: number) => versions.find((v) => v.version === version);

/** Methods to save and load buildings */
export namespace BlocksSerializer {
	export type JsonSerializedBlocks = SerializedBlocks<JsonBlock>;
	type JsonBlock = ReplaceWith<
		Omit<LatestSerializedBlock, "location" | "color" | "material" | "scale">,
		{
			readonly loc: SerializedCFrame;
			readonly mat: SerializedEnum | undefined;
			readonly col: SerializedColor | undefined;
			readonly scl: string | undefined;
			readonly wld: string | undefined;
			readonly cld: boolean | undefined;
		}
	>;

	export const latestVersion = current.version;

	export function serializeBlockToObject(plot: ReadonlyPlot, block: BlockModel): LatestSerializedBlock {
		return read.blockV3(block, plot.origin);
	}
	export function serializeToObject(plot: ReadonlyPlot): SerializedBlocks<LatestSerializedBlock> {
		return {
			version: current.version,
			blocks: plot.getBlocks().map((block) => serializeBlockToObject(plot, block)),
			// freshness marker used to pick a winner between the external db and the datastore copy
			savedAt: DateTime.now().UnixTimestampMillis,
		};
	}

	export function objectToJson(slot: LatestSerializedBlocks): JsonSerializedBlocks {
		const fix = (block: LatestSerializedBlock): JsonBlock => {
			return {
				id: block.id,
				uuid: block.uuid,
				config: block.config,
				customData: block.customData,
				connections: block.connections,

				loc: Serializer.CFrameSerializer.serialize(block.location),
				col: block.color && Serializer.Color4Serializer.serialize(block.color),
				mat: block.material && Serializer.EnumMaterialSerializer.serialize(block.material),
				scl: block.scale && JSON.serialize(block.scale),
				wld: block.welds && JSON.serialize(block.welds),
				cld: block.collidable,
			};
		};

		return {
			version: slot.version,
			blocks: slot.blocks.map(fix),
			savedAt: slot.savedAt,
		};
	}

	export function upgradeSave(data: SerializedBlocks<SerializedBlockBase>, blockList: BlockList) {
		const version = data.version;
		for (let i = version + 1; i <= current.version; i++) {
			const version = getVersion(i);
			if (!version) continue;
			if (!("upgradeFrom" in version)) continue;

			data = version.upgradeFrom(data as never, blockList);
			$log(`Upgrading a slot to savev${version.version}`);
		}

		return data;
	}

	export function jsonToObject(slot: JsonSerializedBlocks): LatestSerializedBlocks {
		const fix = (block: JsonBlock): LatestSerializedBlock => {
			return {
				id: block.id,
				uuid: block.uuid,
				config: block.config,
				customData: block.customData,
				connections: block.connections,

				location: Serializer.CFrameSerializer.deserialize(block.loc),
				color: block.col ? Serializer.Color4Serializer.deserialize(block.col) : undefined,
				material: block.mat ? Serializer.EnumMaterialSerializer.deserialize(block.mat) : undefined,
				scale: block.scl ? JSON.deserialize(block.scl) : undefined,
				welds: block.wld ? JSON.deserialize(block.wld) : undefined,
				collidable: block.cld,
			};
		};

		return {
			version: slot.version,
			blocks: slot.blocks.map(fix),
			savedAt: slot.savedAt,
		};
	}
	export function deserializeFromObject(
		data: SerializedBlocks<SerializedBlockBase>,
		plot: BuildingPlot,
		blockList: BlockList,
	): number {
		if (data.version === undefined) {
			throw "Corrupted slot data";
		}
		if (data.version > latestVersion) {
			throw "Trying to load a slot with an unknown version (loaded from testing?)";
		}

		$log(`Loading a slot using savev${data.version}`);

		data = upgradeSave(data, blockList);
		Filter.cleanup(
			data.blocks.mapToMap((b) =>
				$tuple((b as LatestSerializedBlock).uuid, b as Writable<LatestSerializedBlock>),
			),
		);
		place.blocksOnPlot(plot, data.blocks as readonly LatestSerializedBlock[]);
		return data.blocks.size();
	}

	export function serializedBlockToPlaceRequest(
		blockData: LatestSerializedBlock,
		buildingCenter: CFrame,
	): PlaceBlockRequest {
		return {
			id: blockData.id,
			location: buildingCenter.ToWorldSpace(blockData.location),

			color: blockData.color ?? { color: Color3.fromRGB(255, 255, 255), alpha: 1 },
			material: blockData.material ?? Enum.Material.Plastic,
			config: blockData.config,
			customData: blockData.customData,
			uuid: blockData.uuid,
			scale: blockData.scale,
			welds: blockData.welds,
			collidable: blockData.collidable,
		};
	}
}
