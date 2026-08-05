import { Players, RunService, Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { BlockManager } from "shared/building/BlockManager";
import { WeaponProjectile } from "shared/weaponProjectiles/BaseProjectileLogic";
import type { PlayModeController } from "client/modes/PlayModeController";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { SharedPlot } from "shared/building/SharedPlot";
import type { SharedPlots } from "shared/building/SharedPlots";
import type { PlayerDataStorageRemotes } from "shared/remotes/PlayerDataRemotes";
import type { ModifierValue, ProjectileModifier } from "shared/weaponProjectiles/BaseProjectileLogic";

type WeaponMarker = {
	markerInstance: BasePart;
	occupiedWith: {
		module: WeaponModule | undefined;
		block: PlacedBlockData | Block | undefined;
	};
};

type MarkerName = string;
type uuid = string;
type RecalcOut = {
	module: WeaponModule;
	extraModifier?: ProjectileModifier;
	activeOutputs: WeaponMarker[];
};

const ROTATION_ALIGNMENT_DEGREES = 5; //
const ROTATION_ALIGNMENT_COS = math.cos(math.rad(ROTATION_ALIGNMENT_DEGREES));

// Constant apart from the filter, which is rewritten per call — AddToFilter appends, so a shared params
// object has to have the list replaced rather than added to.
//temp — same exclusions, but no collision-group restriction, to tell "nothing is there" from "filtered out"
const dbgOverlapParams = new OverlapParams();
dbgOverlapParams.FilterType = Enum.RaycastFilterType.Exclude;
dbgOverlapParams.MaxParts = 12;

const moduleOverlapParams = new OverlapParams();
moduleOverlapParams.CollisionGroup = "Blocks";
moduleOverlapParams.FilterType = Enum.RaycastFilterType.Exclude;

@injectable
export class WeaponModule {
	static readonly allModules: Record<uuid, WeaponModule> = {};

	/** The registry is keyed by the uuid attribute; reading it any other way is a coincidence waiting to break. */
	static forBlock(instance: BlockModel): WeaponModule | undefined {
		return WeaponModule.allModules[BlockManager.manager.uuid.get(instance)];
	}

	readonly block: Block;
	readonly instance: BlockModel;
	readonly plot: SharedPlot;

	readonly allMarkers = new Map<MarkerName, WeaponMarker>();
	readonly markerOffsets = new Map<BasePart, CFrame>();
	private readonly dbgMarkers = new Map<MarkerName, string>(); //temp

	pregeneratedCollection: ModuleCollection = new ModuleCollection(this);
	parentCollection: ModuleCollection = this.pregeneratedCollection;

	constructor(placedBlock: PlacedBlockData, @inject blockList: BlockList, @inject plots: SharedPlots) {
		this.block = blockList.blocks[placedBlock.id]!;
		this.instance = placedBlock.instance;
		this.plot = plots.getPlotComponent(this.instance.Parent!.Parent as PlotModel);

		const fm = (placedBlock.instance.WaitForChild("moduleMarkers")?.GetChildren() ?? []) as BasePart[];
		const configMarkers = new Set();
		for (const [k, v] of pairs(this.block.weaponConfig!.markers)) {
			configMarkers.add(k);
		}

		for (const m of fm) {
			// A model carrying a marker its config never declares is a build error, but throwing takes the
			// ChildAdded handler down with it and the block never registers at all. Reporting and skipping
			// leaves the rest of the weapon working, which is how a bad input is handled elsewhere.
			if (!configMarkers.has(m.Name)) {
				$err(`Weapon marker "${m.Name}" on block '${this.block.id}' is not declared in its weaponConfig`);
				continue;
			}

			this.allMarkers.set(m.Name, {
				markerInstance: m,
				occupiedWith: {
					block: undefined,
					module: undefined,
				},
			});
		}

		// markers sit at their design offset now (build positions) — snapshot it for the ride re-pin
		const pivot = this.instance.GetPivot();
		for (const [_, o] of pairs(this.allMarkers)) {
			this.markerOffsets.set(o.markerInstance, pivot.ToObjectSpace(o.markerInstance.CFrame));
		}

		if (this.block.weaponConfig) WeaponModule.allModules[placedBlock.uuid] = this;
		this.parentCollection.init();
	}

	/**
	 * Aligns the module markers with the block instance.
	 *
	 * Unconditional rather than gated on the markers being anchored: anchoring happens in
	 * setMarkersVisibility, which only ever runs for the LOCAL owner's collections, and a client-side
	 * Anchored write does not replicate — so on every other client the old gate was false forever and the
	 * markers it exists to re-pin never moved. A marker already in place writes nothing, which is what keeps
	 * this affordable now that it runs for every module.
	 */
	repinMarkers() {
		const pivot = this.instance.GetPivot();
		for (const [_, o] of pairs(this.allMarkers)) {
			const off = this.markerOffsets.get(o.markerInstance);
			if (off === undefined) continue;

			const target = pivot.ToWorldSpace(off);
			if (o.markerInstance.CFrame === target) continue;
			o.markerInstance.PivotTo(target);
		}
	}

	getModuleMarkers() {
		const res = [];
		for (const [k, v] of pairs(this.allMarkers)) res.push(v);
		return res;
	}

	static readonly shownMarkerTransparency = 0.8;

	setOwnMarkersShown(shown: boolean) {
		for (const m of this.getModuleMarkers()) {
			m.markerInstance.Transparency = shown ? WeaponModule.shownMarkerTransparency : 1;
		}
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
		const params = moduleOverlapParams;
		params.FilterDescendantsInstances = this.instance.PrimaryPart
			? [this.instance, this.instance.PrimaryPart]
			: [this.instance];

		const allCollidedCollections: Set<ModuleCollection> = new Set();
		for (const [k, v] of pairs(configMarkers)) {
			// A config can declare a marker key that has no physical part in moduleMarkers —
			// skip it instead of indexing nil.
			const marker = foundMarkers.get(k);
			if (!marker) continue;
			const touching = Workspace.GetPartsInPart(marker.markerInstance, params);

			marker.occupiedWith.block = undefined;
			marker.occupiedWith.module = undefined;

			for (const t of touching) {
				const touchingBlock = BlockManager.getBlockDataByPart(t); //get the first one
				marker.occupiedWith.block = touchingBlock;
				if (!touchingBlock) continue;
				const mod = WeaponModule.allModules[touchingBlock.uuid];
				if (!mod || mod.plot !== this.plot) continue;
				const config = this.block.weaponConfig!.markers[k];

				//check if the id of the block is the same as allowed for this module
				if (config.allowedBlockIds === undefined) continue;
				if (config.allowedBlockIds.indexOf(mod.block.id) < 0) continue;
				marker.occupiedWith.module = mod;

				if (marker.occupiedWith.module.parentCollection !== this.parentCollection)
					allCollidedCollections.add(marker.occupiedWith.module.parentCollection);

				break;
			}

			//temp
			const touchedIds: string[] = [];
			for (const t of touching) {
				const b = BlockManager.getBlockDataByPart(t);
				if (b && !touchedIds.includes(b.id)) touchedIds.push(b.id);
			}
			dbgOverlapParams.FilterDescendantsInstances = params.FilterDescendantsInstances;
			const anything: string[] = [];
			for (const t of Workspace.GetPartsInPart(marker.markerInstance, dbgOverlapParams)) {
				anything.push(`${t.Name}:${t.CollisionGroup}`);
			}

			const off = this.instance.GetPivot().ToObjectSpace(marker.markerInstance.CFrame).Position;
			const sig = `blk=${marker.occupiedWith.block?.id ?? "-"} mod=${marker.occupiedWith.module?.block.id ?? "-"} touched=[${touchedIds.join(",")}] ANY=[${anything.join(" ")}] localOffset=(${string.format("%.2f, %.2f, %.2f", off.X, off.Y, off.Z)}) size=${string.format("%.2f", marker.markerInstance.Size.X)}`;
			if (this.dbgMarkers.get(k) !== sig) {
				this.dbgMarkers.set(k, sig);
				$log(`[wm] ${this.block.id}.${k} ${sig}`);
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
		outputs: WeaponMarker[];
		modifiers: ProjectileModifier[];
	}[] = [];

	markersFrozen = false;

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

	/**
	 * Back to holding only its own module.
	 *
	 * Collections used to merge and never separate, so two assemblies pulled apart in build mode stayed
	 * joined until one of their blocks was deleted. A rebuild resets every collection first and lets
	 * `update` re-merge from the geometry as it currently stands.
	 */
	reset() {
		this.modules.clear();
		this.emitters.clear();
		this.calculatedOutputs.clear();
		this.modules.add(this.mainModule);
		this.init();
	}

	removeModules(...another: WeaponModule[]) {
		for (const m of another) {
			m.parentCollection = m.pregeneratedCollection;
			this.modules.delete(m);
			this.emitters.delete(m);
		}
	}

	setMarkersVisibility(isVisible: boolean) {
		this.markersFrozen = !isVisible;
		isVisible = !isVisible;
		for (const m of this.modules) {
			for (const o of m.getModuleMarkers()) {
				o.markerInstance.Anchored = isVisible;
				o.markerInstance.Transparency = isVisible ? 1 : 0;
			}
		}
	}

	recursivePath(
		outputArray: RecalcOut[][],
		nextModule: WeaponModule,
		path: RecalcOut[] = [],
	): RecalcOut[] | undefined {
		//check if there's a loop
		for (const p of path) if (p.module === nextModule) return;

		const connectedModules: WeaponModule[] = [];
		const activeOutputs: WeaponMarker[] = [];

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

			// fixme: `occupiedWith.block` is set by ANY touching block, including one this marker does not
			// accept — so armour or a fairing in front of a muzzle silently disables the whole weapon, with
			// no error and no feedback. It reads to a player exactly like the chain being broken.
			if (!e.occupiedWith.block && nextModule.block.weaponConfig!.markers[n].emitsProjectiles) {
				activeOutputs.push(e);
				// print(e);
			}
		}

		const obj: RecalcOut = {
			module: nextModule,
			activeOutputs,
		};

		// print(obj.activeOutputs);
		// add modifier because outputs split, i.e. divide output between modules.
		// Both counts must be non-zero: a module whose outputs are all occupied divides by zero, and the
		// resulting `inf` rides through applyModifiers into damage, speed and lifetime alike.
		if (connectedModules.size() > 0 && activeOutputs.size() > 0) {
			const baseModifierValue: ModifierValue = { value: 1 / activeOutputs.size(), isRelative: true };
			obj.extraModifier = {
				speedModifier: baseModifierValue,
				lifetimeModifier: baseModifierValue,
				heatDamage: baseModifierValue,
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
		const paths: RecalcOut[][] = [];
		for (const e of this.emitters) this.recursivePath(paths, e);
		// print("paths:", paths);
		this.calculatedOutputs.clear();

		// Collect every UPGRADE modifier reachable from `a`, in walk order — flat list.
		// The projectile will apply them sequentially (additive vs multiplicative).
		// Memoized for the duration of this recalc: a module appears in as many paths as it has routes to an
		// emitter, and each visit re-walked the whole graph from it. The graph cannot change mid-recalc.
		const upgradeCache = new Map<WeaponModule, ProjectileModifier[]>();
		const collectUpgrades = (a: WeaponModule): ProjectileModifier[] => {
			const cached = upgradeCache.get(a);
			if (cached) return cached;

			const result: ProjectileModifier[] = [];
			const upgradePaths: RecalcOut[][] = [];
			this.recursivePath(upgradePaths, a);

			for (const upgradePath of upgradePaths) {
				for (const m of upgradePath) {
					if (m.module.block.weaponConfig?.type !== "UPGRADE") continue;
					result.push(m.module.block.weaponConfig!.modifier);
					if (m.extraModifier) result.push(m.extraModifier);
				}
			}

			upgradeCache.set(a, result);
			return result;
		};

		for (const path of paths) {
			const buf: ProjectileModifier[] = [];
			for (const p of path) {
				//if upgrade then do not iterate trough it
				if (p.module.block!.weaponConfig!.type === "UPGRADE") continue;

				// add effect from the block itself
				buf.push(p.module.block.weaponConfig!.modifier);

				// add effects from connected upgrades
				for (const u of collectUpgrades(p.module)) buf.push(u);

				//if there are no holes to shoot from then skip
				if (p.activeOutputs.size() === 0) continue;

				//otherwise add the split-ratio modifier, which a module with nothing connected never got
				if (p.extraModifier) buf.push(p.extraModifier);

				// snapshot the ordered list — buf keeps mutating for downstream modules
				this.calculatedOutputs.push({
					module: p.module,
					modifiers: [...buf],
					outputs: p.activeOutputs,
				});
			}
		}

		//temp
		const shape = paths
			.map((p) => p.map((r) => `${r.module.block.id}(${r.activeOutputs.size()})`).join("->"))
			.join(" | ");
		const sig = `emitters=${this.emitters.size()} modules=${this.modules.size()} outputs=${this.calculatedOutputs.size()} paths=${shape}`;
		if (this.dbgSig !== sig) {
			this.dbgSig = sig;
			$log(`[wm] recalc ${this.mainModule.block.id}: ${sig}`);
		}
	}

	private dbgSig?: string; //temp
}

@injectable
export class WeaponModuleSystem extends HostedService {
	constructor(
		@inject blockList: BlockList,
		@inject plots: SharedPlots,
		@inject di: DIContainer,
		// client-only services (registered in client/SandboxGame only), so a plain @inject is safe
		@inject playerData: PlayerDataStorage,
		@inject playModeController: PlayModeController,
		@inject remotes: PlayerDataStorageRemotes,
	) {
		super();

		// the projectile visibility setting, read by WeaponProjectile.shouldSpawnFor
		WeaponProjectile.playerData = playerData;

		// only the edited plot; ride-mode collections recalc themselves each frame (PostSimulation below)
		function updateAll(plot: SharedPlot) {
			for (const [_, m] of pairs(WeaponModule.allModules)) {
				if (m.plot !== plot) continue;
				if (m.parentCollection.markersFrozen) continue;
				m.update();
			}

			const arr = new Set<ModuleCollection>();
			for (const [_, m] of pairs(WeaponModule.allModules)) {
				if (m.plot !== plot) continue;
				if (m.parentCollection.markersFrozen) continue;
				arr.add(m.parentCollection);
			}
			for (const c of arr) c.recalc();
		}

		// Merging alone cannot undo itself, so a rebuild drops every collection back to its own module and
		// lets updateAll re-merge from the geometry as it now stands. Moving blocks apart otherwise left
		// them joined until one was deleted.
		function rebuildAll(plot: SharedPlot) {
			for (const [_, m] of pairs(WeaponModule.allModules)) {
				if (m.plot !== plot) continue;
				if (m.parentCollection.markersFrozen) continue;

				m.parentCollection = m.pregeneratedCollection;
				m.pregeneratedCollection.reset();
			}

			updateAll(plot);
		}

		// Moving a block has no ChildAdded/ChildRemoved, so edits are caught from the remote instead. `sent`
		// carries the batch and fires before the server applies it; `completed` fires after, but carries only
		// the response — hence deciding on the first and acting on the second.
		//
		// Only weapon blocks are worth a rebuild. A non-weapon block moved into or out of a marker also
		// changes the graph (see the fixme in recursivePath), but ride mode recalculates every frame, so the
		// staleness lasts no longer than build mode and costs nothing but marker visuals.
		let editedPlot: SharedPlot | undefined;
		this.event.subscribe(remotes.building.editBlocks.sent, ({ plot, blocks }) => {
			editedPlot = blocks.any((b) => WeaponModule.forBlock(b.instance) !== undefined)
				? plots.getPlotComponent(plot)
				: undefined;
		});
		this.event.subscribe(remotes.building.editBlocks.completed, () => {
			if (!editedPlot) return;

			rebuildAll(editedPlot);
			editedPlot = undefined;
		});

		for (const p of plots.plots) {
			const folder = p.instance.FindFirstChild("Blocks");
			if (folder === undefined) continue;

			this.event.subscribe(folder.ChildAdded, (block) => {
				const blockInfo = BlockManager.getBlockDataByBlockModel(block as BlockModel);
				if (!blockList.blocks[blockInfo.id]?.weaponConfig) return;
				const mod = di.resolveForeignClass(WeaponModule, [blockInfo]);

				// Markers default hidden (replicated) so other players never see them; reveal them
				// only on the local owner's own plot as a build-time connection guide. In ride mode
				// they're anchored+hidden again on ride enter (below); on ride→build the block
				// regenerates and re-fires ChildAdded, re-revealing them.
				if (p.ownerId.get() === Players.LocalPlayer.UserId) mod.setOwnMarkersShown(true);

				updateAll(p);
			});

			this.event.subscribe(folder.ChildRemoved, (block) => {
				const uuid = BlockManager.getBlockDataByBlockModel(block as BlockModel).uuid;
				// drop it from its collection too, or the per-frame recalc keeps walking a dead module
				WeaponModule.allModules[uuid]?.parentCollection.removeModules(WeaponModule.allModules[uuid]!);
				delete WeaponModule.allModules[uuid];
				updateAll(p);
			});
		}

		const isLocalModule = (m: WeaponModule) => m.plot.ownerId.get() === Players.LocalPlayer.UserId;

		// On ride enter, anchor+hide markers of EVERY local collection — including coreless ones (a lone
		// lens), which have no emitter block and so were never anchored before and dropped to the floor.
		this.event.subscribeObservable(playModeController.playmode, (mode) => {
			if (mode !== "ride") return;

			const seen = new Set<ModuleCollection>();
			for (const [_, m] of pairs(WeaponModule.allModules)) {
				if (!isLocalModule(m)) continue;
				if (seen.has(m.parentCollection)) continue;

				seen.add(m.parentCollection);
				m.parentCollection.setMarkersVisibility(false);
			}
		});

		const liveCollections = new Set<ModuleCollection>();
		this.event.subscribe(RunService.PostSimulation, () => {
			// An anchored part's CFrame set by a client doesn't replicate, so the owner's per-frame PivotTo
			// is local-only. EVERY client must re-pin anchored markers to its own replicated block, or
			// remote players see lasers/effects frozen at the ride-start position.
			for (const [_, m] of pairs(WeaponModule.allModules)) {
				m.repinMarkers();
			}

			// The firing graph (outputs + recalc) is computed only by the local owner while riding, live so
			// a lens/barrel added or shot off mid-ride takes effect.
			if (playModeController.get() !== "ride") return;

			liveCollections.clear();
			for (const [_, m] of pairs(WeaponModule.allModules)) {
				if (!isLocalModule(m)) continue;

				m.update();
				liveCollections.add(m.parentCollection);
			}
			for (const c of liveCollections) c.recalc();
		});
	}
}
