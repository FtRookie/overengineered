import { RunService } from "@rbxts/services";
import { Element } from "engine/shared/Element";
import { Instances } from "engine/shared/fixes/Instances";
import { Lazy } from "engine/shared/Lazy";
import { BlockWeldInitializer } from "shared/blocks/BlockWeldInitializer";
import { BlockManager } from "shared/building/BlockManager";
import { ReplicatedAssets } from "shared/ReplicatedAssets";
import type { BlockConfigPart } from "shared/blockLogic/BlockConfig";
import type { BlockLogicBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type {
	BlockBuilder,
	BlockBuilderWithoutIdAndDefaults,
	BlockCategoryPath,
	BlockMarkerPositions,
	BlockWeldRegions,
	LogicImmediateUpdate,
} from "shared/blocks/Block";

export type AutoWeldColliderBlockShape = "none" | "cube";
export type BlockMirrorBehaviour =
	| "offset90"
	| "offset180"
	| "offset270"
	| "normal"
	| "wedgeWing"
	| "tetra"
	| "innertetra"
	| "cornerwedge"
	| "hcylquart"
	| "hcylvertical";

/** Tools for creating a block and its data. */
export namespace BlockCreation {
	const assets = new Lazy(() => {
		type model = {
			readonly id: string;
			readonly model: Model;
			readonly category: readonly string[];
		};
		const models: model[] = [];

		const search = (parent: Instance, path: readonly string[]) => {
			for (const child of parent.GetChildren()) {
				if (child.IsA("Folder")) {
					search(child, [...path, child.Name]);
					continue;
				}

				if (child.IsA("Model")) {
					models.push({
						id: child.Name.lower(),
						model: child,
						category: path,
					});
				}
			}
		};
		search(ReplicatedAssets.waitForAsset("Placeable"), []);

		return models.mapToMap((model) => $tuple(model.id, model)).asReadonly();
	});

	/** Create a folder on a server, and get it on the client. */
	function createServerFolder(name: string) {
		if (RunService.IsServer()) {
			Element.create("Folder", { Name: name, Parent: ReplicatedAssets.assets });
		}

		return Instances.waitForChild<Folder & { readonly [k in string]: BlockModel }>(ReplicatedAssets.assets, name);
	}

	export namespace Model {
		const folder = createServerFolder("BlocksModels");

		export function fromAssets(block: BlockBuilder): BlockModel {
			if (RunService.IsClient()) {
				return folder[block.id];
			}

			const model = assets.get().get(block.id);
			if (!model) throw `Block ${block.id} was not found in assets`;

			const clone = model.model.Clone() as BlockModel;
			clone.Name = block.id;
			clone.Parent = folder;

			return clone;
		}
		/** @deprecated Used for a single block, should be deleted after */
		export function fFromAssets(id: string): BlockBuilder["modelSource"]["model"] {
			return () => {
				if (RunService.IsClient()) {
					return folder[id];
				}

				const model = assets.get().get(id);
				if (!model) throw `Block ${id} was not found in assets`;

				const clone = model.model.Clone() as BlockModel;
				clone.Name = id;
				clone.Parent = folder;

				return clone;
			};
		}

		export type PrefabName =
			| "ConstLogicBlockPrefab"
			| "GenericLogicBlockPrefab"
			| "DoubleGenericLogicBlockPrefab"
			| "TripleGenericLogicBlockPrefab"
			| "x4GenericLogicBlockPrefab"
			| "ByteLogicBlockPrefab"
			| "DoubleByteLogicBlockPrefab"
			| "SoundLogicBlockPrefab"
			| "DoubleSoundLogicBlockPrefab"
			| "TripleSoundLogicBlockPrefab"
			| "DoubleGuiLogicBlockPrefab"
			| "x4GuiLogicBlockPrefab";
		const blockPrefabs = Instances.waitForChild<{ readonly [k in string]: BlockModel }>(
			ReplicatedAssets.assets,
			"Prefabs",
		);
		export function fAutoCreated(prefab: PrefabName, text: string): BlockBuilder["modelSource"]["model"] {
			const createOrGet = (id: string, prefab: PrefabName, text: string): BlockModel => {
				if (RunService.IsClient()) {
					return folder[id];
				}

				const model = blockPrefabs[prefab].Clone();
				model.Name = id;

				const textInstance = model.FindFirstChildWhichIsA("TextLabel", true);
				if (textInstance) {
					textInstance.Text = text;
				}

				model.Parent = folder;
				return model;
			};

			return (block) => createOrGet(block.id, prefab, text);
		}
	}
	export namespace Category {
		export function fromAssets(block: BlockBuilder): readonly string[] {
			const assetBlock = assets.get().get(block.id);
			if (!assetBlock) throw `Block ${block.id} was not found in assets`;

			return assetBlock.category;
		}
	}
	export const Categories = {
		math: ["Logic", "Math"],
		trigonometry: ["Logic", "Math", "Trigonometry"],
		byte: ["Logic", "Math", "Byte"],
		converter: ["Logic", "Converter"],
		converterByte: ["Logic", "Converter", "Byte"],
		converterVector: ["Logic", "Converter", "Vector"],
		converterColor: ["Logic", "Converter", "Color"],
		converterUnits: ["Logic", "Converter", "Units"],
		other: ["Logic", "Other"],
		gui: ["Logic", "GUI"],
		bool: ["Logic", "Gate"],
		memory: ["Logic", "Memory"],
		sensor: ["Logic", "Sensor"],
		string: ["Logic", "String"],
		sound: ["Logic", "Sound"],
	} as const satisfies { [k in string]: BlockCategoryPath };

	export namespace MarkerPositions {
		export function fromModelFolder(block: BlockBuilder, model: BlockModel): BlockMarkerPositions {
			const pointsFolder = model.FindFirstChild("MarkerPoints");
			if (!pointsFolder) return {};

			const positions = (pointsFolder.GetChildren() as BasePart[]).mapToMap((p) =>
				$tuple(p.Name, model.GetPivot().PointToObjectSpace(p.GetPivot().Position)),
			);

			// immediately destroying the folder for some reason results in bad_weak_ptr so we delay it
			pointsFolder.Parent = undefined;
			task.delay(1, () => pointsFolder.Destroy());

			return asObject(positions);
		}
	}
	export namespace WeldRegions {
		export function fromAssetsOrAutomatic(block: BlockBuilder, model: BlockModel): BlockWeldRegions {
			return BlockWeldInitializer.initialize(block, model, "none");
		}

		export function fAutomatic(
			weldShape: AutoWeldColliderBlockShape,
		): (block: BlockBuilder, model: BlockModel) => BlockWeldRegions {
			return (block, model) => BlockWeldInitializer.initialize(block, model, weldShape);
		}
	}

	/**
	 * Where a block runs in the logic tick: the runner ticks lower values first, and blocks with equal values in the order
	 * they were added.
	 *
	 * This does not order wired logic. Reading a wired input ticks its source first, so every reader already sees its
	 * source's value from the same tick, and loops are cut at fixed registers (`LogicLoops`). What the order does decide
	 * is everything that is not a wire: values passed by events or shared state (a Radio Transmitter before or after the
	 * Receiver that hears it), and side effects that other blocks observe within the same tick.
	 *
	 * A block that sets no `logicPriority` takes its category's tier when the block list is built (`BlockListBuilder`):
	 * Sensor for the Sensor category, Output for Display and the Movement, Mechanics, Weapons and Wings actuators, and
	 * Default for everything else. A value set on the block definition always wins, Default included.
	 */
	export const priority = {
		/** Brings values in from outside the logic (sensors, inputs with no wired inputs of their own) */
		Sensor: 100,
		/** Ordinary logic */
		Default: 200,
		/** Only shows or sends a result, or acts on the world: displays, sound, actuators, transmitters */
		Output: 300,
	} as const;

	export const defaults = {
		modelSource: {
			model: Model.fromAssets,
			category: Category.fromAssets,
		},
		markerPositionsSource: MarkerPositions.fromModelFolder,
		weldRegionsSource: WeldRegions.fromAssetsOrAutomatic,
		limit: 3000 as number,
		mirror: {
			behaviour: "normal" as BlockMirrorBehaviour,
		},
		devOnly: false,
	} as const satisfies Partial<BlockBuilder>;

	export function arrayFromObject(builders: {
		readonly [k in string]: BlockBuilderWithoutIdAndDefaults;
	}): BlockBuilder[] {
		return asMap(builders).map((id, b): BlockBuilder => ({ ...BlockCreation.defaults, id, ...b }));
	}

	type DefinitionToConfig<TDef extends BlockLogicBothDefinitions> = {
		[k in keyof TDef["input"]]?: BlockConfigPart<
			(keyof BlockLogicTypes.Primitives & keyof TDef["input"][k]["types"]) | "unset" | "wire"
		>;
	};
	export function immediate<TDef extends BlockLogicBothDefinitions, T extends BlockModel>(
		definition: TDef,
		func: (block: T, config: DefinitionToConfig<TDef> | undefined) => void,
	): LogicImmediateUpdate {
		return (block) => {
			// const config = BlockConfig.addDefaults(
			// 	BlockManager.manager.config.get(block),
			// 	definition.input,
			// 	true,
			// ) as unknown as DefinitionToConfig<TDef>;

			const config = BlockManager.manager.config.get(block) as DefinitionToConfig<TDef>;
			func(block as T, config);
		};
	}

	export function defaultIfWiredUnset<T extends keyof BlockLogicTypes.Primitives>(
		item: BlockConfigPart<T> | undefined,
		def: BlockLogicTypes.Primitives[Exclude<T, "wire" | "unset">]["config"],
	): BlockLogicTypes.Primitives[Exclude<T, "wire" | "unset">]["config"] {
		if (!item || item.type === "wire" || item.type === "unset") {
			return def;
		}

		return item.config as never;
	}

	export function runImmediateFrom(model: BlockModel, blockList: BlockList) {
		const block = blockList.blocks[BlockManager.manager.id.get(model)];
		if (block) {
			runImmediate(model, block);
		}
	}
	export function runImmediate(model: BlockModel, block: Block) {
		block.logic?.immediate?.(model);
	}
}
