import type { Component } from "engine/shared/component/Component";
import type { PlayerFeature } from "server/database/PlayerDatabase";
import type { BlockLogicFullBothDefinitions, GenericBlockLogicCtor } from "shared/blockLogic/BlockLogic";
import type { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import type { BlockCreation, BlockMirrorBehaviour } from "shared/blocks/BlockCreation";
import type { projectileModifier } from "shared/weaponProjectiles/BaseProjectileLogic";

export type BlockCategoryPath = readonly string[];
export type LogicImmediateUpdate = (block: BlockModel) => void;
export type BlockLogicInfo = {
	readonly definition: BlockLogicFullBothDefinitions;
	readonly ctor: GenericBlockLogicCtor;
	readonly events?: { readonly [k in string]?: BlockSynchronizer<{ readonly block: BlockModel }> };
	readonly immediate?: LogicImmediateUpdate;
	readonly preview?: ConstructorOf<Component, [block: BlockModel]>;
};
export type BlockModelSource = {
	readonly model: (self: BlockBuilder) => BlockModel;
	readonly category: (self: BlockBuilder, model: BlockModel) => BlockCategoryPath;
};
export type BlockSearchInfo = {
	/** Aliases that are not checked for sub-string */
	readonly aliases?: readonly string[];
	/** Aliases that are checked for sub-string */
	readonly partialAliases?: readonly string[];
};

export type BlockMarkerPositions = {
	readonly [name in string]?: Vector3;
};
export type BlockWeldRegions = Model;
export type weaponBlockType = "CORE" | "PROCESSOR" | "FILLER" | "UPGRADE";
type weaponMarkerName = string;
export type BlockBuilder = {
	readonly id: string;
	readonly displayName: string;
	readonly description: string;
	/** Is the block hidden from the block list */
	readonly hidden?: boolean;
	readonly logic?: BlockLogicInfo;
	readonly weaponConfig?: {
		type: weaponBlockType;
		modifier: projectileModifier;
		markers: Record<
			weaponMarkerName,
			{
				emitsProjectiles?: boolean;
				allowedBlockIds?: string[];
				//allowedTypes: weaponBlockTypes[];
			}
		>;
	};
	readonly limit: number;
	readonly mirror: {
		readonly behaviour: BlockMirrorBehaviour;
		readonly replacementId?: string;
	};

	readonly physics?: {
		impactDamageStrength?: number;
		forcedDamageThreshold?: number; // % from max health
	};

	readonly requiredFeatures?: readonly PlayerFeature[];
	readonly devOnly: boolean;
	readonly search?: BlockSearchInfo;

	/** @server */
	readonly modelSource: BlockModelSource;

	/** @server */
	readonly weldRegionsSource: (self: BlockBuilder, model: BlockModel) => BlockWeldRegions;
	/** @server */
	readonly markerPositionsSource: (self: BlockBuilder, model: BlockModel) => BlockMarkerPositions;
};
export type BlockBuilderWithoutId = Omit<BlockBuilder, "id">;
export type BlockBuilderWithoutIdAndDefaults = MakePartial<BlockBuilderWithoutId, keyof typeof BlockCreation.defaults>;
export type BlockBuildersWithoutIdAndDefaults = { readonly [k in string]: BlockBuilderWithoutIdAndDefaults };

declare global {
	type BlockId = string;

	type Block = Omit<BlockBuilder, "id" | (`${string}Source` & keyof BlockBuilder)> & {
		readonly id: BlockId;
		readonly model: BlockModel;
		readonly category: BlockCategoryPath;
		readonly markerPositions: BlockMarkerPositions;
		readonly weldRegions: BlockWeldRegions;
	};

	type GenericBlockList = {
		readonly [k in BlockId]: Block | undefined;
	};
	type BlockList = {
		readonly blocks: GenericBlockList;
		readonly sorted: readonly Block[];
	};
}
