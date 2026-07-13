import { JSON } from "engine/shared/fixes/Json";
import { BlockConfigStore } from "shared/building/BlockConfigStore";
import { Serializer } from "shared/Serializer";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";

declare global {
	type BlockDataBase = {
		readonly id: BlockId;
		readonly uuid: BlockUuid;
		readonly color: Color4;
		readonly material: Enum.Material;
		readonly config: PlacedBlockConfig | undefined;
		readonly customData?: { [k in string | number]: unknown };
		readonly scale: Vector3 | undefined;
		readonly welds?: BlockWelds;
		readonly collidable?: boolean;
	};

	type PlacedBlockData<T extends BlockModel = BlockModel> = BlockDataBase & { readonly instance: T };

	type BlockWelds = readonly BlockWeld[];
	type BlockWeld = {
		readonly thisPart: readonly string[];
		readonly otherUuid: BlockUuid;
		readonly otherPart: readonly string[];
		readonly welded: boolean;
	};
}

interface Manager<T> {
	readonly set: (block: BlockModel, value: T) => void;
	readonly get: (block: BlockModel) => T;
}

/** Methods for reading information about a block */
export namespace BlockManager {
	export function isActiveBlockPart(part: Instance): part is BasePart & { Anchored: true } {
		if (!isBlockPart(part) || !part.IsA("BasePart") || part.AssemblyRootPart?.Anchored || part.Anchored) {
			return false;
		}

		return true;
	}

	export function isBlockModel(part: Instance | undefined): part is BlockModel {
		return part !== undefined && part.IsA("Model") && part.Parent?.Name === "Blocks";
	}

	export function isBlockPart(part: Instance | undefined): boolean {
		return tryGetBlockModelByPart(part) !== undefined;
	}

	export function tryGetBlockModelByPart(part: Instance | undefined): BlockModel | undefined {
		let parent = part;
		while (parent) {
			if (parent === game) {
				break;
			}
			if (isBlockModel(parent)) {
				return parent;
			}

			parent = parent.Parent;
		}
	}
	export function getBlockDataByPart(part: BasePart): PlacedBlockData | undefined {
		const block = tryGetBlockModelByPart(part);
		return block && getBlockDataByBlockModel(block);
	}

	export const manager = {
		id: {
			set: (block, value) => block.SetAttribute("id", value),
			get: (block) => block.GetAttribute("id") as BlockId,
		},
		uuid: {
			set: (block, value) => block.SetAttribute("uuid", value),
			get: (block) => block.GetAttribute("uuid") as BlockUuid,
		},

		scale: {
			set: (block, value) => block.SetAttribute("scale", value),
			get: (block) => block.GetAttribute("scale") as Vector3 | undefined,
		},

		material: {
			set: (block, value) => block.SetAttribute("material", Serializer.EnumMaterialSerializer.serialize(value)),
			get: (block) => {
				const attribute = block.GetAttribute("material") as SerializedEnum | undefined;
				if (attribute === undefined) return Enum.Material.Plastic;

				return Serializer.EnumMaterialSerializer.deserialize(attribute);
			},
		},
		color: {
			set: (block, value) => block.SetAttribute("color", JSON.serialize(value)),
			get: (block) => {
				const attribute = block.GetAttribute("color") as string | undefined;
				if (attribute === undefined) return { color: Color3.fromRGB(255, 255, 255), alpha: 1 };

				return JSON.deserialize<Color4>(attribute);
			},
		},

		config: {
			set: (block, value: PlacedBlockConfig | undefined) => BlockConfigStore.set(block, value),
			get: (block) => BlockConfigStore.get(block),
		},

		customData: {
			set: (block, value: PlacedBlockData["customData"] | undefined) =>
				block.SetAttribute("customData", value ? JSON.serialize(value) : undefined),
			get: (block) => {
				const attribute = block.GetAttribute("customData") as string | undefined;
				if (attribute === undefined) return undefined;

				return JSON.deserialize<PlacedBlockData["customData"]>(attribute);
			},
		},
		welds: {
			set: (block, value: BlockWelds | undefined) =>
				block.SetAttribute("welds", value ? JSON.serialize(value) : undefined),
			get: (block) => {
				const attribute = block.GetAttribute("welds") as string | undefined;
				if (attribute === undefined) return undefined;

				return JSON.deserialize<BlockWelds>(attribute);
			},
		},

		collidable: {
			set: (block, value) => block.SetAttribute("collidable", value),
			get: (block) => block.GetAttribute("collidable") as boolean | undefined,
		},
	} satisfies { readonly [k in Exclude<keyof PlacedBlockData, "instance">]: Manager<PlacedBlockData[k]> };

	export function getBlockDataByBlockModel(model: BlockModel): PlacedBlockData {
		return {
			instance: model,
			id: manager.id.get(model),
			color: manager.color.get(model),
			material: manager.material.get(model),
			uuid: manager.uuid.get(model),
			config: manager.config.get(model),
			customData: manager.customData.get(model),
			scale: manager.scale.get(model),
			welds: manager.welds.get(model),
			collidable: manager.collidable.get(model),
		};
	}
}
