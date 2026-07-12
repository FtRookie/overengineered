import { Workspace } from "@rbxts/services";
import { TutorialMultiFinish, TutorialStepComponent } from "client/tutorial2/TutorialStepController";
import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { Element } from "engine/shared/Element";
import { Objects } from "engine/shared/fixes/Objects";
import { BlockConfig } from "shared/blockLogic/BlockConfig";
import { BlockManager } from "shared/building/BlockManager";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import { BuildingPlot } from "shared/building/BuildingPlot";
import { Colors } from "shared/Colors";
import { PartUtils } from "shared/utils/PartUtils";
import { VectorUtils } from "shared/utils/VectorUtils";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ClientBuilding, ClientBuildingTypes } from "client/modes/build/ClientBuilding";
import type { BuildTool } from "client/tools/BuildTool";
import type { BuildingDiffChange } from "client/tutorial2/BuildingDiffer";
import type { TutorialControllerGui } from "client/tutorial2/TutorialController";
import type { TutorialStarter } from "client/tutorial2/TutorialStarter";
import type { MiddlewareResponse } from "engine/shared/Operation";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type { LatestSerializedBlocks } from "shared/building/BlocksSerializer";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";
import type { SharedPlot } from "shared/building/SharedPlot";

@injectable
class TutorialPlot extends Component {
	private readonly instance: Folder;

	private readonly plot: BuildingPlot;
	private readonly actualPlot: ReadonlyPlot;

	constructor(
		plot: ReadonlyPlot,
		private readonly blockList: BlockList,
	) {
		super();

		this.actualPlot = plot;

		this.instance = new Instance("Folder");
		this.instance.Name = "TutorialPreview";
		this.instance.Parent = Workspace;
		ComponentInstance.init(this, this.instance);

		this.plot = new BuildingPlot(this.instance, plot.origin, plot.boundingBox, blockList);

		this.onDestroy(() => this.clearBlocks());
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
		this.plot.tryGetBlock(uuid)?.Destroy();
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

type BuildSubscription = { blocks: LatestSerializedBlocks; readonly finish: () => void };
class Build extends Component {
	private readonly subscribed = new Set<BuildSubscription>();

	constructor(
		private readonly plot: TutorialPlot,
		private readonly splot: SharedPlot,
		private readonly gui: TutorialControllerGui,
		private readonly building: ClientBuilding,
		private readonly buildTool: BuildTool,
	) {
		super();

		this.event.subscribeRegistration(() =>
			this.building.placeOperation.addMiddleware(
				(arg): MiddlewareResponse<ClientBuildingTypes.PlaceBlocksArgs> => {
					if (this.subscribed.size() === 0) {
						return { success: true, arg };
					}

					const bs = arg.blocks.mapFiltered((block) => {
						for (const b of this.subscribed) {
							const btp = b.blocks.blocks.find(
								(value) =>
									value.id === block.id &&
									VectorUtils.roundVector3To(value.location.Position, 0.5) ===
										VectorUtils.roundVector3To(
											arg.plot.instance.BuildingArea.CFrame.ToObjectSpace(block!.location)
												.Position,
											0.5,
										),
							);

							if (btp) {
								return [btp, b] as const;
							}
						}
					});

					if (bs.size() !== arg.blocks.size()) {
						return { success: false, message: "Invalid placement" };
					}

					for (const [b, sub] of bs) {
						if (!b.uuid) continue;
						plot.remove(b.uuid);

						sub.blocks = { ...sub.blocks, blocks: sub.blocks.blocks.except([b]) };
						if (sub.blocks.blocks.size() === 0) {
							this.subscribed.delete(sub);
							sub.finish();
						}
					}

					return {
						success: true,
						arg: {
							...arg,
							blocks: bs.map(
								([block]): PlaceBlockRequest => ({
									...block,
									location: arg.plot.instance.BuildingArea.CFrame.ToWorldSpace(block.location),
									color: { color: Colors.white, alpha: 1 },
									material: Enum.Material.Plastic,
									scale: Vector3.one,
								}),
							),
						},
					};
				},
			),
		);
	}

	disableBuilding(): Component {
		const ret = new Component();
		ret.event.subscribeRegistration(() =>
			this.building.placeOperation.addMiddleware(() => ({ success: false, message: "Building is disabled" })),
		);

		return ret;
	}

	waitForBuild(blocks: LatestSerializedBlocks, finish: () => void): Component {
		const ret = new TutorialStepComponent();
		ret.onSkip(() => {
			this.building.placeOperation.execute({
				plot: this.splot,
				blocks: blocks.blocks
					.filter((b) => !this.splot.tryGetBlock(b.uuid))
					.map((b) => BlocksSerializer.serializedBlockToPlaceRequest(b, this.splot.origin)),
			});
		});

		const sub = { blocks, finish };
		this.subscribed.add(sub);

		this.plot.build(blocks);

		this.buildTool.gui.blockSelector.highlightedBlocks.set([
			...new Set(this.subscribed.flatmap((b) => b.blocks.blocks.map((b) => b.id))),
		]);
		ret.onDestroy(() =>
			this.buildTool.gui.blockSelector.highlightedBlocks.set([
				...new Set(this.subscribed.flatmap((b) => b.blocks.blocks.map((b) => b.id))),
			]),
		);

		const task = ret.parent(this.gui.progress.addTask("Place blocks", blocks.blocks.size()));
		ret.event.subscribeRegistration(() =>
			this.building.placeOperation.addMiddleware((arg) => {
				task.setProgress(blocks.blocks.size() - sub.blocks.blocks.size(), blocks.blocks.size());
				return { success: true, arg };
			}),
		);

		ret.onDestroy(() => {
			for (const { uuid } of blocks.blocks) {
				this.plot.remove(uuid);
			}
		});
		ret.onDestroy(() => this.subscribed.delete(sub));
		return ret;
	}
}

type RemoveSubscription = { blocks: ReadonlySet<BlockUuid>; readonly finish: () => void };
class Remove extends Component {
	private readonly subscribed = new Set<RemoveSubscription>();

	constructor(
		private readonly plot: TutorialPlot,
		private readonly splot: SharedPlot,
		private readonly gui: TutorialControllerGui,
		private readonly building: ClientBuilding,
	) {
		super();

		this.event.subscribeRegistration(() =>
			this.building.deleteOperation.addMiddleware((arg) => {
				if (this.subscribed.size() === 0) {
					return { success: true };
				}

				const blocks = arg.blocks === "all" ? arg.plot.getBlocks() : arg.blocks;
				const bs = blocks.mapFiltered((block) => {
					const blockUuid = BlockManager.manager.uuid.get(block);

					for (const sub of this.subscribed) {
						const btp = sub.blocks.has(blockUuid);
						if (btp) {
							return [blockUuid, sub] as const;
						}
					}
				});

				if (bs.size() !== blocks.size()) {
					return { success: false, message: "Invalid deletion" };
				}

				for (const [b, sub] of bs) {
					if (!b) continue;
					plot.remove(b);

					sub.blocks = sub.blocks.except([b]);
					if (sub.blocks.size() === 0) {
						this.subscribed.delete(sub);
						sub.finish();
					}
				}

				return { success: true };
			}),
		);
	}

	disableDeleting(): Component {
		const ret = new Component();
		ret.event.subscribeRegistration(() =>
			this.building.deleteOperation.addMiddleware(() => ({
				success: false,
				message: "Removing blocks is disabled",
			})),
		);

		return ret;
	}

	waitForDelete(blocks: ReadonlySet<BlockUuid>, finish: () => void): Component {
		const ret = new TutorialStepComponent();
		ret.onSkip(() => {
			this.building.deleteOperation.execute({
				plot: this.splot,
				blocks: blocks
					.filter((uuid) => this.splot.tryGetBlock(uuid) !== undefined)
					.map((uuid) => this.splot.getBlock(uuid)),
			});
		});

		const highlightSub = this.plot.highlight([...blocks]);

		const sub = { blocks, finish };
		this.subscribed.add(sub);

		const task = ret.parent(this.gui.progress.addTask("Delete blocks", blocks.size()));
		ret.event.subscribeRegistration(() =>
			this.building.deleteOperation.addMiddleware((arg) => {
				task.setProgress(blocks.size() - sub.blocks.size(), blocks.size());
				return { success: true, arg };
			}),
		);

		ret.onDestroy(() => highlightSub.Disconnect());
		ret.onDestroy(() => this.subscribed.delete(sub));
		return ret;
	}
}

type ConfigureSubscription = {
	blocks: { readonly [k in BlockUuid]: PartialThrough<PlacedBlockConfig> };
	readonly finish: () => void;
};
class Configure extends Component {
	private readonly subscribed = new Set<ConfigureSubscription>();

	constructor(
		private readonly plot: TutorialPlot,
		private readonly splot: SharedPlot,
		private readonly gui: TutorialControllerGui,
		private readonly building: ClientBuilding,
		private readonly blockList: BlockList,
	) {
		super();

		this.event.subscribeRegistration(() =>
			this.building.updateConfigOperation.executed.Connect(() => {
				if (this.subscribed.size() === 0) {
					return { success: true };
				}

				for (const sub of [...this.subscribed]) {
					let success = true;

					for (const [uuid, value] of pairs(sub.blocks)) {
						const block = splot.tryGetBlock(uuid);
						if (!block) {
							success = false;
							continue;
						}

						const config = BlockManager.manager.config.get(block) ?? {};
						if (!Objects.objectDeepEqualsExisting(config, value)) {
							success = false;
							continue;
						}
					}

					if (success) {
						this.subscribed.delete(sub);
						sub.finish();
					}
				}

				return { success: true };
			}),
		);
	}

	disableConfiguring(): Component {
		const ret = new Component();
		ret.event.subscribeRegistration(() =>
			this.building.updateConfigOperation.addMiddleware(() => ({
				success: false,
				message: "Configuring blocks is disabled",
			})),
		);

		return ret;
	}

	waitForConfig(blocks: ConfigureSubscription["blocks"], finish: () => void): Component {
		const ret = new TutorialStepComponent();
		ret.onSkip(() => {
			this.building.updateConfigOperation.execute({
				plot: this.splot,
				configs: asMap(blocks) //
					.map((uuid, value): ClientBuildingTypes.UpdateConfigArgs["configs"][number] => ({
						block: this.splot.getBlock(uuid),
						cfg: (() => {
							const config = BlockConfig.addDefaults(
								BlockManager.manager.config.get(this.splot.getBlock(uuid)) ?? {},
								this.blockList.blocks[BlockManager.manager.id.get(this.splot.getBlock(uuid))]!.logic!
									.definition.input,
							);

							return Objects.deepCombine(config, value);
						})(),
					})),
			});
		});

		const highlightSub = this.plot.highlight(asMap(blocks).keys());

		const sub = { blocks, finish };
		this.subscribed.add(sub);

		const task = ret.parent(this.gui.progress.addTask("Configure blocks", Objects.size(blocks)));
		ret.event.subscribeRegistration(() =>
			this.building.deleteOperation.addMiddleware((arg) => {
				task.setProgress(Objects.size(blocks) - Objects.size(sub.blocks), Objects.size(blocks));
				return { success: true, arg };
			}),
		);

		ret.onDestroy(() => highlightSub.Disconnect());
		ret.onDestroy(() => this.subscribed.delete(sub));
		return ret;
	}
}

@injectable
export class TutorialPlotController extends Component {
	plot: TutorialPlot = undefined!;
	private build: Build = undefined!;
	private remove: Remove = undefined!;
	private config: Configure = undefined!;

	constructor(ts: TutorialStarter) {
		super();

		this.$onInjectAuto((plot: ReadonlyPlot, splot: SharedPlot, blockList: BlockList, buildMode: BuildingMode) => {
			buildMode.building.deleteOperation.execute({ blocks: "all", plot: splot });
			this.plot = this.parent(new TutorialPlot(plot, blockList));

			this.build = this.parent(
				new Build(this.plot, splot, ts.controller.gui, buildMode.building, buildMode.tools.buildTool),
			);
			this.remove = this.parent(new Remove(this.plot, splot, ts.controller.gui, buildMode.building));
			this.config = this.parent(
				new Configure(this.plot, splot, ts.controller.gui, buildMode.building, blockList),
			);
		});
	}

	processDiff(diff: BuildingDiffChange, _finish: () => void): Component {
		const mfinish = TutorialMultiFinish.create(_finish);

		const ret = new TutorialStepComponent();
		if (diff.added) {
			ret.parent(this.build.waitForBuild({ version: diff.version, blocks: diff.added }, mfinish.new()));
		}
		if (diff.removed) {
			ret.parent(this.remove.waitForDelete(new ReadonlySet(diff.removed), mfinish.new()));
		}
		if (diff.configChanged) {
			ret.parent(this.config.waitForConfig(diff.configChanged, mfinish.new()));
		}

		return ret;
	}

	disableBuilding() {
		return this.build.disableBuilding();
	}
	disableDeleting() {
		return this.remove.disableDeleting();
	}
}
