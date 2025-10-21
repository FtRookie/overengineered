import { Workspace, Players, RunService } from "@rbxts/services";
import { LoadingController } from "client/controller/LoadingController";
import { ConfirmPopup } from "client/gui/popup/ConfirmPopup";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { Component } from "engine/shared/component/Component";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { Element } from "engine/shared/Element";
import { ArgsSignal, Signal } from "engine/shared/event/Signal";
import { Objects } from "engine/shared/fixes/Objects";
import { Localization } from "engine/shared/Localization";
import { BlockConfig } from "shared/blockLogic/BlockConfig";
import { BlockManager } from "shared/building/BlockManager";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import { BuildingPlot } from "shared/building/BuildingPlot";
import { Colors } from "shared/Colors";
import { CustomRemotes } from "shared/Remotes";
import { PartUtils } from "shared/utils/PartUtils";
import { VectorUtils } from "shared/utils/VectorUtils";
import type { PopupController } from "client/gui/PopupController";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ClientBuilding } from "client/modes/build/ClientBuilding";
import type { ClientBuildingTypes } from "client/modes/build/ClientBuilding";
import type { BuildTool } from "client/tools/BuildTool";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type { LatestSerializedBlock, LatestSerializedBlocks } from "shared/building/BlocksSerializer";
import type { BuildingDiffChange, DiffBlock } from "shared/building/BuildingDiffer";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";
import type { SharedPlot } from "shared/building/SharedPlot";

@injectable
export class TutorialPlot extends Component {
	private readonly instance: Folder;
	private readonly plot: BuildingPlot;
	private readonly actualPlot: ReadonlyPlot;

	constructor(
		plot: ReadonlyPlot,
		@inject private readonly blockList: BlockList,
	) {
		super();

		this.actualPlot = plot;

		this.instance = new Instance("Folder");
		this.instance.Name = "TutorialPreview";
		this.instance.Parent = Workspace;
		ComponentInstance.init(this, this.instance);

		this.plot = new BuildingPlot(this.instance, plot.origin, plot.boundingBox, blockList);
	}

	build(blocks: LatestSerializedBlocks) {
		BlocksSerializer.deserializeFromObject(blocks, this.plot, this.blockList);

		for (const block of this.plot.getBlocks()) {
			PartUtils.ghostModel(block, Colors.white);

			Element.create("SelectionBox", {
				Color3: Color3.fromRGB(0, 255, 255),
				LineThickness: 0.05,
				Adornee: block,
				Parent: block,
			});
		}
	}
	remove(uuid: BlockUuid) {
		this.plot.getBlock(uuid).Destroy();
	}

	highlight(uuids: readonly BlockUuid[]): SignalConnection {
		const highlights: Instance[] = [];

		for (const uuid of uuids) {
			const block = this.actualPlot.getBlock(uuid);

			const selectionBox = new Instance("SelectionBox");
			selectionBox.Adornee = block;
			selectionBox.Color3 = Color3.fromRGB(255);
			selectionBox.SurfaceTransparency = 1;
			selectionBox.Transparency = 0;
			selectionBox.LineThickness = 0.05;
			selectionBox.Parent = block;

			highlights.push(selectionBox);
		}

		return {
			Disconnect() {
				for (const highlight of highlights) {
					highlight.Destroy();
				}
			},
		};
	}
	clearBlocks() {
		this.plot.deleteOperation.execute("all");
	}
}

export type TutorialControlDefinition = Frame & {
	readonly Header: TextLabel & {
		readonly Cancel: TextButton;
		readonly Next: TextButton;
		readonly Skip: TextButton;
		readonly SkipAll: TextButton;
	};
	readonly TextLabel: TextLabel;
};
export class TutorialControl extends Control<TutorialControlDefinition> {
	private readonly _onCancel = new ArgsSignal();
	readonly onCancel = this._onCancel.asReadonly();

	private readonly _nextPressed = new ArgsSignal();
	readonly nextPressed = this._nextPressed.asReadonly();

	private readonly _skipPressed = new ArgsSignal();
	readonly skipPressed = this._skipPressed.asReadonly();

	private readonly _skipAllPressed = new ArgsSignal();
	readonly skipAllPressed = this._skipAllPressed.asReadonly();

	constructor(title: string) {
		super(Interface.getInterface<{ Tutorial: TutorialControlDefinition }>().Tutorial.Clone());
		this.gui.Parent = Interface.getInterface();

		this.gui.Header.Text = title;

		this.add(new ButtonControl(this.gui.Header.Cancel, () => this._onCancel.Fire()));
		this.add(new ButtonControl(this.gui.Header.Next, () => this._nextPressed.Fire()));

		this.$onInjectAuto((popupController: PopupController) => {
			this.add(
				new ButtonControl(this.gui.Header.Skip, () => {
					if (RunService.IsStudio()) {
						this._skipPressed.Fire();
						return;
					}

					popupController.showPopup(
						new ConfirmPopup(
							"Are you sure you want to skip this step?",
							"This way you will learn this lesson worse!",
							() => {
								this._skipPressed.Fire();
							},
							() => {},
						),
					);
				}),
			);
			this.add(
				new ButtonControl(this.gui.Header.SkipAll, () => {
					popupController.showPopup(
						new ConfirmPopup(
							"Are you sure you want to skip the tutorial?",
							"This way you will learn this lesson worse!",
							() => {
								this._skipAllPressed.Fire();
							},
							() => {},
						),
					);
				}),
			);
		});
	}
}

export type TutorialTasksDefinition = Frame & {
	readonly Content: GuiObject & {
		readonly TaskList: TextLabel & {
			readonly Task: Frame & {
				readonly NumLabel: TextLabel;
				readonly TextLabel: TextLabel;
			};
		};
		readonly HintList: TextLabel & {
			readonly Hint: Frame & {
				readonly TextLabel: TextLabel;
			};
		};
	};
};
export class TutorialTasksControl extends Control<TutorialTasksDefinition> {
	private readonly taskTemplate;
	private readonly taskList;

	private readonly hintTemplate;
	private readonly hintList;

	constructor() {
		super(Interface.getInterface<{ TutorialTasks: TutorialTasksDefinition }>().TutorialTasks.Clone());
		this.gui.Parent = Interface.getInterface();

		this.taskTemplate = this.asTemplate(this.gui.Content.TaskList.Task);
		this.taskList = this.parent(new ComponentChildren<Control>().withParentInstance(this.gui.Content.TaskList));

		this.hintTemplate = this.asTemplate(this.gui.Content.HintList.Hint);
		this.hintList = this.parent(new ComponentChildren<Control>().withParentInstance(this.gui.Content.HintList));
	}

	setTasks(tasks: readonly string[]) {
		this.taskList.clear();

		let i = 0;
		for (const task of tasks) {
			const gui = this.taskTemplate();
			gui.NumLabel.Text = tostring(++i);
			gui.TextLabel.Text = task;

			this.taskList.add(new Control(gui));
		}
	}
	setHints(hints: readonly string[]) {
		this.hintList.clear();
		this.gui.Content.HintList.Visible = hints.size() !== 0;

		for (const hint of hints) {
			const gui = this.hintTemplate();
			gui.TextLabel.Text = hint;

			this.hintList.add(new Control(gui));
		}
	}
}

namespace Steps {
	export type Reg = {
		readonly connection: SignalConnection;
		readonly autoComplete?: () => void;
	};
	type Resolver = () => void;

	function createWaiter() {
		let res: (value: unknown) => void;
		const promise = new Promise((resolve) => (res = resolve));

		return {
			resolve: () => res(undefined),
			wait: () => Objects.awaitThrow(promise),
		} as const;
	}
	export function execute<TArgs extends unknown[]>(
		func: (...args: [...args: TArgs, resolve: Resolver]) => Reg,
		...args: TArgs
	): TutorialPartRegistration {
		const { resolve, wait } = createWaiter();
		const { connection, autoComplete } = func(...[...args, resolve]);

		return { connection, wait, autoComplete };
	}

	export function waitForNext(ui: TutorialControl, resolve: Resolver): Reg {
		ui.instance.Header.Next.Visible = true;
		ui.instance.Header.Skip.Visible = false;

		const c1 = Signal.connection(() => {
			ui.instance.Header.Next.Visible = false;
			ui.instance.Header.Skip.Visible = true;
		});
		const c2 = ui.nextPressed.Connect(resolve);

		return { connection: Signal.multiConnection(c1, c2) };
	}

	export class Build {
		private readonly subscribedBlocks = new Set<LatestSerializedBlocks>();

		constructor(
			private readonly building: ClientBuilding,
			plot: TutorialPlot,
		) {
			const middleware = this.building.placeOperation.addMiddleware((args) => {
				if (this.subscribedBlocks.size() === 0) {
					return { success: true };
				}

				const empty = {};
				const bs = args.blocks
					.map((block): PlaceBlockRequest | {} => {
						let btp: LatestSerializedBlock | undefined;
						for (const b of this.subscribedBlocks) {
							btp = b.blocks.find(
								(value) =>
									value.id === block.id &&
									VectorUtils.roundVector3To(value.location.Position, 0.5) ===
										VectorUtils.roundVector3To(
											args.plot.instance.BuildingArea.CFrame.ToObjectSpace(block!.location)
												.Position,
											0.5,
										),
							);

							if (btp) break;
						}
						if (!btp) return empty;

						return {
							...block,
							location: args.plot.instance.BuildingArea.CFrame.ToWorldSpace(btp.location),
							uuid: btp.uuid,
						};
					})
					.filter((c) => c !== empty) as PlaceBlockRequest[];

				if (bs.size() !== args.blocks.size()) {
					return { success: false, message: "Invalid placement" };
				}

				for (const { uuid } of bs) {
					if (!uuid) continue;
					plot.remove(uuid);
				}

				return { success: true, arg: { ...args, blocks: bs } };
			});
		}

		wait(
			tutorial: TutorialController,
			blocksToPlace: LatestSerializedBlocks,
			buildTool: BuildTool,
			plot: SharedPlot,
			resolve: Resolver,
		): Reg {
			const updateTasks = () => {
				const allBlocksCount = this.subscribedBlocks.flatmap((x) => x.blocks).size();
				const builtBlocksCount = this.subscribedBlocks
					.flatmap((x) => x.blocks)
					.filter((b) => plot.tryGetBlock(b.uuid) !== undefined)
					.size();
				tutorial.setTasks(`Build blocks (${builtBlocksCount}/${allBlocksCount})`);
			};

			this.subscribedBlocks.add(blocksToPlace);
			const c1 = Signal.connection(() => this.subscribedBlocks.delete(blocksToPlace));

			const c2 = this.building.placeOperation.executed.Connect(({ plot }) => {
				buildTool.gui.blockSelector.highlightedBlocks.set([
					...blocksToPlace.blocks.filter((b) => !plot.tryGetBlock(b.uuid)).mapToSet((b) => b.id),
				]);
				updateTasks();

				for (const blockToPlace of blocksToPlace.blocks) {
					const placed = plot.tryGetBlock(blockToPlace.uuid);
					if (!placed) return;
				}

				resolve();
			});

			buildTool.gui.blockSelector.highlightedBlocks.set([...blocksToPlace.blocks.mapToSet((b) => b.id)]);
			const c3 = Signal.connection(() => buildTool.gui.blockSelector.highlightedBlocks.set([]));

			updateTasks();
			const c4 = Signal.connection(() => tutorial.setTasks());

			return {
				connection: Signal.multiConnection(c1, c2, c3, c4),
				autoComplete: () => {
					this.building.placeOperation.execute({
						plot: plot,
						blocks: blocksToPlace.blocks
							.filter((b) => !plot.tryGetBlock(b.uuid))
							.map((b) => BlocksSerializer.serializedBlockToPlaceRequest(b, plot.origin)),
					});
				},
			};
		}
	}
	export class Delete {
		private readonly subscribedBlocks = new Set<ReadonlySet<BlockUuid>>();

		constructor(private readonly building: ClientBuilding) {
			const middleware = this.building.deleteOperation.addMiddleware((args) => {
				if (this.subscribedBlocks.size() === 0) {
					return { success: true };
				}

				const blocks = args.blocks === "all" ? args.plot.getBlocks() : args.blocks;
				for (const block of blocks) {
					const blockUuid = BlockManager.manager.uuid.get(block);

					for (const uuidsToDelete of this.subscribedBlocks) {
						const btp = uuidsToDelete.has(blockUuid);
						if (btp) {
							return { success: true };
						}
					}
				}

				return { success: false, message: "Invalid deletion" };
			});
		}

		wait(tutorial: TutorialController, uuidsToDelete: ReadonlySet<BlockUuid>, plot: SharedPlot, resolve: Resolver) {
			this.subscribedBlocks.add(uuidsToDelete);
			const c1 = Signal.connection(() => this.subscribedBlocks.delete(uuidsToDelete));

			const updateTasks = () => {
				const allBlocksCount = this.subscribedBlocks.flatmap((b) => [...b]).size();
				const deletedBlocksCount = this.subscribedBlocks
					.flatmap((b) => [...b])
					.filter((b) => !plot.tryGetBlock(b))
					.size();
				tutorial.setTasks(`Delete blocks (${deletedBlocksCount}/${allBlocksCount})`);
			};

			const c2 = this.building.deleteOperation.executed.Connect(({ plot }) => {
				for (const uuidToDelete of uuidsToDelete) {
					const placed = plot.tryGetBlock(uuidToDelete);
					if (placed) return;
				}

				resolve();
			});

			updateTasks();
			const c3 = Signal.connection(() => tutorial.setTasks());

			return {
				connection: Signal.multiConnection(c1, c2, c3),
				autoComplete: () => {
					this.building.deleteOperation.execute({
						plot: plot,
						blocks: uuidsToDelete
							.filter((uuid) => plot.tryGetBlock(uuid) !== undefined)
							.map((uuid) => plot.getBlock(uuid)),
					});
				},
			};
		}
	}

	export type BlockToConfigure = {
		readonly uuid: BlockUuid;
		readonly key: string;
		readonly value: PartialThrough<PlacedBlockConfig[string]> | undefined;
	};
	export function waitForConfigure(
		building: ClientBuilding,
		blocksToConfigure: readonly BlockToConfigure[],
		plot: SharedPlot,
		blockList: BlockList,
		resolve: Resolver,
	): Reg {
		const sameProperties = (object: object, properties: object): boolean => {
			for (const [k] of pairs(properties)) {
				if (!(k in object)) {
					return false;
				}
				if (typeOf(object[k]) !== typeOf(properties[k])) {
					return false;
				}

				if (typeIs(object[k], "table")) {
					if (!sameProperties(object[k], properties[k])) {
						return false;
					}

					continue;
				}

				if (object[k] !== properties[k]) {
					return false;
				}
			}

			return true;
		};

		// const getRelevantConfig = (uuid: BlockUuid, key: string) => {
		// 	const block = plot.tryGetBlock(uuid);
		// 	if (!block) return;

		// 	const b = blockList.blocks[BlockManager.manager.id.get(block)];
		// 	if (!b) return;

		// 	return {
		// 		key,
		// 		config: BlockConfig.addDefaults(BlockManager.manager.config.get(block), b.logic!.definition.input)[key],
		// 	};
		// };
		// const savedConfigs = asObject(
		// 	blocksToConfigure.mapToMap((b) => $tuple(b.uuid, getRelevantConfig(b.uuid, b.key))),
		// );

		const c1 = building.updateConfigOperation.addMiddleware((args) => {
			// for (const { block, cfg: config } of args.configs) {
			// 	const uuid = BlockManager.manager.uuid.get(block);
			// 	const savedcfg = savedConfigs[uuid];
			// 	if (!savedcfg) {
			// 		return { success: false, message: "Wrong block!" };
			// 	}

			// 	const cfg = config[savedcfg.key];
			// 	print(cfg, savedcfg.config);
			// }

			return { success: true, arg: args };
		});
		const c2 = building.updateConfigOperation.executed.Connect(({ plot }) => {
			for (const { uuid, key, value } of blocksToConfigure) {
				const block = plot.tryGetBlock(uuid);
				if (!block) return;

				const config = BlockManager.manager.config.get(block) ?? {};
				if (!(key in config) || !config[key]) {
					return;
				}
				if (!typeIs(value, "table")) {
					if (config[key] !== value) {
						return false;
					}
				} else if (!sameProperties(config[key] as object, value)) {
					return;
				}
			}

			resolve();
		});

		return {
			connection: Signal.multiConnection(c1, c2),
			autoComplete: () => {
				building.updateConfigOperation.execute({
					plot: plot,
					configs: blocksToConfigure
						.groupBy((b) => b.uuid)
						.map((uuid, blocks): ClientBuildingTypes.UpdateConfigArgs["configs"][number] => ({
							block: plot.getBlock(uuid),
							cfg: (() => {
								const config = BlockConfig.addDefaults(
									BlockManager.manager.config.get(plot.getBlock(uuid)) ?? {},
									blockList.blocks[BlockManager.manager.id.get(plot.getBlock(uuid))]!.logic!
										.definition.input,
								);

								return asObject(
									blocks.mapToMap(({ key, value }) =>
										$tuple(key, Objects.deepCombine(config[key], value as never)),
									),
								);
							})(),
						})),
				});
			},
		};
	}

	export type BlockToMove = {
		readonly uuid: BlockUuid;
		readonly to: Vector3;
	};
	export type BlockToRotate = {
		readonly uuid: BlockUuid;
		readonly toRotation: CFrame;
	};
	export class Edit {
		private readonly addFunc;

		constructor(private readonly building: ClientBuilding) {
			const { addFunc, connection } = building.editOperation.createMiddlewareCombiner();
			this.addFunc = addFunc;
		}

		move(blocksToMove: readonly BlockToMove[], plot: SharedPlot, resolve: Resolver): Reg {
			const c1 = this.addFunc((arg) => {
				for (const { instance, newPosition } of arg.blocks) {
					if (!newPosition) {
						return { success: false, message: "Invalid movement" };
					}

					const uuid = BlockManager.manager.uuid.get(instance);
					for (const should of blocksToMove) {
						if (should.uuid !== uuid) continue;

						if (
							VectorUtils.roundVector3(plot.origin.ToObjectSpace(newPosition).Position) !==
							VectorUtils.roundVector3(should.to)
						) {
							return { success: false, message: "Invalid movement" };
						}
					}
				}

				return { success: true };
			});
			const c2 = this.building.editOperation.executed.Connect(({ plot }) => {
				for (const { uuid, to } of blocksToMove) {
					const block = plot.tryGetBlock(uuid);
					if (!block) return;

					if (
						VectorUtils.roundVector3(plot.origin.ToObjectSpace(block.GetPivot()).Position) !==
						VectorUtils.roundVector3(to)
					) {
						return false;
					}
				}

				resolve();
			});

			return {
				connection: Signal.multiConnection(c1, c2),
				autoComplete: () => {
					this.building.editOperation.execute({
						plot: plot,
						blocks: blocksToMove.map((b): ClientBuildingTypes.EditBlockInfo => {
							const block = plot.getBlock(b.uuid);
							const pivot = block.GetPivot();

							return {
								instance: block,
								origPosition: pivot,
								newPosition: pivot.Rotation.add(plot.origin.PointToWorldSpace(b.to)),
							};
						}),
					});
				},
			};
		}

		rotate(blocksToRotate: readonly BlockToRotate[], plot: SharedPlot, resolve: Resolver): Reg {
			const c1 = this.addFunc((arg) => {
				return { success: true };
			});
			const c2 = this.building.editOperation.executed.Connect(({ plot }) => {
				for (const { uuid, toRotation } of blocksToRotate) {
					const block = plot.tryGetBlock(uuid);
					if (!block) return;

					if (!VectorUtils.areCFrameEqual(block.GetPivot().Rotation, toRotation)) {
						return false;
					}
				}

				resolve();
			});

			return {
				connection: Signal.multiConnection(c1, c2),
				autoComplete: () => {
					this.building.editOperation.execute({
						plot: plot,
						blocks: blocksToRotate.map((b): ClientBuildingTypes.EditBlockInfo => {
							const block = plot.getBlock(b.uuid);
							const pivot = block.GetPivot();

							return {
								instance: block,
								origPosition: pivot,
								newPosition: plot.origin.ToWorldSpace(b.toRotation).add(pivot.Position),
							};
						}),
					});
				},
			};
		}
	}
}

export type TutorialRunnerPartList = readonly (() => readonly TutorialPartRegistration[])[];
export type TutorialDescriber = {
	readonly name: string;
	create(t: TutorialController): TutorialRunnerPartList;
};

export type TutorialPartRegistration = {
	readonly connection: SignalConnection;
	readonly wait: () => void;
	readonly autoComplete?: () => void;
};

export type TutorialDiffList = {
	readonly saveVersion: number;
	readonly diffs: { readonly [k in string]: readonly BuildingDiffChange[] };
};

/** Process the block diff, running the build/delete/configure/etc parts */
const processTutorialDiff = (
	tutorial: TutorialController,
	diffs: readonly BuildingDiffChange[],
	saveVersion: number,
): TutorialPartRegistration => {
	const istype = <const TType extends BuildingDiffChange["type"], T>(
		actualType: BuildingDiffChange["type"],
		wantedType: TType,
		changes: BuildingDiffChange[],
	): changes is Extract<BuildingDiffChange, { type: TType }>[] => actualType === wantedType;
	const toBlock = (block: DiffBlock): LatestSerializedBlock => block as LatestSerializedBlock;

	const get = (changeType: BuildingDiffChange["type"], change: BuildingDiffChange[]): TutorialPartRegistration => {
		if (istype(changeType, "added", change)) {
			return tutorial.partBuild({ version: saveVersion, blocks: change.map((c) => toBlock(c.block)) });
		}
		if (istype(changeType, "removed", change)) {
			return tutorial.partDelete(change.map((c) => c.uuid));
		}
		if (istype(changeType, "configChanged", change)) {
			return tutorial.partConfigure(
				change.map(({ uuid, key, value }) => ({ uuid: uuid as BlockUuid, key, value })),
			);
		}
		if (istype(changeType, "moved", change)) {
			return tutorial.partMove(change.map(({ uuid, to }) => ({ uuid: uuid as BlockUuid, to })));
		}
		if (istype(changeType, "rotated", change)) {
			return tutorial.partRotate(change.map(({ uuid, toRotation }) => ({ uuid: uuid as BlockUuid, toRotation })));
		}

		return {
			connection: Signal.connection(() => {}),
			wait: () => {},
		};
	};

	const parts = diffs.groupBy((d) => d.type).map((changeType, change) => () => get(changeType, change));
	return tutorial.combinePartsSequential(...parts);
};

/** Controlling a single tutorial */
@injectable
export class TutorialController extends Component {
	private readonly ghostPlot;
	private readonly ui;
	private readonly uiTasks;

	canCancel = true;

	private readonly steps;

	constructor(
		title: string,
		@inject private readonly sharedPlot: SharedPlot,
		@inject private readonly plot: ReadonlyPlot,
		@inject readonly buildingMode: BuildingMode,
		@inject private readonly blockList: BlockList,
		@inject di: DIContainer,
	) {
		super();

		const building = buildingMode.building;

		this.ui = this.parentGui(new TutorialControl(title));

		this.uiTasks = this.parent(new TutorialTasksControl());
		this.uiTasks.instance.Visible = true;

		this.ghostPlot = di.resolveForeignClass(TutorialPlot, [plot]);

		this.steps = {
			delete: new Steps.Delete(building),
			build: new Steps.Build(building, this.ghostPlot),
			edit: new Steps.Edit(building),
		};

		this.event.subscribeObservable(LoadingController.isLoading, (isloading) => {
			this.ui.setVisibleAndEnabled(!isloading);
			this.uiTasks.setVisibleAndEnabled(!isloading);
		});

		this.onEnable(() => {
			try {
				LoadingController.run(`Starting tutorial...`, () => CustomRemotes.modes.set.send({ mode: "build" }));
			} catch {
				// empty
			}

			building.deleteOperation.execute({ plot: sharedPlot, blocks: "all" });
		});
	}

	/** Set tasks on the "tasks" gui; For tutorial tools usage only. */
	setTasks(...tasks: readonly string[]): void {
		this.uiTasks.setTasks(tasks);
	}

	/** Same as {@link hintsPart} but auto-translates the strings */
	translatedHintsPart(...tasks: readonly (readonly string[])[]): TutorialPartRegistration {
		return this.hintsPart(
			...tasks.map((tasks) =>
				Localization.translateForPlayer(
					Players.LocalPlayer,
					...tasks.map((v) => (v.size() !== 0 ? "• " : "") + v),
				),
			),
		);
	}
	/** Show hints on the "hints" gui */
	hintsPart(...tasks: readonly string[]): TutorialPartRegistration {
		this.uiTasks.setHints(tasks);

		return {
			wait: () => {},
			connection: Signal.connection(() => this.uiTasks.setHints([])),
		};
	}
	/** Show text on the main gui */
	partText(...text: readonly string[]): TutorialPartRegistration {
		const gui = this.ui.instance;
		gui.TextLabel.Text = "";
		gui.Header.Cancel.Visible = this.canCancel;

		const translatedText = Localization.translateForPlayer(Players.LocalPlayer, ...text);
		const thr = task.spawn(() => {
			// Animated text
			for (const symbol of translatedText) {
				gui.TextLabel.Text += symbol;
				task.wait(RunService.IsStudio() ? 0 : 0.05);
			}
		});

		return {
			connection: Signal.connection(() => {
				task.cancel(thr);

				if (gui.FindFirstChild("Header") && gui.FindFirstChild("TextLabel")) {
					// if not destroyed
					gui.Header.Cancel.Visible = this.canCancel;
					gui.TextLabel.Text = translatedText;
				}
			}),
			wait: () => {},
		};
	}

	private showBlocks(blocks: LatestSerializedBlocks): SignalConnection {
		this.ghostPlot.build(blocks);
		return Signal.connection(() => this.ghostPlot.clearBlocks());
	}
	private highlightBlocks(uuids: readonly string[]): SignalConnection {
		return this.ghostPlot.highlight(uuids as readonly BlockUuid[]);
	}

	/** Execute a function as a part */
	funcPart(func: (tutorial: TutorialController) => void): TutorialPartRegistration {
		func(this);

		return {
			connection: Signal.connection(() => {}),
			wait: () => {},
		};
	}
	/** Wait for the "next" button click */
	partNextButton(): TutorialPartRegistration {
		return Steps.execute(Steps.waitForNext, this.ui);
	}

	/** Wait for blocks building */
	partBuild(blocks: LatestSerializedBlocks): TutorialPartRegistration {
		const hc = this.showBlocks(blocks);
		const exec = Steps.execute(
			this.steps.build.wait.bind(this.steps.build),
			this,
			blocks,
			this.buildingMode.tools.buildTool,
			this.sharedPlot,
		);

		return {
			...exec,
			connection: Signal.multiConnection(exec.connection, hc),
		} as const;
	}
	/** Wait for blocks deletion */
	partDelete(uuids: readonly string[]): TutorialPartRegistration {
		const hc = this.highlightBlocks(uuids);
		const exec = Steps.execute(
			this.steps.delete.wait.bind(this.steps.delete),
			this,
			new ReadonlySet(uuids as readonly BlockUuid[]),
			this.sharedPlot,
		);

		return {
			...exec,
			connection: Signal.multiConnection(exec.connection, hc),
		};
	}
	/** Wait for blocks moving */
	partMove(blocks: readonly Steps.BlockToMove[]): TutorialPartRegistration {
		const hc1 = this.showBlocks({
			version: BlocksSerializer.latestVersion,
			blocks: blocks.map((b) => {
				const block = this.plot.getBlock(b.uuid);
				const serialized = BlocksSerializer.serializeBlockToObject(this.plot, block);

				return {
					...serialized,
					location: serialized.location.Rotation.add(b.to),
				};
			}),
		});
		const hc2 = this.highlightBlocks(blocks.map((b) => b.uuid));

		const exec = Steps.execute(this.steps.edit.move.bind(this.steps.edit), blocks, this.sharedPlot);

		return {
			...exec,
			connection: Signal.multiConnection(hc1, hc2, exec.connection),
		};
	}
	/** Wait for blocks rotating */
	partRotate(blocks: readonly Steps.BlockToRotate[]): TutorialPartRegistration {
		const hc1 = this.showBlocks({
			version: BlocksSerializer.latestVersion,
			blocks: blocks.map((b) => {
				const block = this.plot.getBlock(b.uuid);
				const serialized = BlocksSerializer.serializeBlockToObject(this.plot, block);

				return {
					...serialized,
					location: b.toRotation.add(serialized.location.Position),
				};
			}),
		});
		const hc2 = this.highlightBlocks(blocks.map((b) => b.uuid));

		const exec = Steps.execute(this.steps.edit.rotate.bind(this.steps.edit), blocks, this.sharedPlot);

		return {
			...exec,
			connection: Signal.multiConnection(hc1, hc2, exec.connection),
		};
	}
	/** Wait for blocks configuring */
	partConfigure(blocks: readonly Steps.BlockToConfigure[]): TutorialPartRegistration {
		const hc = this.highlightBlocks(blocks.map((b) => b.uuid));
		const exec = Steps.execute(
			Steps.waitForConfigure,
			this.buildingMode.building,
			blocks,
			this.sharedPlot,
			this.blockList,
		);

		return {
			...exec,
			connection: Signal.multiConnection(hc, exec.connection),
		};
	}

	/** Combine parts into one that runs all provided ones simultaneously */
	combinePartsParallel(...regs: readonly TutorialPartRegistration[]): TutorialPartRegistration {
		return {
			connection: Signal.connection(() => regs.forEach((p) => p.connection.Disconnect())),
			wait: () => Objects.multiAwait(regs.map((p) => p.wait)),
			autoComplete: () => regs.forEach((p) => p?.autoComplete?.()),
		};
	}
	/** Combine parts into one that runs all provided ones sequentially */
	combinePartsSequential(...funcs: readonly (() => TutorialPartRegistration)[]) {
		const loaded: TutorialPartRegistration[] = [];
		funcs = funcs.map((func) => {
			let cache: ReturnType<typeof func> | undefined;
			return () => {
				if (cache) return cache;

				cache = func();
				loaded.push(cache);

				return cache;
			};
		});

		return {
			connection: Signal.connection(() => loaded.forEach((reg) => reg.connection.Disconnect())),
			wait: () => funcs.forEach((func) => func().wait()),
			autoComplete: () => funcs.forEach((func) => func()?.autoComplete?.()),
		};
	}

	private skipAll = false;

	/** Wait for the provided parts, starting all simultaneously. Supports skipping and cancelling. */
	waitPart(...regs: readonly TutorialPartRegistration[]): void | "canceled" {
		let skipped = this.skipAll;
		let completed = false;
		let canceled = false;

		const reg = this.combinePartsParallel(...regs);

		let connection: SignalConnection | undefined = Signal.multiConnection(
			reg.connection,
			Signal.connection(() => (completed = true)),
			this.ui.skipPressed.Connect(() => (skipped = true)),
			this.ui.skipAllPressed.Connect(() => (skipped = this.skipAll = true)),
			this.ui.onCancel.Connect(() => (canceled = true)),
		);

		this.event.eventHandler.register(Signal.connection(() => connection?.Disconnect()));

		const thr = task.spawn(() => {
			reg.wait();
			completed = true;
		});
		while (!completed) {
			if (canceled) {
				$log("Cancelling the tutorial");
				task.cancel(thr);

				break;
			}

			if (skipped) {
				$log("Skipping a part");
				task.cancel(thr);
				reg.autoComplete?.();

				break;
			}

			task.wait();
		}

		connection.Disconnect();
		connection = undefined;

		if (canceled) {
			return "canceled";
		}
	}

	/** Process the block diff, running the build/delete/configure/etc parts */
	processDiff(diffs: readonly BuildingDiffChange[], saveVersion: number): TutorialPartRegistration {
		return processTutorialDiff(this, diffs, saveVersion);
	}
}
