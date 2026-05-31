import { Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { BlockManager } from "shared/building/BlockManager";
import type { SharedPlots } from "shared/building/SharedPlots";
import type { modifierValue, projectileModifier } from "shared/weaponProjectiles/BaseProjectileLogic";

type weaponMarker = {
	markerInstance: BasePart;
	occupiedWith: {
		module: WeaponModule | undefined;
		block: PlacedBlockData | Block | undefined;
	};
};

type markerName = string;
type uuid = string;
type recalcOut = {
	module: WeaponModule;
	extraModifier?: projectileModifier;
	activeOutputs: weaponMarker[];
};

// A module counts as "aligned" with a marker when all three of its basis axes point within
// this angle of the marker's. Dot of two unit vectors >= cos(angle) ⇔ angle between <= it.
const ROTATION_ALIGNMENT_DEGREES = 5;
const ROTATION_ALIGNMENT_COS = math.cos(math.rad(ROTATION_ALIGNMENT_DEGREES));

export class WeaponModule {
	static readonly allModules: Record<uuid, WeaponModule> = {};
	readonly block: Block;
	readonly instance: BlockModel;

	readonly allMarkers = new Map<markerName, weaponMarker>();

	pregeneratedCollection: ModuleCollection = new ModuleCollection(this);
	parentCollection: ModuleCollection = this.pregeneratedCollection;

	constructor(
		placedBlock: PlacedBlockData,
		private readonly blockList: BlockList,
	) {
		this.block = blockList.blocks[placedBlock.id]!;
		this.instance = placedBlock.instance;

		const fm = (placedBlock.instance.WaitForChild("moduleMarkers")?.GetChildren() ?? []) as BasePart[];
		const configMarkers = new Set();
		for (const [k, v] of pairs(this.block.weaponConfig!.markers)) {
			configMarkers.add(k);
		}

		for (const m of fm) {
			if (!configMarkers.has(m.Name)) throw `Weapon marker "${m.Name}" not found`;
			this.allMarkers.set(m.Name, {
				markerInstance: m,
				occupiedWith: {
					block: undefined,
					module: undefined,
				},
			});
		}

		if (this.block.weaponConfig) WeaponModule.allModules[placedBlock.uuid] = this;
		this.parentCollection.init();
	}

	getModuleMarkers() {
		const res = [];
		for (const [k, v] of pairs(this.allMarkers)) res.push(v);
		return res;
	}

	update() {
		//get all colided marker touches with
		//iterate through the touched parts
		//	if occupiedWithBlock !== undefined
		//	if a block
		//	if the same type
		//	set module
		const foundMarkers = this.allMarkers;
		const configMarkers = this.block.weaponConfig!.markers;
		const params = new OverlapParams();
		params.CollisionGroup = "Blocks";
		params.FilterType = Enum.RaycastFilterType.Exclude;
		params.AddToFilter(this.instance);
		if (this.instance.PrimaryPart) params.AddToFilter(this.instance.PrimaryPart);

		const allCollidedCollections: Set<ModuleCollection> = new Set();
		for (const [k, v] of pairs(configMarkers)) {
			const marker = foundMarkers.get(k)!;
			const touching = Workspace.GetPartsInPart(marker.markerInstance, params);

			marker.occupiedWith.block = undefined;
			marker.occupiedWith.module = undefined;

			for (const t of touching) {
				const touchingBlock = BlockManager.getBlockDataByPart(t); //get the first one
				marker.occupiedWith.block = touchingBlock;
				if (!touchingBlock) continue;
				const mod = WeaponModule.allModules[touchingBlock.uuid];
				if (!mod) continue;
				const config = this.block.weaponConfig!.markers[k];

				//check if the id of the block is the same as allowed for this module
				if (config.allowedBlockIds === undefined) continue;
				if (config.allowedBlockIds.indexOf(mod.block.id) < 0) continue;
				marker.occupiedWith.module = mod;

				if (marker.occupiedWith.module.parentCollection !== this.parentCollection)
					allCollidedCollections.add(marker.occupiedWith.module.parentCollection);

				break;
			}
		}

		this.parentCollection.combineWithModuleCollections(...allCollidedCollections);
	}
}

export class ModuleCollection {
	readonly modules: Set<WeaponModule> = new Set();
	readonly emitters: Set<WeaponModule> = new Set();
	readonly calculatedOutputs: {
		module: WeaponModule;
		outputs: weaponMarker[];
		modifiers: projectileModifier[];
	}[] = [];

	constructor(readonly mainModule: WeaponModule) {
		this.modules.add(mainModule);
	}

	init() {
		if (this.mainModule.block.weaponConfig!.type === "CORE") this.emitters.add(this.mainModule);
	}

	combineWithModules(...another: WeaponModule[]) {
		const parentCollections = new Set<ModuleCollection>();
		for (const k of another) parentCollections.add(k.parentCollection);

		this.combineWithModuleCollections(...parentCollections);
	}

	combineWithModuleCollections(...collections: ModuleCollection[]) {
		for (const c of collections) {
			if (c === this) continue;
			for (const k of c.modules) {
				k.parentCollection = this;
				this.modules.add(k);
				if (k.block.weaponConfig!.type === "CORE") this.emitters.add(k);
			}
		}
	}

	removeModules(...another: WeaponModule[]) {
		for (const m of another) {
			m.parentCollection = m.pregeneratedCollection;
			this.modules.delete(m);
			this.emitters.delete(m);
		}
	}

	setMarkersVisibility(isVisible: boolean) {
		isVisible = !isVisible;
		for (const m of this.modules) {
			for (const o of m.getModuleMarkers()) {
				o.markerInstance.Anchored = isVisible;
				o.markerInstance.Transparency = isVisible ? 1 : 0;
			}
		}
	}

	recursivePath(
		outputArray: recalcOut[][],
		nextModule: WeaponModule,
		path: recalcOut[] = [],
	): recalcOut[] | undefined {
		//check if there's a loop
		for (const p of path) if (p.module === nextModule) return;

		const connectedModules: WeaponModule[] = [];
		const activeOutputs: weaponMarker[] = [];

		//get all markers
		for (const [n, e] of pairs(nextModule.allMarkers)) {
			if (e.occupiedWith.module) {
				// Compare orientations via basis-vector dot products rather than Euler angles —
				// Euler subtraction is wrong across the ±180° wrap and near gimbal lock, which
				// gave false mismatches on otherwise-aligned modules.
				const markerCf = e.markerInstance.GetPivot();
				const moduleCf = e.occupiedWith.module.instance.GetPivot();

				if (
					markerCf.RightVector.Dot(moduleCf.RightVector) >= ROTATION_ALIGNMENT_COS &&
					markerCf.UpVector.Dot(moduleCf.UpVector) >= ROTATION_ALIGNMENT_COS &&
					markerCf.LookVector.Dot(moduleCf.LookVector) >= ROTATION_ALIGNMENT_COS
				)
					connectedModules.push(e.occupiedWith.module);

				continue;
			}

			if (!e.occupiedWith.block && nextModule.block.weaponConfig!.markers[n].emitsProjectiles) {
				activeOutputs.push(e);
				// print(e);
			}
		}

		const obj: recalcOut = {
			module: nextModule,
			activeOutputs,
		};

		// print(obj.activeOutputs);
		// add modifier because outputs split, i.e. divide output between modules
		if (connectedModules.size() > 0) {
			const baseModifierValue: modifierValue = { value: 1 / activeOutputs.size(), isRelative: true };
			obj.extraModifier = {
				speedModifier: baseModifierValue,
				lifetimeModifier: baseModifierValue,
				heatDamage: baseModifierValue,
				impactDamage: baseModifierValue,
				explosiveDamage: baseModifierValue,
			};
		}

		//if size === 0 then there's only one block
		// therefore just stop iterations on it
		if (path.size() + connectedModules.size() === 0) {
			outputArray.push([obj]);
			return;
		}
		// print(path);
		//just add last module to the path at this point
		path.push(obj);

		//if there are modules attached to the markers
		if (connectedModules.size() === 0) return path;

		for (const e of connectedModules) {
			const p = this.recursivePath(outputArray, e, [...path]);
			if (!p) continue;
			outputArray.push(p);
		}
		return;
	}

	recalc() {
		const paths: recalcOut[][] = [];
		for (const e of this.emitters) this.recursivePath(paths, e);
		// print("paths:", paths);
		this.calculatedOutputs.clear();

		// Collect every UPGRADE modifier reachable from `a`, in walk order — flat list.
		// The projectile will apply them sequentially (additive vs multiplicative).
		const collectUpgrades = (a: WeaponModule): projectileModifier[] => {
			const result: projectileModifier[] = [];
			const upgradePaths: recalcOut[][] = [];
			this.recursivePath(upgradePaths, a);

			for (const upgradePath of upgradePaths) {
				for (const m of upgradePath) {
					if (m.module.block.weaponConfig?.type !== "UPGRADE") continue;
					result.push(m.module.block.weaponConfig!.modifier);
					if (m.extraModifier) result.push(m.extraModifier);
				}
			}

			return result;
		};

		for (const path of paths) {
			const buf: projectileModifier[] = [];
			for (const p of path) {
				//if upgrade then do not iterate trough it
				if (p.module.block!.weaponConfig!.type === "UPGRADE") continue;

				// add effect from the block itself
				buf.push(p.module.block.weaponConfig!.modifier);

				// add effects from connected upgrades
				for (const u of collectUpgrades(p.module)) buf.push(u);

				//if there are no holes to shoot from then skip
				if (p.activeOutputs.size() === 0) continue;

				//otherwise add the split-ratio modifier
				buf.push(p.extraModifier!);

				// snapshot the ordered list — buf keeps mutating for downstream modules
				this.calculatedOutputs.push({
					module: p.module,
					modifiers: [...buf],
					outputs: p.activeOutputs,
				});
			}
		}
	}
}

@injectable
export class WeaponModuleSystem extends HostedService {
	constructor(@inject blockList: BlockList, @inject plots: SharedPlots) {
		super();

		function updateAll() {
			for (const [_, m] of pairs(WeaponModule.allModules)) m.update();

			const arr = new Set<ModuleCollection>();
			for (const [_, m] of pairs(WeaponModule.allModules)) {
				arr.add(m.parentCollection);
			}
			for (const c of arr) c.recalc();
		}

		for (const p of plots.plots) {
			const folder = p.instance.FindFirstChild("Blocks");
			if (folder === undefined) continue;

			this.event.subscribe(folder.ChildAdded, (block) => {
				const blockInfo = BlockManager.getBlockDataByBlockModel(block as BlockModel);
				if (!blockList.blocks[blockInfo.id]?.weaponConfig) return;
				new WeaponModule(blockInfo, blockList);
				updateAll();
			});

			this.event.subscribe(folder.ChildRemoved, (block) => {
				delete WeaponModule.allModules[BlockManager.getBlockDataByBlockModel(block as BlockModel).uuid];
				updateAll();
			});
		}
	}
}
