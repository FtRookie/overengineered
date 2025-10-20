import { Players, ReplicatedStorage, RunService, UserInputService, Workspace } from "@rbxts/services";
import { SoundController } from "client/controller/SoundController";
import { Anim } from "client/gui/Anim";
import { BlockPreviewControl } from "client/gui/buildmode/BlockPreviewControl";
import { BlockSelectionControl } from "client/gui/buildmode/BlockSelection";
import { MaterialColorEditControl } from "client/gui/buildmode/MaterialColorEditControl";
import { MirrorEditorControl } from "client/gui/buildmode/MirrorEditorControl";
import { DebugLog } from "client/gui/DebugLog";
import { LogControl } from "client/gui/static/LogControl";
import { Signals } from "client/Signals";
import { BlockGhoster } from "client/tools/additional/BlockGhoster";
import { BlockMirrorer } from "client/tools/additional/BlockMirrorer";
import { FloatingText } from "client/tools/additional/FloatingText";
import { ToolBase } from "client/tools/ToolBase";
import { ClientComponentChild } from "engine/client/component/ClientComponentChild";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { InputController } from "engine/client/InputController";
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { Transforms } from "engine/shared/component/Transforms";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { BB } from "engine/shared/fixes/BB";
import { MathUtils } from "engine/shared/fixes/MathUtils";
import { BlockManager } from "shared/building/BlockManager";
import { BuildingManager } from "shared/building/BuildingManager";
import { SharedBuilding } from "shared/building/SharedBuilding";
import { Colors } from "shared/Colors";
import { VectorUtils } from "shared/utils/VectorUtils";
import type { BlockSelectionControlDefinition } from "client/gui/buildmode/BlockSelection";
import type { MaterialColorEditControlDefinition } from "client/gui/buildmode/MaterialColorEditControl";
import type { MirrorEditorControlDefinition } from "client/gui/buildmode/MirrorEditorControl";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { Tooltip } from "client/gui/static/TooltipsControl";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ClientBuilding } from "client/modes/build/ClientBuilding";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";
import type { SharedPlot } from "shared/building/SharedPlot";

const allowedColor = Colors.blue;
const forbiddenColor = Colors.red;
const mouse = Players.LocalPlayer.GetMouse();

const fromModelBB = (block: Model, additionalRotation?: CFrame): BB => {
	const colbox = (block.FindFirstChild("ColBox") ??
		block.FindFirstChild("Colbox") ??
		block.FindFirstChild("colbox")) as Part | undefined;
	if (colbox) {
		return BB.fromPart(colbox).withCenter((c) => c.mul(additionalRotation ?? CFrame.identity));
	}

	return BB.fromBBs(
		block
			.GetChildren()
			.mapFiltered((c) =>
				c.IsA("Folder") ? undefined : c.IsA("Model") || c.IsA("BasePart") ? BB.from(c) : undefined,
			),
		block.GetPivot(),
	).withCenter((c) => c.mul(additionalRotation ?? CFrame.identity));
};

type ModelOnlyBlock = Pick<Block, "model">;

const createBlockGhost = (block: ModelOnlyBlock, scale: Vector3): BlockModel => {
	const model = block.model.Clone();
	BlockGhoster.ghostModel(model);
	SharedBuilding.scale(model, block.model, scale);

	// build tool 1 part coloring via transparency instead of highlighter
	// PartUtils.switchDescendantsMaterial(this.previewBlock, this.selectedMaterial.get());
	// PartUtils.switchDescendantsColor(this.previewBlock, this.selectedColor.get());

	return model;
};

const getMouseTargetBlockPositionV2 = (
	block: ModelOnlyBlock,
	rotation: CFrame,
	scale: Vector3,
	gridEnabled: boolean,
	step: number,
	info?: [target: BasePart, hit: CFrame, surface: Enum.NormalId],
): Vector3 | undefined => {
	const constrainPositionToGrid = (normal: Vector3, pos: Vector3) => {
		const from = (coord: number, size: number) => {
			const offset = size < 0.5 ? 0 : (size % 2) / 2;

			coord -= offset;
			const pos = MathUtils.round(coord, step);
			return pos + offset;
		};

		const size = aabb.getRotatedSize().mul(scale);
		return new Vector3(
			normal.X === 0 ? from(pos.X, size.X) : pos.X,
			normal.Y === 0 ? from(pos.Y, size.Y) : pos.Y,
			normal.Z === 0 ? from(pos.Z, size.Z) : pos.Z,
		);
	};
	const addTargetSize = (target: BasePart, normal: Vector3, pos: Vector3) => {
		let position: Vector3;
		let size: Vector3;

		const block = BlockManager.tryGetBlockModelByPart(target);
		if (block) {
			position = block.GetPivot().Position;
			size = fromModelBB(block).getRotatedSize();
		} else {
			position = target.Position;
			size = BB.fromPart(target).getRotatedSize();
		}

		DebugLog.multiNamed({ Y: size.Y });

		return pos.sub(pos.sub(position).mul(VectorUtils.apply(normal, math.abs))).add(size.div(2).mul(normal));
	};
	const offsetBlockPivotToCenter = (selectedBlock: ModelOnlyBlock, pos: Vector3) => {
		const pivot = selectedBlock.model.GetPivot().Position;
		const center = aabb.center.Position;
		const offset = rotation.mul(center.sub(pivot));

		return pos.sub(offset);
	};
	const addBlockSize = (normal: Vector3, pos: Vector3) => {
		return pos.add(aabb.getRotatedSize().mul(rotation.mul(scale).apply(math.abs)).mul(normal).div(2));
	};

	const target = info?.[0] ?? mouse.Target;
	if (!target) return;

	const mouseHit = info?.[1] ?? mouse.Hit;
	const mouseSurface = info?.[2] ?? mouse.TargetSurface;

	const globalMouseHitPos = mouseHit.PointToWorldSpace(Vector3.zero);
	const normal = target.CFrame.Rotation.VectorToWorldSpace(Vector3.FromNormalId(mouseSurface));

	const aabb = fromModelBB(block.model, rotation);
	let targetPosition = globalMouseHitPos;
	targetPosition = addTargetSize(target, normal, targetPosition);
	targetPosition = offsetBlockPivotToCenter(block, targetPosition);
	targetPosition = addBlockSize(normal, targetPosition);

	if (gridEnabled) {
		// костыль of fixing the plots position
		targetPosition = targetPosition.add(new Vector3(0, 0.5, 0.5));

		targetPosition = constrainPositionToGrid(normal, targetPosition);

		// костыль of fixing the plots position
		targetPosition = targetPosition.sub(new Vector3(0, 0.5, 0.5));
	}

	return targetPosition;
};
const getMouseTargetBlockPosition = getMouseTargetBlockPositionV2;

const processPlaceResponse = (response: Response) => {
	if (response?.success) {
		SoundController.getUISounds().Build.BlockPlace.PlaybackSpeed = SoundController.randomSoundSpeed();
		SoundController.getUISounds().Build.BlockPlace.Play();

		task.wait();
	} else {
		if (response) {
			LogControl.instance.addLine(response.message, Colors.red);
		}

		SoundController.getUISounds().Build.BlockPlaceError.Play();
	}
};

namespace Scene {
	type BlockInfoDefinition = GuiObject & {
		readonly ViewportFrame: ViewportFrame;
		readonly Frame: GuiObject & {
			readonly DescriptionLabel: TextLabel;
			readonly NameLabel: TextLabel;
		};
	};
	class BlockInfo extends Control<BlockInfoDefinition> {
		constructor(gui: BlockInfoDefinition, selectedBlock: ReadonlyObservableValue<Block | undefined>) {
			super(gui);

			this.visibilityComponent() //
				.addTransformFunc((enabling) => {
					const props = Transforms.quadOut02;
					const textSize = math.max(
						gui.Frame.NameLabel.TextBounds.X,
						gui.Frame.DescriptionLabel.TextBounds.X,
					);

					if (enabling) {
						return Transforms.create()
							.resize(gui.ViewportFrame, new UDim2(0, 50, 1, 0), props)
							.resize(gui.Frame, new UDim2(0, textSize, 1, 0), props)
							.then()
							.transform(gui.Frame, "AutomaticSize", Enum.AutomaticSize.X)
							.transform(gui.Frame, "Size", new UDim2(0, 0, 1, 0));
					}

					return Transforms.create()
						.transform(gui.Frame, "AutomaticSize", Enum.AutomaticSize.None)
						.transform(gui.Frame, "Size", new UDim2(0, textSize, 1, 0))
						.then()
						.resize(gui.ViewportFrame, new UDim2(0, 0, 1, 0), props)
						.resize(gui.Frame, new UDim2(0, 0, 1, 0), props);
				});

			const preview = this.add(new BlockPreviewControl(this.gui.ViewportFrame));
			this.event.subscribeObservable(
				selectedBlock,
				(block) => {
					this.gui.Visible = block !== undefined;
					preview.set(block?.model);

					if (block) {
						this.gui.Frame.NameLabel.Text = block.displayName;
						this.gui.Frame.DescriptionLabel.Text = block.description;
					} else {
						this.gui.Frame.NameLabel.Text = "";
						this.gui.Frame.DescriptionLabel.Text = "";
					}
				},
				true,
			);
			this.event.subscribeObservable(selectedBlock, (block) => {
				Transforms.create()
					.moveRelative(this.gui, new UDim2(0, 0, 0, -10), {
						...Transforms.commonProps.quadOut02,
						duration: 0.1,
					})
					.then()
					.moveRelative(this.gui, new UDim2(0, 0, 0, 10), {
						...Transforms.commonProps.quadOut02,
						duration: 0.1,
					})
					.run(this.gui);
			});
		}
	}

	@injectable
	class TouchButtons extends Component {
		constructor(
			selectedBlock: ReadonlyObservableValue<Block | undefined>,
			@inject tool: BuildTool,
			@inject mainScreen: MainScreenLayout,
		) {
			super();

			const isTouch = new ObservableValue(false);
			this.event.onPrepare((inputType) => isTouch.set(inputType === "Touch"));

			const isBlockSelected = this.event.addObservable(
				selectedBlock.fReadonlyCreateBased((b) => b !== undefined),
			);

			this.parent(mainScreen.right.push("+")) //
				.subscribeVisibilityFrom({ main: this.enabledState, isTouch, isBlockSelected })
				.addButtonAction(() => tool.placeBlock());
			this.parent(mainScreen.right.push("X"))
				.subscribeVisibilityFrom({ main: this.enabledState, isTouch, isBlockSelected })
				.addButtonAction(() => tool.rotateBlock("x"))
				.with((c) => (c.instance.BackgroundColor3 = Color3.fromRGB(52, 17, 17)));
			this.parent(mainScreen.right.push("Y"))
				.subscribeVisibilityFrom({ main: this.enabledState, isTouch, isBlockSelected })
				.addButtonAction(() => tool.rotateBlock("y"))
				.with((c) => (c.instance.BackgroundColor3 = Color3.fromRGB(81, 162, 0)));
			this.parent(mainScreen.right.push("Z"))
				.subscribeVisibilityFrom({ main: this.enabledState, isTouch, isBlockSelected })
				.addButtonAction(() => tool.rotateBlock("z"))
				.with((c) => (c.instance.BackgroundColor3 = Color3.fromRGB(18, 68, 144)));
			this.parent(mainScreen.right.push("++")) //
				.subscribeVisibilityFrom({ main: this.enabledState, isTouch, isBlockSelected })
				.addButtonAction(() => tool.multiPlaceBlock());
		}
	}

	export type BuildToolSceneDefinition = GuiObject & {
		readonly ActionBar: GuiObject & {
			readonly Buttons: GuiObject & {
				readonly Mirror: GuiButton;
			};
		};
		readonly Mirror: GuiObject & {
			readonly Content: MirrorEditorControlDefinition;
		};
		readonly Bottom: MaterialColorEditControlDefinition;
		readonly Info: BlockInfoDefinition;
		readonly Inventory: BlockSelectionControlDefinition;
	};
	@injectable
	export class BuildToolScene extends Component {
		readonly tool;
		readonly blockSelector;

		constructor(@inject tool: BuildTool, @inject mainScreen: MainScreenLayout, @inject di: DIContainer) {
			super();
			this.tool = tool;

			const inventory = this.parentGui(mainScreen.registerLeft<BlockSelectionControlDefinition>("Inventory"));
			this.blockSelector = this.parent(tool.di.resolveForeignClass(BlockSelectionControl, [inventory.instance]));

			const topLayer = this.parentGui(mainScreen.top.push());

			const blockInfo = topLayer.parentGui(
				new BlockInfo(
					Interface.getInterface<{
						Tools: { Shared: { Top: { CurrentBlock: BlockInfoDefinition } } };
					}>().Tools.Shared.Top.CurrentBlock.Clone(),
					this.blockSelector.selectedBlock,
				),
			);
			Anim.wrapInFrame(blockInfo.instance);

			this.parent(di.resolveForeignClass(TouchButtons, [this.blockSelector.selectedBlock]));

			{
				this.parentGui(mainScreen.addTopRightButton("mirror", 16686412951)) //
					.addButtonAction(() => (instance.Visible = !instance.Visible));

				const floatingTemplate = Interface.getInterface<{
					readonly Floating: GuiObject & {
						readonly Mirror: GuiObject & {
							readonly Content: MirrorEditorControlDefinition;
						};
					};
				}>().Floating;
				const instance = floatingTemplate.Mirror.Clone();
				instance.Parent = floatingTemplate;

				const mirrorEditor = this.parent(new MirrorEditorControl(instance.Content, tool.targetPlot.get()));
				this.event.subscribeObservable(tool.mirrorMode, (val) => mirrorEditor.value.set(val), true);
				this.event.subscribe(mirrorEditor.submitted, (val) => tool.mirrorMode.set(val));

				this.onEnable(() => (instance.Visible = false));
			}

			this.event.subscribeObservable(
				this.blockSelector.selectedBlock,
				(block) => this.tool.selectedBlock.set(block),
				true,
			);
			this.event.subscribeObservable(this.blockSelector.selectedBlock, () => {
				this.tool.blockRotation.set(CFrame.identity);
				this.tool.blockScale.set(Vector3.one);
			});

			{
				const enable = () => {
					// to not place a block
					task.wait();

					this.tool.controller.enable();
				};
				const disable = () => {
					this.tool.controller.disable();
				};

				const mceLayer = this.parentGui(mainScreen.bottom.push());
				const materialColorEditor = mceLayer.parent(MaterialColorEditControl.autoCreate());
				materialColorEditor.autoSubscribe(tool.selectedMaterial, tool.selectedColor);

				materialColorEditor.materialPipette.onStart.Connect(disable);
				materialColorEditor.materialPipette.onEnd.Connect(enable);
				materialColorEditor.colorPipette.onStart.Connect(disable);
				materialColorEditor.colorPipette.onEnd.Connect(enable);
				this.blockSelector.pipette.onStart.Connect(disable);
				this.blockSelector.pipette.onEnd.Connect(enable);
			}

			const updateSelectedBlock = () => {
				const block = tool.selectedBlock.get();
				if (!block) {
					this.blockSelector.selectedBlock.set(undefined);
					return;
				}

				if (
					this.blockSelector.selectedCategory.get()[this.blockSelector.selectedCategory.get().size() - 1] !==
					block.category[block.category.size() - 1]
				) {
					this.blockSelector.selectedCategory.set(block.category);
				}

				this.blockSelector.selectedBlock.set(block);
			};

			this.event.subscribeObservable(tool.selectedBlock, updateSelectedBlock);
		}
	}
}

interface IController extends Component {
	rotate(axis: "x" | "y" | "z", inverted?: boolean): void;
	place(): Promise<unknown>;
}
namespace SinglePlaceController {
	abstract class Controller extends Component implements IController {
		protected readonly tool: BuildTool;

		private mainGhost?: BlockModel;
		protected readonly blockRotation;
		protected readonly blockScale;
		protected readonly selectedBlock;
		protected readonly selectedColor;
		protected readonly selectedMaterial;
		protected readonly mirrorMode;
		protected readonly plot;
		protected readonly blockMirrorer;
		private readonly building;

		protected constructor(state: BuildTool, di: DIContainer) {
			super();

			this.building = di.resolve<ClientBuilding>();

			this.tool = state;
			this.selectedBlock = state.selectedBlock.asReadonly();
			this.selectedColor = state.selectedColor.asReadonly();
			this.selectedMaterial = state.selectedMaterial.asReadonly();
			this.mirrorMode = state.mirrorMode.asReadonly();
			this.plot = state.targetPlot;
			this.blockRotation = state.blockRotation;
			this.blockScale = state.blockScale;

			this.blockMirrorer = this.parent(di.resolveForeignClass(BlockMirrorer));

			this.event.onPrepare(() => this.updateBlockPosition());
			this.event.subscribeObservable(this.mirrorMode, () => this.updateBlockPosition());
			this.event.subscribe(Signals.CAMERA.MOVED, () => this.updateBlockPosition());
			this.event.subscribeObservable(this.selectedBlock, () => this.destroyGhosts());
			this.onDisable(() => this.destroyGhosts());

			const axis = ReplicatedStorage.Assets.Helpers.Axis.Clone();
			axis.Parent = Workspace;
			this.onDestroy(() => axis.Destroy());

			this.event.subscribe(RunService.PreRender, () => {
				if (this.mainGhost) {
					axis.PivotTo(this.mainGhost.GetPivot());
				} else {
					axis.PivotTo(new CFrame(0, -987654312, 0));
				}
			});
		}

		private destroyGhosts(destroyMain = true) {
			if (destroyMain) {
				this.blockMirrorer.blocks.set([]);
				this.mainGhost?.Destroy();
				this.mainGhost = undefined;
			}

			this.blockMirrorer.destroyMirrors();
		}
		private updateMirrorGhostBlocksPosition() {
			const selected = this.selectedBlock.get();
			if (!selected) return;

			const mainPosition = this.mainGhost?.GetPivot().Position;
			if (!mainPosition) return;

			if (this.mainGhost) {
				this.mainGhost.PivotTo(this.blockRotation.get().add(mainPosition));
				SharedBuilding.scale(this.mainGhost, this.selectedBlock.get()!.model, this.blockScale.get());
			}
			this.blockMirrorer.updatePositions(this.plot.get().instance, this.mirrorMode.get());
		}

		/** @param mainPosition If specified, overrides the mouse target position */
		protected updateBlockPosition(mainPosition?: Vector3) {
			if (!this.isEnabled()) {
				return;
			}

			const selectedBlock = this.selectedBlock.get();
			if (!selectedBlock) return;

			if (!mainPosition) {
				if (Interface.isCursorOnVisibleGui()) {
					return;
				}

				mainPosition = getMouseTargetBlockPosition(
					selectedBlock,
					this.blockRotation.get(),
					this.blockScale.get(),
					this.tool.mode.gridEnabled.get(),
					this.tool.mode.moveGrid.get(),
				);
			}
			if (!mainPosition) return;

			this.mainGhost ??= createBlockGhost(selectedBlock, this.blockScale.get());
			this.blockMirrorer.blocks.set([
				{
					id: selectedBlock.id,
					model: this.mainGhost,
					scale: this.blockScale.get(),
				},
			]);
			this.mainGhost.PivotTo(this.blockRotation.get().add(mainPosition));
			SharedBuilding.scale(this.mainGhost, this.selectedBlock.get()!.model, this.blockScale.get());

			const plot = this.plot.get();
			const getAreAllGhostsInsidePlot = () =>
				asMap(this.blockMirrorer.getMirroredModels()).all((k, ghosts) =>
					ghosts.all((ghost) => plot.bounds.isBBInside(BB.fromModel(ghost))),
				);
			const areAllBlocksInsidePlot =
				plot.bounds.isBBInside(BB.fromModel(this.mainGhost)) && getAreAllGhostsInsidePlot();

			if (areAllBlocksInsidePlot) {
				this.updateMirrorGhostBlocksPosition();
			} else {
				this.destroyGhosts(false);
			}

			const canBePlaced =
				areAllBlocksInsidePlot &&
				BuildingManager.blockCanBePlacedAt(plot, selectedBlock, this.mainGhost.GetPivot(), Vector3.one) &&
				asMap(this.blockMirrorer.getMirroredModels()).all((k, ghosts) =>
					ghosts.all((ghost) =>
						BuildingManager.blockCanBePlacedAt(plot, selectedBlock, ghost.GetPivot(), Vector3.one),
					),
				);

			BlockGhoster.setColor(canBePlaced ? allowedColor : forbiddenColor);
		}

		rotate(axis: "x" | "y" | "z", inverted = true): void {
			if (axis === "x") {
				this.rotateFineTune(new Vector3(inverted ? math.pi / 2 : math.pi / -2, 0, 0));
			} else if (axis === "y") {
				this.rotateFineTune(new Vector3(0, inverted ? math.pi / 2 : math.pi / -2, 0));
			} else if (axis === "z") {
				this.rotateFineTune(new Vector3(0, 0, inverted ? math.pi / 2 : math.pi / -2));
			}
		}

		protected rotateFineTune(rotation: CFrame | Vector3): void {
			if (typeIs(rotation, "Vector3")) {
				rotation = CFrame.fromEulerAnglesXYZ(rotation.X, rotation.Y, rotation.Z);
			}

			SoundController.getUISounds().Build.BlockRotate.PlaybackSpeed = SoundController.randomSoundSpeed();
			SoundController.getUISounds().Build.BlockRotate.Play();

			this.blockRotation.set(rotation.mul(this.blockRotation.get()));
			this.updateBlockPosition();
		}

		async place() {
			const selected = this.selectedBlock.get();
			if (!selected) {
				return;
			}

			const mainGhost = this.mainGhost;
			if (!mainGhost?.PrimaryPart) {
				return;
			}

			let blocks = [
				{ id: selected.id, pos: mainGhost.PrimaryPart!.CFrame },
				...asMap(this.blockMirrorer.getMirroredModels()).flatmap((k, v) =>
					v.map((v) => ({ id: k, pos: v.PrimaryPart!.CFrame })),
				),
			].map(
				(g): PlaceBlockRequest => ({
					id: g.id,
					color: this.selectedColor.get(),
					material: this.selectedMaterial.get(),
					scale: this.blockScale.get(),
					location: g.pos,
					uuid: undefined,
					config: undefined,
				}),
			);

			// filter out the blocks on the same location
			blocks = new Map(
				blocks.map((b) => [b.location.Position.apply((v) => MathUtils.round(v, 0.001)), b] as const),
			).map((_, b) => b);

			const response = await this.building.placeOperation.execute({ plot: this.plot.get(), blocks });
			processPlaceResponse(response);
			if (response.success) {
				this.updateBlockPosition();
			}
		}
	}
	@injectable
	class Desktop extends Controller {
		constructor(@inject state: BuildTool, @inject di: DIContainer) {
			super(state, di);

			state.subscribeSomethingToCurrentPlot(this, () => this.updateBlockPosition());
			this.event.subscribe(mouse.Move, () => this.updateBlockPosition());
			this.event.subInput((ih) => {
				ih.onMouse1Up(() => {
					if (Interface.isCursorOnVisibleGui()) {
						return;
					}

					this.place();
				}, false);
				const pick = () => {
					state.pickBlock();
					this.updateBlockPosition();
				};
				ih.onMouse3Down(pick, false);
				ih.onKeyDown("P", pick);

				ih.onKeyDown("T", () => this.rotate("x"));
				ih.onKeyDown("R", () => this.rotate("y"));
				ih.onKeyDown("Y", () => {
					if (InputController.isCtrlPressed()) return;
					this.rotate("z");
				});
			});
		}
	}
	@injectable
	class Touch extends Controller {
		private prevTarget: [target: BasePart, hit: CFrame, surface: Enum.NormalId] | undefined;

		constructor(@inject state: BuildTool, @inject di: DIContainer) {
			super(state, di);

			this.event.subInput((ih) => {
				ih.onTouchTap(() => {
					if (!Interface.isCursorOnVisibleGui()) {
						const target = mouse.Target;
						if (target) {
							this.prevTarget = [target, mouse.Hit, mouse.TargetSurface];
						}
					}

					this.updateBlockPosition();
				}, false);
			});
		}

		protected updateBlockPosition(): void {
			const selectedBlock = this.selectedBlock.get();
			if (!selectedBlock) return;

			const mainPosition = getMouseTargetBlockPosition(
				selectedBlock,
				this.blockRotation.get(),
				this.blockScale.get(),
				this.tool.mode.gridEnabled.get(),
				this.tool.mode.moveGrid.get(),
				this.prevTarget,
			);
			super.updateBlockPosition(mainPosition);
		}
	}
	@injectable
	class Gamepad extends Desktop {
		constructor(@inject state: BuildTool, @inject di: DIContainer) {
			super(state, di);

			this.event.subInput((ih) => {
				const pick = () => {
					state.pickBlock();
					this.updateBlockPosition();
				};
				ih.onMouse3Down(pick, false);
				ih.onKeyDown("P", pick);

				ih.onKeyDown("ButtonX", () => this.place());
				ih.onKeyDown("DPadLeft", () => this.rotate("x"));
				ih.onKeyDown("DPadUp", () => this.rotate("y"));
				ih.onKeyDown("DPadRight", () => this.rotate("z"));
			});
		}
	}

	export function create(tool: BuildTool, di: DIContainer) {
		di = di.beginScope((di) => di.registerSingletonValue(tool));

		return ClientComponentChild.createOnceBasedOnInputType({
			Desktop: () => di.resolveForeignClass(Desktop),
			Touch: () => di.resolveForeignClass(Touch),
			Gamepad: () => di.resolveForeignClass(Gamepad),
		});
	}
}

namespace MultiPlaceController {
	export abstract class Base extends Component implements IController {
		private readonly possibleFillRotationAxis = [Vector3.xAxis, Vector3.yAxis, Vector3.zAxis] as const;
		private readonly blocksFillLimit = 16;
		private readonly drawnGhostsMap = new Map<Vector3, Model>();
		private readonly blockMirrorer;
		private readonly floatingText;
		private oldPositions?: {
			readonly positions: Set<Vector3>;
			endPoint: Vector3;
			readonly rotation: CFrame;
		};
		private fillRotationMode = 1;
		private readonly building;

		protected constructor(
			protected readonly pressPosition: Vector3,
			private readonly selectedBlock: Block,
			private readonly selectedColor: Color4,
			private readonly selectedMaterial: Enum.Material,
			private readonly mirrorModes: MirrorMode,
			private readonly plot: SharedPlot,
			private readonly blockRotation: CFrame,
			private readonly blockScale: Vector3,
			di: DIContainer,
		) {
			super();
			this.building = di.resolve<ClientBuilding>();
			this.blockMirrorer = this.parent(di.resolveForeignClass(BlockMirrorer));
			this.floatingText = this.parent(FloatingText.create(BlockGhoster.parent));

			this.onDisable(() => {
				for (const [, ghost] of this.drawnGhostsMap) {
					ghost.Destroy();
				}

				this.drawnGhostsMap.clear();
			});

			this.onEnable(() => this.updateGhosts());
		}
		protected updateGhosts(pos?: Vector3) {
			if (!pos) {
				const cameraPostion = Workspace.CurrentCamera!.CFrame.Position;
				const hit = mouse.Hit.Position;
				const clickDirection = cameraPostion.sub(hit).Unit;
				pos = this.getPositionOnBuildingPlane(this.pressPosition, cameraPostion, clickDirection);
			}

			const plotBounds = this.plot.bounds;
			const positionsData = this.calculateGhostBlockPositions(this.selectedBlock.model, this.pressPosition, pos);
			if (!positionsData) return;
			if (!plotBounds.isPointInside(this.pressPosition)) return;
			if (this.oldPositions?.positions === positionsData.positions) return;

			const oldPositions = this.oldPositions?.positions ?? new Set();
			const newPositions = positionsData.positions;

			const toDelete = oldPositions.filter((p) => !newPositions.has(p));
			for (const pos of toDelete) {
				this.drawnGhostsMap.get(pos)?.Destroy();
				this.drawnGhostsMap.delete(pos);
			}

			const newposs = newPositions.filter((p) => !oldPositions.has(p));
			const newModels = this.drawModels(newposs, positionsData.rotation);

			for (const model of newModels) {
				this.drawnGhostsMap.set(model.GetPivot().Position, model);
			}

			this.oldPositions = positionsData;

			this.blockMirrorer.blocks.set(
				this.drawnGhostsMap.map((_, m) => ({ id: this.selectedBlock.id, model: m, scale: this.blockScale })),
			);
			this.blockMirrorer.updatePositions(this.plot.instance, this.mirrorModes);
		}

		rotate(axis: "x" | "y" | "z", inverted?: boolean | undefined): void {
			this.rotateFillAxis();
		}

		private drawModels(positions: readonly Vector3[], rotation: CFrame) {
			const allGhosts: Model[] = [];

			for (const pos of positions) {
				const ghostFrame = new CFrame(pos).mul(rotation);
				const ghost = createBlockGhost(this.selectedBlock, this.blockScale);
				ghost.PivotTo(ghostFrame);
				allGhosts.push(ghost);
			}

			return allGhosts;
		}

		private calculateGhostBlockPositions(part: BlockModel, from: Vector3, to: Vector3): typeof this.oldPositions {
			if (this.oldPositions?.endPoint === to) {
				return this.oldPositions;
			}

			const aabb = fromModelBB(part, this.blockRotation.Rotation);
			const baseBlockSize = BB.from(part).originalSize;
			const blockSize = aabb.getRotatedSize().mul(this.blockScale);
			const diff = to.sub(from);

			const trg = diff.Abs().Min(baseBlockSize.mul(this.blockScale).mul(this.blocksFillLimit).apply(math.floor));
			const result: Vector3[] = [];

			const xs = math.floor(trg.X / blockSize.X) + 1;
			const ys = math.floor(trg.Y / blockSize.Y) + 1;
			const zs = math.floor(trg.Z / blockSize.Z) + 1;
			this.floatingText.text.set(`${xs}, ${ys}, ${zs}`);

			for (let x = 0; x <= trg.X; x += blockSize.X) {
				for (let y = 0; y <= trg.Y; y += blockSize.Y) {
					for (let z = 0; z <= trg.Z; z += blockSize.Z) {
						const posX = math.sign(diff.X) * x + from.X;
						const posY = math.sign(diff.Y) * y + from.Y;
						const posZ = math.sign(diff.Z) * z + from.Z;
						result.push(new Vector3(posX, posY, posZ));
					}
				}
			}

			return {
				positions: new Set(result),
				endPoint: to ?? from,
				rotation: this.blockRotation,
			};
		}
		protected getPositionOnBuildingPlane(blockPosition: Vector3, cameraPostion: Vector3, lookVector: Vector3) {
			const rotation = this.getCurrentFillRotation();
			const plane = blockPosition.mul(VectorUtils.apply(rotation, (v) => math.abs(v)));
			const diff = cameraPostion.sub(plane);
			let distance = 0;

			switch (1) {
				case rotation.X: //I really liked the "!!rotation.X" solution but compiler didn't :(
					distance = diff.X / lookVector.X;
					break;
				case rotation.Y:
					distance = diff.Y / lookVector.Y;
					break;
				case rotation.Z:
					distance = diff.Z / lookVector.Z;
					break;
			}

			return lookVector.mul(-distance).add(cameraPostion);
		}

		protected rotateFillAxis() {
			this.fillRotationMode = (this.fillRotationMode + 1) % this.possibleFillRotationAxis.size();
		}
		private getCurrentFillRotation() {
			return this.possibleFillRotationAxis[this.fillRotationMode];
		}

		async place() {
			let locations = [
				...this.blockMirrorer.blocks.get().map(({ id, model }) => ({ id, pos: model.GetPivot() })),
				...asMap(this.blockMirrorer.getMirroredModels()).flatmap((id, models) =>
					models.map((model) => ({ id, pos: model.GetPivot() })),
				),
			];
			/*let locations = this.drawnGhostsMap.flatmap((_, m) => [
				{ id: this.selectedBlock.id, pos: m.GetPivot() },
				...BuildingManager.getMirroredBlocks(
					this.plot.instance,
					{ id: this.selectedBlock.id, pos: m.GetPivot() },
					this.mirrorModes,
				),
			]);*/
			// filter out the blocks on the same location
			locations = new Map(
				locations.map((b) => [b.pos.Position.apply((v) => MathUtils.round(v, 0.001)), b] as const),
			).map((_, b) => b);

			const response = await this.building.placeOperation.execute({
				plot: this.plot,
				blocks: locations.map(
					(loc): PlaceBlockRequest => ({
						id: loc.id,
						color: this.selectedColor,
						material: this.selectedMaterial,
						scale: this.blockScale,
						location: loc.pos,
						uuid: undefined,
						config: undefined,
					}),
				),
			});
			processPlaceResponse(response);

			return response;
		}
	}
	@injectable
	class Desktop extends Base {
		constructor(
			pressPosition: Vector3,
			selectedBlock: Block,
			selectedColor: Color4,
			selectedMaterial: Enum.Material,
			mirrorModes: MirrorMode,
			plot: SharedPlot,
			blockRotation: CFrame,
			blockScale: Vector3,
			@inject di: DIContainer,
		) {
			super(
				pressPosition,
				selectedBlock,
				selectedColor,
				selectedMaterial,
				mirrorModes,
				plot,
				blockRotation,
				blockScale,
				di,
			);

			this.event.subInput((ih, eh) => {
				const buttonUnpress = async () => {
					await this.place();
					this.destroy();
				};
				ih.onMouse1Up(buttonUnpress, true);
				ih.onKeyUp("ButtonR2", buttonUnpress);
				eh.subscribe(UserInputService.TouchEnded, buttonUnpress);
			});

			this.event.subscribe(mouse.Move, () => this.updateGhosts());
			this.event.subscribe(Signals.CAMERA.MOVED, () => this.updateGhosts());
			this.event.subInput((ih) => ih.onKeyDown("R", () => this.rotateFillAxis()));
		}
	}
	@injectable
	class Touch extends Base {
		private prevTarget: [cameraPostion: Vector3, lookVector: Vector3] | undefined;

		constructor(
			pressPosition: Vector3,
			selectedBlock: Block,
			selectedColor: Color4,
			selectedMaterial: Enum.Material,
			mirrorModes: MirrorMode,
			plot: SharedPlot,
			blockRotation: CFrame,
			blockScale: Vector3,
			@inject di: DIContainer,
		) {
			super(
				pressPosition,
				selectedBlock,
				selectedColor,
				selectedMaterial,
				mirrorModes,
				plot,
				blockRotation,
				blockScale,
				di,
			);

			this.event.subInput((ih) => {
				ih.onTouchTap(() => {
					const cameraPostion = Workspace.CurrentCamera!.CFrame.Position;
					const hit = mouse.Hit.Position;
					const clickDirection = cameraPostion.sub(hit).Unit;
					this.prevTarget = [cameraPostion, clickDirection];

					this.updateGhosts();
				}, false);
			});
		}

		protected updateGhosts(): void {
			if (this.prevTarget) {
				const pos = this.getPositionOnBuildingPlane(this.pressPosition, this.prevTarget[0], this.prevTarget[1]);
				super.updateGhosts(pos);
			} else {
				super.updateGhosts(this.pressPosition);
			}
		}
	}

	abstract class Starter extends Component {
		constructor(state: BuildTool, parent: ComponentChild<IController>) {
			super();
		}
	}
	@injectable
	class DesktopStarter extends Starter {
		constructor(state: BuildTool, parent: ComponentChild<IController>, @inject di: DIContainer) {
			super(state, parent);

			this.event.subInput((ih) => {
				ih.onMouse1Down(() => {
					if (InputController.isShiftPressed()) {
						init(state, parent, di);
					}
				}, false);
			});
		}
	}
	@injectable
	class TouchStarter extends Starter {
		constructor(state: BuildTool, parent: ComponentChild<IController>, @inject di: DIContainer) {
			super(state, parent);
		}
	}
	@injectable
	class GamepadStarter extends Starter {
		constructor(state: BuildTool, parent: ComponentChild<IController>, @inject di: DIContainer) {
			super(state, parent);

			this.event.subInput((ih) => {
				ih.onKeyDown("ButtonR2", () => {
					if (InputController.isShiftPressed()) {
						// TODO: shift with controller??
						init(state, parent, di);
					}
				});
			});
		}
	}

	export function subscribe(state: BuildTool, parent: ComponentChild<IController>, di: DIContainer) {
		ClientComponentChild.registerBasedOnInputType(state, {
			Desktop: () => di.resolveForeignClass(DesktopStarter, [state, parent]),
			Touch: () => di.resolveForeignClass(TouchStarter, [state, parent]),
			Gamepad: () => di.resolveForeignClass(GamepadStarter, [state, parent]),
		});
	}
	export function init(
		state: BuildTool,
		parent: ComponentChild<IController>,
		di: DIContainer,
		prevTarget?: [target: BasePart, hit: CFrame, surface: Enum.NormalId],
	) {
		const selectedBlock = state.selectedBlock.get();
		if (!selectedBlock) return;

		const pressPosition = getMouseTargetBlockPosition(
			selectedBlock,
			state.blockRotation.get(),
			state.blockScale.get(),
			state.mode.gridEnabled.get(),
			state.mode.moveGrid.get(),
			prevTarget,
		);
		if (!pressPosition) return;

		const plot = state.targetPlot.get();
		const args = [
			pressPosition,
			selectedBlock,
			state.selectedColor.get(),
			state.selectedMaterial.get(),
			state.mirrorMode.get(),
			plot,
			state.blockRotation.get(),
			state.blockScale.get(),
		] as const;

		parent.set(
			ClientComponentChild.createOnceBasedOnInputType({
				Desktop: () => di.resolveForeignClass(Desktop, args),
				Touch: () => di.resolveForeignClass(Touch, args),
				Gamepad: () => di.resolveForeignClass(Desktop, args),
			}),
		);
	}
}

/** A tool for building in the world with blocks */
@injectable
export class BuildTool extends ToolBase {
	readonly selectedMaterial = new ObservableValue<Enum.Material>(Enum.Material.Plastic);
	readonly selectedColor = new ObservableValue<Color4>({ color: Color3.fromRGB(255, 255, 255), alpha: 1 });
	readonly selectedBlock = new ObservableValue<Block | undefined>(undefined);
	readonly currentMode = this.parent(new ComponentChild<IController>(true));
	readonly blockRotation = new ObservableValue<CFrame>(CFrame.identity);
	readonly blockScale = new ObservableValue<Vector3>(Vector3.one, (v) =>
		v.Max(new Vector3(1 / 16, 1 / 16, 1 / 16)).Min(new Vector3(8, 8, 8)),
	);
	readonly controller;
	readonly gui;

	constructor(
		@inject readonly mode: BuildingMode,
		@inject readonly di: DIContainer,
		@inject readonly blockList: BlockList,
	) {
		super(mode);

		this.gui = this.parent(di.resolveForeignClass(Scene.BuildToolScene));

		this.controller = this.parent(new Component());
		this.controller.onEnable(() => this.currentMode.set(SinglePlaceController.create(this, di)));
		this.controller.onDisable(() => this.currentMode.set(undefined));

		this.currentMode.childSet.Connect((mode) => {
			if (!this.isEnabled() || !this.controller.isEnabled()) return;
			if (mode) return;

			this.currentMode.set(SinglePlaceController.create(this, di));
		});

		MultiPlaceController.subscribe(this, this.currentMode, di);
	}

	supportsMirror() {
		return true;
	}

	placeBlock() {
		return this.currentMode.get()?.place();
	}
	multiPlaceBlock() {
		if (this.currentMode.get() instanceof MultiPlaceController.Base) {
			this.placeBlock();
			return;
		}

		const current = this.currentMode.get();

		MultiPlaceController.init(
			this,
			this.currentMode,
			this.di,
			current && "prevTarget" in current ? (current.prevTarget as never) : undefined,
		);
	}
	rotateBlock(axis: "x" | "y" | "z", inverted = true) {
		return this.currentMode.get()?.rotate(axis, inverted);
	}

	pickBlock() {
		const target = this.mouse.Target;
		if (!target) return;

		let model = target as BlockModel | BasePart;
		while (!model.IsA("Model")) {
			model = model.Parent as BlockModel | BasePart;
			if (!model) return;
		}

		const id = BlockManager.manager.id.get(model);
		if (id === undefined) return; // not a block

		const block = this.blockList.blocks[id];
		if (!block) return;

		this.selectedBlock.set(block);

		const material = BlockManager.manager.material.get(model);
		this.selectedMaterial.set(material);

		this.selectedColor.set(BlockManager.manager.color.get(model));

		if (!target.IsDescendantOf(this.targetPlot.get().instance)) {
			this.blockRotation.set(CFrame.identity);
			this.blockScale.set(Vector3.one);
		} else {
			this.blockRotation.set(model.GetPivot().Rotation);
			this.blockScale.set(BlockManager.manager.scale.get(model) ?? Vector3.one);
		}
	}

	getDisplayName(): string {
		return "Building";
	}
	getImageID(): string {
		return "rbxassetid://12539295858";
	}

	protected getTooltips(): readonly Tooltip[] {
		return [
			{ keys: [["R"], ["DPadLeft"]], text: "Rotate by Y" },
			{ keys: [["T"], ["DPadUp"]], text: "Rotate by X" },
			{ keys: [["Y"], ["DPadRight"]], text: "Rotate by Z" },
			{ keys: [["LeftControl"]], text: "Disable grid" },

			{ keys: [["ButtonX"]], text: "Place" },
			{ keys: [["ButtonB"]], text: "Unequip" },
			{ keys: [["ButtonSelect"]], text: "Select block" },
		];
	}
}
