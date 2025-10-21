import { HttpService, Workspace } from "@rbxts/services";
import { MaterialColorEditControl } from "client/gui/buildmode/MaterialColorEditControl";
import { LogControl } from "client/gui/static/LogControl";
import { BlockEditor } from "client/tools/additional/BlockEditor";
import { BlockGhoster } from "client/tools/additional/BlockGhoster";
import { MultiBlockHighlightedSelector } from "client/tools/highlighters/MultiBlockHighlightedSelector";
import { SelectedBlocksHighlighter } from "client/tools/highlighters/SelectedBlocksHighlighter";
import { ToolBase } from "client/tools/ToolBase";
import { Action } from "engine/client/Action";
import { Keybinds } from "engine/client/Keybinds";
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ComponentDisabler } from "engine/shared/component/ComponentDisabler";
import { Element } from "engine/shared/Element";
import { ObservableCollectionSet } from "engine/shared/event/ObservableCollection";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { BB } from "engine/shared/fixes/BB";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { BuildingManager } from "shared/building/BuildingManager";
import { SharedBuilding } from "shared/building/SharedBuilding";
import { Colors } from "shared/Colors";
import { PartUtils } from "shared/utils/PartUtils";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { ActionController } from "client/modes/build/ActionController";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ClientBuilding, ClientBuildingTypes } from "client/modes/build/ClientBuilding";
import type { Theme } from "client/Theme";
import type { SharedPlot } from "shared/building/SharedPlot";

const placeToBlockRequest = (block: BlockModel): PlaceBlockRequestWithUuid => {
	const data = BlockManager.getBlockDataByBlockModel(block);

	return {
		...data,
		location: data.instance.GetPivot(),
		["instance" as never]: undefined,
	};
};
const placeToBlocksRequests = (blocks: readonly BlockModel[]): readonly PlaceBlockRequestWithUuid[] => {
	return blocks.map(placeToBlockRequest);
};

type PlaceBlockRequestWithUuid = PlaceBlockRequest & { readonly uuid: BlockUuid };
const reGenerateUuids = (
	plot: SharedPlot,
	_blocks: readonly PlaceBlockRequestWithUuid[],
): readonly PlaceBlockRequestWithUuid[] => {
	const existingBlocks = new Map<BlockUuid, PlaceBlockRequestWithUuid>();
	for (const block of _blocks) {
		existingBlocks.set(block.uuid, block);
	}

	// <old, new>
	const uuidmap = new Map<BlockUuid, Writable<PlaceBlockRequestWithUuid>>();

	const newblocks = existingBlocks.map((_, data): Writable<PlaceBlockRequestWithUuid> => {
		const request = { ...data, uuid: HttpService.GenerateGUID(false) as BlockUuid };
		uuidmap.set(data.uuid, request);

		return request;
	});

	const plotBlocks = plot.getBlocks().mapToSet(BlockManager.manager.uuid.get);

	for (const [olduuid, newblock] of uuidmap) {
		const uc = () => {
			const config = existingBlocks.get(olduuid)?.config;
			if (!config) return;

			const keysToDelete: string[] = [];
			for (const [key, cfg] of [...asMap(config)]) {
				if (cfg.type !== "wire") continue;
				const connection = cfg.config;

				if (!plotBlocks.has(connection.blockUuid) && !uuidmap.has(connection.blockUuid)) {
					$log(
						`Deleting a nonexistent connection ${olduuid} ${key} -> ${connection.blockUuid} ${connection.connectionName}`,
					);

					keysToDelete.push(key);
				}
			}

			const keysToChange = new Map<string, BlockUuid>();
			for (const [key, cfg] of pairs(config)) {
				if (cfg.type !== "wire") continue;
				if (keysToDelete.includes(key)) continue;
				const connection = cfg.config;

				const neww = uuidmap.get(connection.blockUuid);
				if (!neww) continue;

				$log(
					`Rerouting a connection ${olduuid} ${key} -> ${connection.blockUuid} ${connection.connectionName}`,
				);
				keysToChange.set(key, neww.uuid);
			}

			const copy: Writable<typeof config> = {};
			for (const [key, cfg] of pairs(config)) {
				if (cfg.type !== "wire") {
					copy[key] = cfg;
					continue;
				}

				if (keysToDelete.includes(key)) {
					continue;
				}

				const keyToChange = keysToChange.get(key);
				if (keyToChange) {
					copy[key] = { ...cfg, config: { ...cfg.config, blockUuid: keyToChange } };
					continue;
				}

				copy[key] = cfg;
			}

			newblock.config = copy;
		};
		uc();

		const uw = () => {
			const welds = existingBlocks.get(olduuid)?.welds;
			if (!welds) return;

			const newWelds: BlockWeld[] = [];
			for (const weld of welds) {
				const neww = uuidmap.get(weld.otherUuid);
				if (!neww) {
					newWelds.push(weld);
					continue;
				}

				$log(`Rerouting a weld at [${olduuid}] ${weld.otherUuid} -> ${neww.uuid}`);
				newWelds.push({ ...weld, otherUuid: neww.uuid });
			}

			newblock.welds = newWelds;
		};
		uw();
	}

	return newblocks;
};

namespace Controllers {
	@injectable
	export class Edit extends Component {
		private submitted = false;
		private readonly editor: BlockEditor;

		constructor(
			tool: EditTool,
			private readonly plot: SharedPlot,
			selected: readonly BlockModel[],
			startMode: "move" | "rotate" | "scale",
			@inject private readonly clientBuilding: ClientBuilding,
			@inject private readonly blockList: BlockList,
			@inject di: DIContainer,
		) {
			super();
			this.editor = this.parent(
				di.resolveForeignClass(BlockEditor, [
					[...selected],
					startMode,
					plot.boundingBox,
					tool.mode.editMode.get(),
				]),
			);
			this.editor.initializeGrids({
				moveGrid: tool.mode.moveGrid,
				rotateGrid: tool.mode.rotateGrid,
				scaleGrid: tool.mode.moveGrid,
			});

			this.event.subscribe(this.editor.completed, () => this.destroy());
			this.onDestroy(() => this.submit(true));
		}

		private submit(skipIfSame = true) {
			if (this.submitted) return;
			this.submitted = true;

			if (this.editor.errors.size() > 0) {
				for (const err of this.editor.errors.get()) {
					LogControl.instance.addLine(err, Colors.red);
				}

				this.cancel();
				return;
			}

			const update = this.editor.getUpdate();

			if (skipIfSame) {
				for (const block of update) {
					if (block.newPosition && block.newPosition !== block.origPosition) continue;
					if (block.origScale && block.newScale && block.newScale !== block.origScale) continue;

					return;
				}
			}

			const response = this.clientBuilding.editOperation.execute({
				plot: this.plot,
				blocks: update,
			});
			if (!response.success) {
				LogControl.instance.addLine(response.message, Colors.red);
				this.cancel();
			}

			for (const block of update) {
				BlockCreation.runImmediateFrom(block.instance, this.blockList);
			}

			return response.success;
		}

		deselected() {
			this.submit(false);
		}
		cancel() {
			this.submitted = true;
			this.editor.cancel();
		}
	}

	@injectable
	export class Paste extends Component {
		private readonly blocksRequests;
		private readonly blocks;
		private readonly editor;
		private submitted = false;

		constructor(
			private readonly tool: EditTool,
			private readonly plot: SharedPlot,
			selected: readonly BlockModel[],
			@inject blockList: BlockList,
			@inject keybinds: Keybinds,
			@inject private readonly clientBuilding: ClientBuilding,
			@inject di: DIContainer,
		) {
			super();

			const ghostParent = Element.create(
				"Model",
				{ Parent: Workspace },
				{ highlight: BlockGhoster.createHighlight({ FillColor: Colors.blue }) },
			);
			this.onDestroy(() => task.delay(0.1, () => ghostParent.Destroy()));

			const blocks = reGenerateUuids(plot, tool.copied.get());
			this.blocksRequests = blocks;
			this.blocks = blocks.map((block) => {
				const b = blockList.blocks[block.id]!.model.Clone();
				BlockManager.manager.id.set(b, block.id);
				BlockManager.manager.uuid.set(b, block.uuid);
				BlockManager.manager.scale.set(b, block.scale);
				b.PivotTo(block.location);
				SharedBuilding.scale(b, blockList.blocks[block.id]!.model, block.scale);

				PartUtils.ghostModel(b, Colors.blue);
				b.Parent = ghostParent;

				return b;
			});

			const commitAction = this.parent(
				new Action(() => {
					this.submit();
					this.destroy();
				}),
			);
			commitAction.initKeybind(keybinds.fromDefinition(editKeybinds.paste));

			this.editor = this.parent(
				di.resolveForeignClass(BlockEditor, [this.blocks, "move", plot.boundingBox, tool.mode.editMode.get()]),
			);
			this.editor.initializeGrids({
				moveGrid: tool.mode.moveGrid,
				rotateGrid: tool.mode.rotateGrid,
				scaleGrid: tool.mode.moveGrid,
			});

			this.event.subscribe(this.editor.completed, (state) => {
				if (state === "cancelled") {
					this.cancel();
					this.destroy();
					return;
				}

				this.submit();
				this.destroy();
			});
			this.onDestroy(() => this.submit());
		}

		private submit() {
			if (this.submitted) return;
			this.submitted = true;

			if (this.editor.errors.size() > 0) {
				for (const err of this.editor.errors.get()) {
					LogControl.instance.addLine(err, Colors.red);
				}

				this.cancel();
				return;
			}

			const update = this.editor.getUpdate();

			const updateMap = update.mapToMap((u) => $tuple(BlockManager.manager.uuid.get(u.instance), u));

			const response = this.clientBuilding.placeOperation.execute({
				plot: this.plot,
				blocks: this.blocksRequests.map((b) => ({
					...b,
					location: updateMap.get(b.uuid)?.newPosition ?? b.location,
					scale: updateMap.get(b.uuid)?.newScale ?? b.scale,
				})),
			});
			if (!response.success) {
				LogControl.instance.addLine(response.message, Colors.red);
				this.cancel();
			} else {
				if (this.tool.isEnabled()) {
					this.tool.selected.setRange(response.models);
				}
			}

			return response.success;
		}

		deselected() {
			this.submit();
		}
		cancel() {
			this.submitted = true;
			this.editor.cancel();
			for (const block of this.blocks) {
				block.Destroy();
			}
		}
	}

	@injectable
	export class Paint extends Component {
		private static readonly material = new ObservableValue<Enum.Material>(Enum.Material.Plastic);
		private static readonly color = new ObservableValue<Color4>({ color: new Color3(1, 1, 1), alpha: 1 });
		private readonly origData: ReadonlyMap<
			BlockModel,
			{ readonly material: Enum.Material; readonly color: Color4 }
		>;
		private canceled = false;

		constructor(
			tool: EditTool,
			plot: SharedPlot,
			blocks: readonly BlockModel[],
			@inject mainScreen: MainScreenLayout,
			@inject private readonly clientBuilding: ClientBuilding,
		) {
			super();

			this.origData = new ReadonlyMap(
				blocks.map(
					(b) =>
						[
							b,
							{
								material: BlockManager.manager.material.get(b),
								color: BlockManager.manager.color.get(b),
							},
						] as const,
				),
			);

			const confirmLayer = this.parentGui(mainScreen.bottom.push());
			confirmLayer
				.addButton("Confirm", undefined, "buttonPositive") //
				.addButtonAction(() => this.destroy());
			confirmLayer
				.addButton("Cancel", undefined, "buttonNegative") //
				.addButtonAction(() => {
					this.cancel();
					this.destroy();
				});

			const layer = this.parentGui(mainScreen.bottom.push());
			const materialColorEditor = layer.parent(MaterialColorEditControl.autoCreate(true));
			materialColorEditor.autoSubscribe(Paint.material, Paint.color);

			this.event.subscribeObservable(
				Paint.material,
				(material) => {
					for (const block of blocks) {
						SharedBuilding.paint([block], undefined, material);
					}
				},
				true,
			);
			this.event.subscribeObservable(
				Paint.color,
				(color) => {
					for (const block of blocks) {
						SharedBuilding.paint([block], color, undefined);
					}
				},
				true,
			);

			this.onDestroy(() => {
				if (this.canceled) return;

				const response = this.clientBuilding.paintOperation.execute({
					plot,
					blocks,
					material: Paint.material.get(),
					color: Paint.color.get(),
					original: this.origData,
				});
				if (!response.success) {
					LogControl.instance.addLine(response.message, Colors.red);
					this.cancel();
				}

				return response.success;
			});
		}

		cancel() {
			this.canceled = true;

			for (const [block, { material, color }] of this.origData) {
				SharedBuilding.paint([block], color, material);
			}
		}
	}

	@injectable
	export class Collide extends Component {
		private readonly origData: ReadonlyMap<BlockModel, boolean>;
		private canceled = false;

		constructor(
			tool: EditTool,
			plot: SharedPlot,
			blocks: readonly BlockModel[],
			@inject mainScreen: MainScreenLayout,
			@inject private readonly clientBuilding: ClientBuilding,
			@inject theme: Theme,
		) {
			super();

			this.origData = blocks.mapToMap((b) => $tuple(b, BlockManager.manager.collidable.get(b) ?? true));

			const confirmLayer = this.parentGui(mainScreen.bottom.push());
			confirmLayer
				.addButton("Confirm", undefined, "buttonPositive") //
				.addButtonAction(() => this.destroy());
			confirmLayer
				.addButton("Cancel", undefined, "buttonNegative") //
				.addButtonAction(() => {
					this.cancel();
					this.destroy();
				});

			const collidable = new ObservableValue(true);

			const layer = this.parentGui(mainScreen.bottom.push());
			const btn = layer
				.addButton("Collision", undefined, "buttonPositive") //
				.addButtonAction(() => collidable.toggle());
			collidable.subscribe((e) => btn.themeButton(theme, e ? "buttonPositive" : "buttonNegative"));

			this.event.subscribeObservable(
				collidable,
				(collidable) => {
					for (const block of blocks) {
						SharedBuilding.recollide(block, collidable);
					}
				},
				true,
			);

			this.onDestroy(() => {
				if (this.canceled) return;

				const response = this.clientBuilding.recollideOperation.execute({
					plot,
					datas: blocks.map((b): ClientBuildingTypes.RecollideArgs["datas"][number] => ({
						uuid: BlockManager.manager.uuid.get(b),
						enabled: collidable.get(),
					})),
				});
				if (!response.success) {
					LogControl.instance.addLine(response.message, Colors.red);
					this.cancel();
				}

				return response.success;
			});
		}

		cancel() {
			this.canceled = true;

			for (const [block, collidable] of this.origData) {
				SharedBuilding.recollide(block, collidable);
			}
		}
	}
}

export type EditToolMode = "Move" | "Paste" | "Scale" | "Rotate" | "Paint";
export type EditToolButtons = EditToolMode | "Copy" | "Delete" | "MirrorX" | "MirrorY" | "MirrorZ";

const editKeybinds = {
	...BlockEditor.keybinds,
	delete: Keybinds.registerDefinition("edit_delete", ["Edit tool", "Delete"], [["T"]]),
	paint: Keybinds.registerDefinition("edit_paint", ["Edit tool", "Paint"], [["G"]]),
	copy: Keybinds.registerDefinition("edit_copy", ["Edit tool", "Copy"], [["C"]]),
	paste: Keybinds.registerDefinition("edit_paste", ["Edit tool", "Paste"], [["V"]]),
	mirrorX: Keybinds.registerDefinition("edit_mirrorX", ["Edit tool", "Mirror X"], [["I"]]),
	mirrorY: Keybinds.registerDefinition("edit_mirrorY", ["Edit tool", "Mirror Y"], [["K"]]),
	mirrorZ: Keybinds.registerDefinition("edit_mirrorZ", ["Edit tool", "Mirror Z"], [["M"]]),
} as const;

@injectable
export class EditTool extends ToolBase {
	readonly enabledModes = new ComponentDisabler<EditToolButtons>();

	readonly selected = new ObservableCollectionSet<BlockModel>();
	readonly copied = new ObservableValue<readonly PlaceBlockRequestWithUuid[]>([]);
	private readonly controller = this.parent(
		new ComponentChild<Component & { cancel(): void } & ({} | { deselected(): void })>(true),
	);

	constructor(
		@inject readonly mode: BuildingMode,
		@inject private readonly blockList: BlockList,
		@inject keybinds: Keybinds,
		@inject private readonly actionController: ActionController,
		@inject mainScreen: MainScreenLayout,
		@inject private readonly clientBuilding: ClientBuilding,
		@inject private readonly di: DIContainer,
	) {
		super(mode);

		this.parent(di.resolveForeignClass(SelectedBlocksHighlighter, [this.selected]));
		const selector = this.parent(
			new MultiBlockHighlightedSelector(this.targetPlot, this.selected, undefined, keybinds),
		);
		this.controller.childSet.Connect((child) => selector.setEnabled(!child));
		this.onDisable(() => this.selected.clear());

		const startEdit = (mode: "move" | "rotate" | "scale") => {
			this.controller.set(
				di.resolveForeignClass(Controllers.Edit, [this, this.targetPlot.get(), [...this.selected.get()], mode]),
			);
		};

		const actions = {
			move: this.parent(new Action(() => startEdit("move"))),
			rotate: this.parent(new Action(() => startEdit("rotate"))),
			scale: this.parent(new Action(() => startEdit("scale"))),

			copy: this.parent(new Action(() => this.copySelectedBlocks())),
			paste: this.parent(new Action(() => this.paste())),
			paint: this.parent(new Action(() => this.paint())),
			delete: this.parent(new Action(() => this.deleteSelectedBlocks())),
			recollide: this.parent(new Action(() => this.recollide())),

			mirrorX: this.parent(new Action(() => this.mirrorSelectedBlocks("x"))),
			mirrorY: this.parent(new Action(() => this.mirrorSelectedBlocks("y"))),
			mirrorZ: this.parent(new Action(() => this.mirrorSelectedBlocks("z"))),
		} as const;

		for (const [k, action] of pairs(actions)) {
			if (k in editKeybinds) {
				action.initKeybind(keybinds.fromDefinition(editKeybinds[k as never]));
			}
		}

		const someBlocksSelected = this.selected.createBased((blocks) => blocks.size() !== 0);
		const hasCopiedBlocks = this.copied.createBased((blocks) => blocks.size() !== 0);
		const noControler = new ObservableValue(true);
		this.controller.childSet.Connect((child) => noControler.set(!child));

		actions.move.subCanExecuteFrom({ noControler, someBlocksSelected });
		actions.rotate.subCanExecuteFrom({ noControler, someBlocksSelected });
		actions.scale.subCanExecuteFrom({ noControler, someBlocksSelected });

		actions.copy.subCanExecuteFrom({ noControler, someBlocksSelected });
		actions.paste.subCanExecuteFrom({ noControler, hasCopiedBlocks });
		actions.paint.subCanExecuteFrom({ noControler, someBlocksSelected });
		actions.delete.subCanExecuteFrom({ noControler, someBlocksSelected });
		actions.recollide.subCanExecuteFrom({ noControler, someBlocksSelected });

		actions.mirrorX.subCanExecuteFrom({ noControler, someBlocksSelected });
		actions.mirrorY.subCanExecuteFrom({ noControler, someBlocksSelected });
		actions.mirrorZ.subCanExecuteFrom({ noControler, someBlocksSelected });

		{
			this.parentGui(mainScreen.right.push("SELECT ALL")) //
				.addButtonAction(() => this.selected.setRange(this.targetPlot.get().getBlocks()));

			this.parentGui(mainScreen.right.push("DESELECT ALL")) //
				.addButtonAction(() => this.selected.clear());
		}

		{
			const layer = this.parentGui(mainScreen.bottom.push());
			noControler.subscribe((nc) => layer.setVisibleAndEnabled(nc));

			layer.addButton("paint", "15895846447").subscribeToAction(actions.paint);
			layer.addButton("copy", "18369509575").subscribeToAction(actions.copy);
			layer.addButton("paste", "18369509575").subscribeToAction(actions.paste);
			layer.addButton("delete", "12539349041", "buttonNegative").subscribeToAction(actions.delete);
			layer.addButton("collider", "131288038500406").subscribeToAction(actions.recollide);
		}

		{
			const layer = this.parentGui(mainScreen.bottom.push());
			noControler.subscribe((nc) => layer.setVisibleAndEnabled(nc));

			layer
				.addButton("move", "18369400240")
				.initializeSimpleTransform("BackgroundColor3")
				.subscribeToAction(actions.move);
			layer
				.addButton("rotate", "18369417777")
				.initializeSimpleTransform("BackgroundColor3")
				.subscribeToAction(actions.rotate);
			layer
				.addButton("scale", "89349384867990")
				.initializeSimpleTransform("BackgroundColor3")
				.subscribeToAction(actions.scale);
		}

		{
			const layer = this.parentGui(mainScreen.top.push());
			noControler.subscribe((nc) => layer.setVisibleAndEnabled(nc));

			layer
				.addButton("mirror X", { kind: "bottom", text: "MIRROR X", iconId: 16686412951 })
				.subscribeToAction(actions.mirrorX);
			layer
				.addButton("mirror Y", { kind: "bottom", text: "MIRROR Y", iconId: 16686412951 })
				.subscribeToAction(actions.mirrorY);
			layer
				.addButton("mirror Z", { kind: "bottom", text: "MIRROR Z", iconId: 16686412951 })
				.subscribeToAction(actions.mirrorZ);
		}

		this.controller.childSet.Connect((child) => {
			actionController.undoAction.canExecute.and("editTool_modeSelected", !child);
			actionController.redoAction.canExecute.and("editTool_modeSelected", !child);
		});
	}

	private paste() {
		this.controller.set(
			this.di.resolveForeignClass(Controllers.Paste, [this, this.targetPlot.get(), [...this.selected.get()]]),
		);
	}
	private paint() {
		this.controller.set(
			this.di.resolveForeignClass(Controllers.Paint, [this, this.targetPlot.get(), [...this.selected.get()]]),
		);
	}
	private recollide() {
		this.controller.set(
			this.di.resolveForeignClass(Controllers.Collide, [this, this.targetPlot.get(), [...this.selected.get()]]),
		);
	}
	private copySelectedBlocks() {
		this.copied.set(placeToBlocksRequests([...this.selected.get()]));
	}
	private deleteSelectedBlocks() {
		const selected = [...this.selected.get()];
		this.selected.setRange([]);

		this.clientBuilding.deleteOperation.execute({ plot: this.targetPlot.get(), blocks: selected });
	}
	mirrorSelectedBlocks(axis: "x" | "y" | "z") {
		const selected = [...this.selected.get()];
		this.selected.setRange([]);

		const center = BB.fromModels(
			selected,
			this.mode.editMode.get() === "local" ? undefined : CFrame.identity,
		).center;
		const mirrored = selected.map((s): PlaceBlockRequest => {
			const mirrored = BuildingManager.getMirroredBlocks(
				center,
				{
					id: BlockManager.manager.id.get(s),
					pos: s.GetPivot(),
					scale: BlockManager.manager.scale.get(s) ?? Vector3.one,
				},
				{
					x: axis === "x" ? 0 : undefined,
					y: axis === "y" ? 0 : undefined,
					z: axis === "z" ? 0 : undefined,
				},
				this.blockList,
				false,
			);

			return {
				...placeToBlockRequest(s),
				location: mirrored[0].pos,
				id: mirrored[0].id,
				scale: mirrored[0].scale,
			};
		});

		this.actionController.startCombineStack("Mirroring blocks");

		this.clientBuilding.deleteOperation.execute({ plot: this.targetPlot.get(), blocks: selected });
		task.wait();
		this.clientBuilding.placeOperation.execute({ plot: this.targetPlot.get(), blocks: mirrored });

		this.actionController.endCombineStack();
	}

	getDisplayName(): string {
		return "Editing";
	}

	getImageID(): string {
		return "rbxassetid://12539306575";
	}
}
