import { Objects } from "engine/shared/fixes/Objects";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type { LatestSerializedBlock, LatestSerializedBlocks } from "shared/building/BlocksSerializer";
import type { BuildingDiffChange as ChangeListEntry } from "shared/building/BuildingDiffer";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";

type DiffBlock = LatestSerializedBlock;

type Added = {
	readonly id: BlockId;
	readonly uuid: BlockUuid;
	readonly location: CFrame;
	readonly scale?: Vector3;
};
type Removed = BlockUuid;
type ConfigChanged = PartialThrough<PlacedBlockConfig>;
type Moved = {
	readonly uuid: BlockUuid;
	readonly to: Vector3;
};
type Rotated = {
	readonly uuid: BlockUuid;
	readonly to: CFrame;
};
type Scaled = {
	readonly uuid: BlockUuid;
	readonly to: Vector3;
};

export type BuildingDiffChange = {
	readonly version: number;
	readonly added?: readonly Added[];
	readonly removed?: readonly Removed[];
	readonly configChanged?: { readonly [k in BlockUuid]: ConfigChanged };
	readonly moved?: readonly Moved[];
	readonly rotated?: readonly Rotated[];
	readonly scaled?: readonly Scaled[];
};
const arrKeys = ["added", "removed", "moved", "rotated", "scaled"] as const satisfies (keyof BuildingDiffChange)[];
const objKeys = ["configChanged"] as const satisfies (keyof BuildingDiffChange)[];

export namespace BuildingDiffer {
	let before: LatestSerializedBlocks | undefined;

	function toTsCode(obj: unknown): string {
		const mapObjectProperties = (obj: object) =>
			`${asMap(obj)
				.map((k, v) => `${k}: ${toTsCode(v)}`)
				.join(",\n")}`;
		const radToDeg = (angle: number) => {
			// special case for -0
			if (angle === 0) return "0";

			return `math.rad(${math.round(math.deg(angle))})`;
		};

		// print uuid first
		if (typeIs(obj, "table") && "uuid" in obj) {
			return `{ uuid: ${toTsCode(obj.uuid)}, ${mapObjectProperties({ ...obj, uuid: undefined })} }`;
		}

		if (typeIs(obj, "string")) return `"${obj}"`;
		if (typeIs(obj, "number")) return tostring(obj);
		if (typeIs(obj, "boolean")) return tostring(obj);
		if (typeIs(obj, "table")) {
			if (1 in obj) {
				return `[ ${asMap(obj)
					.map((k, v) => toTsCode(v))
					.join(",\n")} ]`;
			}

			return `{ ${mapObjectProperties(obj)} }`;
		}
		if (typeIs(obj, "CFrame")) {
			const [xa, ya, za] = obj.ToOrientation();
			if (xa === 0 && ya === 0 && za === 0) {
				return `new CFrame(${obj.X}, ${obj.Y}, ${obj.Z})`;
			}

			const components = obj.GetComponents();
			return `new CFrame(${components.join()})`;
		}
		if (typeIs(obj, "Vector3")) {
			return `new Vector3(${obj.X}, ${obj.Y}, ${obj.Z})`;
		}
		if (typeIs(obj, "Vector2")) {
			return `new Vector2(${obj.X}, ${obj.Y})`;
		}

		return tostring(obj);
	}

	// a recording that adds hidden or scaled blocks, brought up to date by the save migrations; any that come out
	// scaled (deprecated 1xN blocks) are placed as their unscaled base in one corner of their footprint, the corner
	// nearest the plot-relative `anchor` (the negative one without it), then stretched in a second change: the Edit tool
	// keeps the opposite face still while a face is dragged
	export function splitScaled(
		change: BuildingDiffChange,
		blockList: BlockList,
		anchor?: Vector3,
	): { readonly place: BuildingDiffChange; readonly stretch?: BuildingDiffChange } {
		// placeable unscaled blocks stay as recorded, even ones the migrations would rescale
		const needsSplit = (block: Added) =>
			blockList.blocks[block.id]?.hidden === true || (block.scale !== undefined && block.scale !== Vector3.one);
		if (!change.added?.any(needsSplit)) return { place: change };

		const upgraded = BlocksSerializer.upgradeSave(
			{ version: change.version, blocks: change.added ?? [] } as never,
			blockList,
		) as LatestSerializedBlocks;

		const added: Added[] = [];
		const moved: Moved[] = [];
		const scaled: Scaled[] = [];
		for (const block of upgraded.blocks) {
			const size = BlocksSerializer.visualSize(blockList.blocks[block.id]!.model);
			const grow = (block.scale ?? Vector3.one).sub(Vector3.one);

			// only axes that grow by half a stud or more: the 1xN wing prefabs also differ from their base by a few
			// hundredths of a stud in thickness, which no drag can reproduce
			const kept = grow.mul(size).apply((studs) => (math.abs(studs) >= 0.5 ? 1 : 0));
			if (kept === Vector3.zero) {
				added.push({ id: block.id, uuid: block.uuid, location: block.location });
				continue;
			}

			const scale = Vector3.one.add(grow.mul(kept));
			const half = scale.sub(Vector3.one).mul(size).div(2);
			const signs = (k: number) => (k === 0 ? [0] : [-1, 1]);
			const corners = signs(kept.X).flatmap((x) =>
				signs(kept.Y).flatmap((y) =>
					signs(kept.Z).map((z) => block.location.mul(new CFrame(half.mul(new Vector3(x, y, z))))),
				),
			);
			const [start] = anchor
				? corners.sort((l, r) => l.Position.sub(anchor).Magnitude < r.Position.sub(anchor).Magnitude)
				: corners;
			added.push({ id: block.id, uuid: block.uuid, location: start });
			moved.push({ uuid: block.uuid, to: block.location.Position });
			scaled.push({ uuid: block.uuid, to: scale });
		}

		const place: BuildingDiffChange = { ...change, version: upgraded.version, added };
		if (scaled.isEmpty()) return { place };

		return { place, stretch: { version: upgraded.version, moved, scaled } };
	}

	// the first tutorial system's recordings, as one change
	export function fromChangeList(changes: readonly ChangeListEntry[], version: number): BuildingDiffChange {
		type changes = {
			-readonly [k in keyof BuildingDiffChange]?: Writable<BuildingDiffChange[k]>;
		} & {
			readonly version: number;
		};

		const ret: changes = { version };
		for (const change of changes) {
			if (change.type === "added") {
				(ret.added ??= []).push({ ...change.block, uuid: change.block.uuid as BlockUuid });
			} else if (change.type === "removed") {
				(ret.removed ??= []).push(change.uuid as BlockUuid);
			} else if (change.type === "moved") {
				(ret.moved ??= []).push({ uuid: change.uuid as BlockUuid, to: change.to });
			} else if (change.type === "rotated") {
				(ret.rotated ??= []).push({ uuid: change.uuid as BlockUuid, to: change.toRotation });
			} else if (change.type === "configChanged") {
				if (change.value === undefined) continue;

				const configs = (ret.configChanged ??= {});
				const config = (configs[change.uuid as BlockUuid] ??= {}) as Writable<ConfigChanged>;
				config[change.key] = change.value;
			}
		}

		return ret;
	}

	export function setBefore(plot: ReadonlyPlot): void {
		before = BlocksSerializer.serializeToObject(plot);
	}
	export function serializeDiffToTsCode(plot: ReadonlyPlot): string {
		const serialized = BlocksSerializer.serializeToObject(plot);
		const ret = diff(before?.blocks ?? [], serialized.blocks, serialized.version);

		return toTsCode(ret);
	}
	export function serializePlotToTsCode(plot: ReadonlyPlot): string {
		return toTsCode(BlocksSerializer.serializeToObject(plot));
	}

	export function diff(
		before: readonly DiffBlock[],
		after: readonly DiffBlock[],
		version: number,
	): BuildingDiffChange {
		const beforeMap = before.mapToMap((block) => $tuple(block.uuid, block));
		const afterMap = after.mapToMap((block) => $tuple(block.uuid, block));

		type changes = {
			-readonly [k in keyof BuildingDiffChange]?: Writable<BuildingDiffChange[k]>;
		} & {
			readonly version: number;
		};

		const changes: changes = { version };
		for (const [uuid, before] of beforeMap) {
			const after = afterMap.get(uuid);
			if (!after) {
				(changes.removed ??= []).push(before.uuid);
				continue;
			}

			{
				const posbefore = before.location;
				const posafter = after.location;

				if (posbefore !== posafter) {
					if (posbefore.Position !== posafter.Position) {
						(changes.moved ??= []).push({ uuid, to: posafter.Position });
					}

					if (posbefore.Rotation !== posafter.Rotation) {
						(changes.rotated ??= []).push({ uuid, to: posafter.Rotation });
					}
				}
			}

			{
				const scalebefore = before.scale ?? Vector3.one;
				const scaleafter = after.scale ?? Vector3.one;
				if (scalebefore !== scaleafter) {
					(changes.scaled ??= []).push({ uuid, to: scaleafter });
				}
			}

			{
				const cfgbefore = before.config ?? {};
				const cfgafter = after.config ?? {};

				if (!Objects.deepEquals(cfgbefore, cfgafter)) {
					(changes.configChanged ??= {})[uuid] = cfgafter;
				}
			}
		}

		for (const [uuid, after] of afterMap) {
			const before = beforeMap.get(uuid);
			if (!before) {
				const block: Added = { id: after.id, location: after.location, uuid: after.uuid, scale: after.scale };
				(changes.added ??= []).push(block);

				const diff2 = diff([block], [after], version);
				for (const k of arrKeys) {
					if (!diff2[k]) continue;

					for (const item of diff2[k]) {
						(changes[k] ??= []).push(item as never);
					}
				}
				for (const k of objKeys) {
					if (!diff2[k]) continue;

					for (const [kk, v] of pairs(diff2[k])) {
						(changes[k] ??= {})[kk] = v;
					}
				}

				continue;
			}
		}

		return changes;
	}
}
