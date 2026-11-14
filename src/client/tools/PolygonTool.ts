import { ReplicatedStorage, RunService, Workspace } from "@rbxts/services";
import { SoundController } from "client/controller/SoundController";
import { castCursor, getCursorRay, hitFaceNormal } from "client/CursorService";
import { BlockSelectionControl } from "client/gui/buildmode/BlockSelection";
import { MaterialColorEditControl } from "client/gui/buildmode/MaterialColorEditControl";
import { ToggleControl } from "client/gui/controls/ToggleControl";
import { LogControl } from "client/gui/static/LogControl";
import { BlockGhoster } from "client/tools/additional/BlockGhoster";
import { FloatingText } from "client/tools/additional/FloatingText";
import { MoveGrid } from "client/tools/additional/Grid";
import { ToolBase } from "client/tools/ToolBase";
import { Action } from "engine/client/Action";
import { ClientComponentChild } from "engine/client/component/ClientComponentChild";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { InputController } from "engine/client/InputController";
import { Keybinds } from "engine/client/Keybinds";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { Element } from "engine/shared/Element";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Signal } from "engine/shared/event/Signal";
import { BB } from "engine/shared/fixes/BB";
import { Instances } from "engine/shared/fixes/Instances";
import { Strings } from "engine/shared/fixes/String.propmacro";
import { BlockManager } from "shared/building/BlockManager";
import { BuildingManager } from "shared/building/BuildingManager";
import { Colors } from "shared/Colors";
import { PartGeometry } from "shared/utils/PartGeometry";
import { PolygonGeometry } from "shared/utils/PolygonGeometry";
import { VectorUtils } from "shared/utils/VectorUtils";
import type { CursorHit } from "client/CursorService";
import type { BlockSelectionControlDefinition } from "client/gui/buildmode/BlockSelection";
import type { ToggleControlDefinition } from "client/gui/controls/ToggleControl";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { ActionController } from "client/modes/build/ActionController";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ClientBuilding } from "client/modes/build/ClientBuilding";
import type { Theme } from "client/Theme";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type { SharedPlot } from "shared/building/SharedPlot";

const allowedColor = Colors.blue;
const forbiddenColor = Colors.red;

const alignmentCycle: readonly ShapeAlignment[] = ["top", "center", "bottom"];

const fromModelBB = (block: Model, additionalRotation?: CFrame): BB => {
	const colbox = block.PrimaryPart;
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

// GapFill's vertex snap distance: depth from the camera / 80
const cornerSnapDepthRatio = 1 / 80;

const snapToCorner = (target: BasePart, hitPos: Vector3): Vector3 | undefined => {
	const camera = Workspace.CurrentCamera;
	if (!camera) return;

	const best = PartGeometry.nearestSnapPoint(target, hitPos);
	if (!best) return;

	const depth = best.sub(camera.CFrame.Position).Dot(camera.CFrame.LookVector);
	return best.sub(hitPos).Magnitude < depth * cornerSnapDepthRatio ? best : undefined;
};

const getMouseTargetBlockPositionV3 = (
	block: BlockModel,
	rotation: CFrame,
	scale: Vector3,
	gridEnabled: boolean,
	step: number,
	info?: CursorHit,
): Vector3 | undefined => {
	const snapFaceCorner = (target: BasePart, hitWorld: Vector3, faceWorld: Vector3, step: number) => {
		const cf = target.CFrame;
		const hitLocal = cf.PointToObjectSpace(hitWorld);
		const faceLocal = cf.VectorToObjectSpace(faceWorld);

		const absNormal = faceLocal.Abs();

		const size = target.Size;
		const half = size.div(2);

		const snap = (v: number, min: number) => {
			const t = (v - min) / step;
			return min + math.round(t) * step;
		};

		let localPos: Vector3;

		if (absNormal.X > absNormal.Y && absNormal.X > absNormal.Z) {
			localPos = new Vector3(
				math.sign(faceLocal.X) * half.X,
				snap(hitLocal.Y, -half.Y),
				snap(hitLocal.Z, -half.Z),
			);
		} else if (absNormal.Y > absNormal.Z) {
			localPos = new Vector3(
				snap(hitLocal.X, -half.X),
				math.sign(faceLocal.Y) * half.Y,
				snap(hitLocal.Z, -half.Z),
			);
		} else {
			localPos = new Vector3(
				snap(hitLocal.X, -half.X),
				snap(hitLocal.Y, -half.Y),
				math.sign(faceLocal.Z) * half.Z,
			);
		}

		return cf.PointToWorldSpace(localPos);
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

		return pos.sub(pos.sub(position).mul(VectorUtils.apply(normal, math.abs))).add(size.div(2).mul(normal));
	};
	const offsetBlockPivotToCenter = (selectedModel: BlockModel, pos: Vector3) => {
		const pivot = selectedModel.GetPivot().Position;
		const center = aabb.center.Position;
		const offset = rotation.mul(center.sub(pivot));

		return pos.sub(offset);
	};
	const addBlockSize = (normal: Vector3, pos: Vector3) => {
		return pos.add(aabb.getRotatedSize().mul(rotation.mul(scale).apply(math.abs)).mul(normal).div(2));
	};

	const hit = info ?? castCursor("world");
	if (!hit) return;

	const target = hit.part;
	const globalMouseHitPos = hit.position;
	const normal = hitFaceNormal(hit);

	const aabb = fromModelBB(block, rotation);
	let targetPosition = globalMouseHitPos;
	targetPosition = addTargetSize(target, normal, targetPosition);
	targetPosition = offsetBlockPivotToCenter(block, targetPosition);
	targetPosition = addBlockSize(normal, targetPosition);

	if (gridEnabled) {
		targetPosition = snapFaceCorner(target, targetPosition, normal, step);
	}

	return snapToCorner(target, globalMouseHitPos) ?? targetPosition;
};

const partsToModel = (parts: BasePart[]) => {
	const model = new Instance("Model");
	for (const part of parts) {
		part.Parent = model;
	}
	return model;
};

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
	@injectable
	class TouchButtons extends Component {
		constructor(@inject tool: PolygonTool, @inject mainScreen: MainScreenLayout) {
			super();

			const isTouch = new ObservableValue(false);
			this.event.onPrepare((inputType) => isTouch.set(inputType === "Touch"));

			this.parent(mainScreen.right.push("+")) //
				.subscribeVisibilityFrom({ main: this.enabledState, isTouch })
				.addButtonAction(() => tool.addPoint(tool.targetPointPosition));
			const hasPoints = new ObservableValue(false);
			this.parent(mainScreen.right.push("Undo Point")) //
				.subscribeVisibilityFrom({ main: this.enabledState, isTouch, hasPoints })
				.addButtonAction(() => tool.undoLastPoint());
			// the build tool's rotate colour
			this.parent(mainScreen.right.push("Rotate"))
				.subscribeVisibilityFrom({ main: this.enabledState, isTouch, hasPoints })
				.subscribeToAction(tool.rotateAction)
				.with((c) => (c.instance.BackgroundColor3 = Color3.fromRGB(81, 162, 0)));
			const possibleShape = new ObservableValue(false);
			this.parent(mainScreen.right.push("Confirm")) //
				.subscribeVisibilityFrom({ main: this.enabledState, isTouch, possibleShape })
				.addButtonAction(() => tool.placeTheShape());

			tool.pointsChange.Connect(() => {
				const pointCount = tool.placedPoints.get().size();
				hasPoints.set(pointCount !== 0);
				possibleShape.set(pointCount >= tool.shape.get().minPoints);
			});
		}
	}

	@injectable
	export class PolygonToolScene extends Component {
		readonly tool;

		constructor(@inject tool: PolygonTool, @inject mainScreen: MainScreenLayout, @inject di: DIContainer) {
			super();
			this.tool = tool;

			this.parent(di.resolveForeignClass(TouchButtons));

			{
				const blockList = di.resolve<BlockList>();
				const inventory = this.parentGui(
					mainScreen.registerLeft<BlockSelectionControlDefinition>("CuratedInventory"),
				);
				// the menu matches its selection by object, so the renamed copies are the ones handed back to it
				const menuBlocks = new Map<BlockId, Block>();
				for (const curated of curatedBlocks) {
					const block = blockList.blocks[curated.id]!;
					menuBlocks.set(
						curated.id,
						curated.displayName ? { ...block, displayName: curated.displayName } : block,
					);
				}
				const menu = this.parent(
					di.resolveForeignClass(BlockSelectionControl, [
						inventory.instance,
						curatedBlocks.map((c) => menuBlocks.get(c.id)!),
					]),
				);

				const showSelected = () => {
					const block = menuBlocks.get(tool.selectedBlock.get().id)!;
					const category = menu.selectedCategory.get();
					if (category[category.size() - 1] !== block.category[block.category.size() - 1]) {
						menu.selectedCategory.set(block.category);
					}

					menu.selectedBlock.set(block);
				};
				this.event.subscribeObservable(tool.selectedBlock, showSelected, true);

				menu.pipette.onStart.Connect(() => tool.controller.disable());
				menu.pipette.onEnd.Connect(() => {
					// to not place a point
					task.wait();
					tool.controller.enable();
				});
				this.event.subscribeObservable(menu.selectedBlock, (block) => {
					const curated = block && curatedBlocks.find((c) => c.id === block.id);
					// the tool always builds with something, so a cleared selection shows the current block again
					if (!curated) return showSelected();

					tool.selectedBlock.set(curated);
				});
			}

			{
				const newToggle = (name: string, value: ObservableValue<boolean>) => {
					const template = Interface.getInterface<{
						Tools: {
							Shared: {
								Bottom: {
									Toggle: GuiObject & {
										readonly Data: { readonly TitleLabel: TextLabel };
										readonly Toggle: ToggleControlDefinition;
									};
								};
							};
						};
					}>().Tools.Shared.Bottom.Toggle;

					const gui = template.Clone();
					gui.Data.TitleLabel.Text = name.upper();
					gui.Visible = true;

					const control = new Control(gui);
					const toggle = control.parent(new ToggleControl(gui.Toggle));
					value.connect(toggle.value);
					toggle.value.subscribe((v) => this.tool.updateView());

					return control;
				};

				const topLayer = this.parentGui(mainScreen.top.push());
				topLayer.parentGui(newToggle("Manual Winding", tool.manualWinding));
				topLayer.parentGui(newToggle("Flip Normal", tool.flippedNormal));
				topLayer.parentGui(newToggle("Precision mode", tool.precisionMode));
			}
		}
	}
}

namespace PlaceController {
	abstract class Controller extends Component {
		protected readonly tool: PolygonTool;
		constructor(state: PolygonTool, di: DIContainer) {
			super();
			this.tool = state;

			this.onDisable(() => state.hideEverything());

			this.event.subscribe(RunService.PreRender, () => {
				if (Interface.isCursorOnVisibleGui()) return;
				state.updateTargetPoint();
			});
		}
	}
	@injectable
	class Desktop extends Controller {
		constructor(@inject state: PolygonTool, @inject di: DIContainer) {
			super(state, di);

			this.event.subInput((ih) => {
				ih.onMouse1Up(() => {
					if (Interface.isCursorOnVisibleGui()) return;
					this.tool.addPoint(this.tool.targetPointPosition);
				}, false);

				ih.onMouse3Down(() => this.pick(), false);
				ih.onKeyDown("P", (io) => {
					// ignore freecam's shift+p shortcut
					if (io.IsModifierKeyDown("Shift")) return;
					this.pick();
				});
			});
		}

		protected pick() {
			this.tool.pickBlock();
			this.tool.hideEverything();
		}
	}
	@injectable
	export class Touch extends Controller {
		prevTarget: CursorHit | undefined;

		constructor(@inject state: PolygonTool, @inject di: DIContainer) {
			super(state, di);

			this.event.subInput((ih) => {
				ih.onTouchTap(() => {
					if (Interface.isCursorOnVisibleGui()) return;

					const hit = castCursor("world");
					if (hit) {
						this.prevTarget = hit;
					}
				}, false);
			});
		}
	}
	@injectable
	class Gamepad extends Desktop {
		constructor(@inject state: PolygonTool, @inject di: DIContainer) {
			super(state, di);

			this.event.subInput((ih) => {
				ih.onKeyDown("ButtonX", () => this.tool.addPoint(this.tool.targetPointPosition));
				ih.onKeyDown("ButtonY", () => this.tool.undoLastPoint());
				ih.onKeyDown("DPadLeft", () => this.tool.manualWinding.toggle());
				ih.onKeyDown("DPadRight", () => this.tool.flippedNormal.toggle());
				// D-pad Up rotates, as in the build tool, so alignment cycles on one button
				ih.onKeyDown("DPadDown", () => {
					const align = this.tool.alignment;
					align.set(alignmentCycle[(alignmentCycle.indexOf(align.get()) + 1) % alignmentCycle.size()]);
				});
			});
		}

		protected override pick() {
			this.tool.pickBlock();
			this.tool.updateTargetPoint();
		}
	}

	export function create(tool: PolygonTool, di: DIContainer) {
		di = di.beginScope((di) => di.registerSingletonValue(tool));

		return ClientComponentChild.createOnceBasedOnInputType<Controller>({
			Desktop: () => di.resolveForeignClass(Desktop),
			Touch: () => di.resolveForeignClass(Touch),
			Gamepad: () => di.resolveForeignClass(Gamepad),
		});
	}
}

// helper for creating a target
const makeTargetBall = (target: Vector3 | undefined, name = "shapedot") => {
	// fixme: should be a Studio asset
	const part = new Instance("Part");
	part.Shape = Enum.PartType.Ball;
	part.Size = Vector3.one.mul(0.25);
	part.Anchored = true;

	const partModel = partsToModel([part]);
	partModel.PrimaryPart = part;
	BlockGhoster.ghostModel(partModel);
	partModel.Name = name;
	if (target) partModel.PivotTo(new CFrame(target));
	return partModel;
};

const MoveHandlesHelper = ReplicatedStorage.Assets.Helpers.EditHandles.Move;
type HandleDef = typeof MoveHandlesHelper;
type ModelHandleDef = Omit<HandleDef, keyof Instance> & Model;

const forEachHandle = (handles: HandleDef | ModelHandleDef, func: (handle: Handles) => void) => {
	func(handles.XHandles);
	func(handles.YHandles);
	func(handles.ZHandles);
};

const updateBallSize = (thisPos: Vector3, thisDot: Model, otherPositions: Vector3[]) => {
	const defaultSize = 0.25;
	const minSize = 0.05;

	// Find closest distance
	let closestDist = math.huge;
	for (const otherPos of otherPositions) {
		if (otherPos === thisPos) continue;

		const dist = thisPos.sub(otherPos).Magnitude;
		if (dist < closestDist) closestDist = dist;
	}

	let size = defaultSize;
	if (closestDist < defaultSize) {
		size = math.max(closestDist, minSize);
	}

	// PrimaryPart will always exist if the part exists
	thisDot.PrimaryPart!.Size = Vector3.one.mul(size);
};

const formatVecForFloatingText = (vec: Vector3, positive: boolean = true): string => {
	const format = (num: number): string => {
		const str = Strings.prettyNumber(num, 0.01);
		if (num > 0 && positive) return `+${str}`;

		return `${str}`;
	};

	return `${format(vec.X)}, ${format(vec.Y)}, ${format(vec.Z)}`;
};

class HandleMovementController extends Component {
	constructor(handle: Handles, update: (delta: Vector3, face: Enum.NormalId) => void, release: () => void) {
		super();

		const findRayPlaneIntersection = (
			rayOrigin: Vector3,
			rayDirection: Vector3,
			planeOrigin: Vector3,
			planeNormal: Vector3,
		): Vector3 | undefined => {
			const denominator = rayDirection.Dot(planeNormal);
			if (math.abs(denominator) < 1e-6) {
				return undefined;
			}

			const rayToPlane = planeOrigin.sub(rayOrigin);
			const t = rayToPlane.Dot(planeNormal) / denominator;
			if (t < 0) {
				return undefined;
			}

			return rayOrigin.add(rayDirection.mul(t));
		};
		const calculateCursorDeltaVecOnPlane = (arrowPosition: Vector3, arrowDirection: Vector3): (() => Vector3) => {
			const startingMouseRay = getCursorRay();
			const mouseRay = startingMouseRay;

			const startingPosition = findRayPlaneIntersection(
				mouseRay.Origin,
				mouseRay.Direction,
				arrowPosition,
				mouseRay.Direction,
			);
			if (!startingPosition) return () => Vector3.zero;

			return () => {
				const mouseRay = getCursorRay();

				const point = findRayPlaneIntersection(
					mouseRay.Origin,
					mouseRay.Direction,
					startingPosition,
					startingMouseRay.Direction,
				);
				if (!point) return Vector3.zero;

				const diff = point.sub(startingPosition);
				const rotatedDiff = CFrame.lookAt(Vector3.zero, arrowDirection).PointToObjectSpace(diff);

				return arrowDirection.mul(-rotatedDiff.Z);
			};
		};

		let f: Enum.NormalId | undefined;
		let cu: (() => Vector3) | undefined;
		const upd = () => {
			if (!cu || !f) return;
			update(cu(), f);
		};
		this.event.subscribe(RunService.PostSimulation, upd);

		handle.MouseButton1Down.Connect((face) => {
			if (!handle.Adornee) return;

			f = face;
			cu = calculateCursorDeltaVecOnPlane(
				handle.Adornee.Position,
				handle.Adornee.CFrame.VectorToWorldSpace(Vector3.FromNormalId(face)),
			);
		});
		handle.MouseButton1Up.Connect(() => {
			cu = undefined;
			f = undefined;
			release();
		});
	}
}

// #region ShapePoint
// #endregion

@injectable
class ShapePoint extends Component {
	private readonly floatingText;
	private handlesEnabled = false;
	private dotHandle: Model;
	private handles: HandleDef;
	position: Vector3;

	private readonly plot: SharedPlot;

	constructor(
		initialPos: Vector3,
		grid: ReadonlyObservableValue<MoveGrid>,
		pointChange: () => void,
		@inject plot: SharedPlot,
	) {
		super();

		this.position = initialPos;
		this.plot = plot;

		const dotPart = makeTargetBall(this.position);
		this.dotHandle = dotPart;

		const handles = MoveHandlesHelper.Clone();
		handles.Parent = Interface.getPlayerGui();
		ComponentInstance.init(this, handles);
		this.handles = handles;

		this.floatingText = this.parent(FloatingText.create(dotPart));
		this.event.subscribeObservable(
			this.event.readonlyObservableFromInstanceParam(dotPart.PrimaryPart!, "Position"),
			() => this.updateFloatingText(),
		);

		let dragStartPos = this.position;
		const update = (delta: Vector3) => {
			delta = grid.get().constrain(new CFrame(dragStartPos), delta);

			this.position = dragStartPos.add(delta);
			this.dotHandle.PivotTo(new CFrame(this.position));
			pointChange();

			this.updateFloatingText();
		};
		update(Vector3.zero);

		let currentMovement: Vector3 | undefined;
		const updateFromCurrentMovement = () => {
			if (!currentMovement) return;
			update(currentMovement);
		};

		this.event.subscribeObservable(grid, updateFromCurrentMovement);

		let prevCameraState: Enum.CameraType | undefined;
		const grabCamera = () => {
			LocalPlayer.getPlayerModule().GetControls().Disable();

			const camera = Workspace.CurrentCamera;
			if (!camera) return;

			prevCameraState = camera.CameraType;
			camera.CameraType = Enum.CameraType.Scriptable;
		};
		const releaseCamera = () => {
			LocalPlayer.getPlayerModule().GetControls().Enable();
			if (!prevCameraState) return;

			const camera = Workspace.CurrentCamera;
			if (!camera) return;

			camera.CameraType = prevCameraState;
			prevCameraState = undefined;
		};
		this.onDisable(releaseCamera);

		forEachHandle(handles, (axis) => {
			axis.Visible = false;
			axis.Adornee = dotPart.PrimaryPart!;

			this.event.subscribeObservable(
				this.event.readonlyObservableFromInstanceParam(axis, "Visible"),
				(visible) => {
					if (!visible) releaseCamera();
				},
			);
			// disable camera on drag
			this.event.subscribeRegistration(() => {
				if (InputController.inputType.get() !== "Touch") {
					return;
				}

				return [axis.MouseButton1Down.Connect(grabCamera), axis.MouseButton1Up.Connect(releaseCamera)];
			});
			this.event.subInput((ih) => {
				ih.onInputEnded((b) => {
					if (b.UserInputType !== Enum.UserInputType.Touch) return;
					releaseCamera();
				});
			});

			// movement controller
			this.parent(
				new HandleMovementController(
					axis,
					(delta, face) => {
						if (!currentMovement) dragStartPos = this.position;

						currentMovement = delta;
						updateFromCurrentMovement();
					},
					() => {
						currentMovement = undefined;

						this.position = BB.fromModel(this.dotHandle).center.Position;
						dragStartPos = this.position;
						pointChange();
					},
				),
			);
		});

		// Handle cleanup
		this.onDestroy(() => {
			dotPart.Destroy();
		});
	}

	private updateFloatingText() {
		const plot = this.plot;

		const pp = this.dotHandle.PrimaryPart!; // its not that funny... heh
		this.floatingText.instance.text.Visible = false;
		this.floatingText.subtext?.set(
			formatVecForFloatingText(pp.Position.sub(plot.instance.BuildingArea.GetPivot().Position), false),
		);
		const inst = this.floatingText.instance;
		inst.text.Visible = this.handlesEnabled;
		if (inst.subtext) inst.subtext.Visible = this.handlesEnabled;
	}
	setHandlesEnabled(enabled: boolean) {
		// Skip if already right state
		if (this.handlesEnabled === enabled) return;

		forEachHandle(this.handles, (axis) => {
			axis.Visible = enabled;
		});
		this.handlesEnabled = enabled;
		this.updateFloatingText();
	}
	updateDotSize(otherPositions: Vector3[]) {
		if (!this.dotHandle) return;

		updateBallSize(this.position, this.dotHandle, otherPositions);
	}
}

type ShapeAlignment = "top" | "center" | "bottom";

const alignOffset = (alignment: ShapeAlignment) => {
	if (alignment === "top") return -1;
	if (alignment === "bottom") return 1;
	return 0;
};

interface WedgeDetails {
	cframe: CFrame;
	size: Vector3;
}

interface TriangleDetails {
	wedges: [WedgeDetails, WedgeDetails] | [WedgeDetails];
	normal: CFrame;
}

const epsilon = 1e-8;
const epsilonSq = epsilon * epsilon;

const getTriangleWedges = (
	v1: Vector3,
	v2: Vector3,
	v3: Vector3,
	thickness: number,
	alignment: ShapeAlignment,
	manualWinding: boolean,
	cameraPos: Vector3,
	flippedNormal: boolean,
): TriangleDetails[] => {
	if (v1.FuzzyEq(v2, epsilon) || v2.FuzzyEq(v3, epsilon) || v3.FuzzyEq(v1, epsilon)) return [];

	const originalNormal = v2.sub(v1).Cross(v3.sub(v1));
	if (originalNormal.Dot(originalNormal) <= epsilonSq) return [];

	const centroid = v1.add(v2).add(v3).div(3);
	const offset = (thickness / 2) * alignOffset(alignment);

	const permutations = [
		[v1, v2, v3],
		[v2, v3, v1],
		[v3, v1, v2],
	];

	const results: TriangleDetails[] = [];

	for (const [p1, p2, p3] of permutations) {
		const [ab, ac, bc] = [p2.sub(p1), p3.sub(p1), p3.sub(p2)];
		const [abd, acd, bcd] = [ab.Dot(ab), ac.Dot(ac), bc.Dot(bc)];

		if (abd <= epsilonSq || acd <= epsilonSq || bcd <= epsilonSq) continue;

		if (ab.Dot(bc) > epsilon || ac.Dot(bc) < -epsilon) continue;

		const normal = ab.Cross(ac);
		if (normal.Dot(normal) <= epsilonSq) continue;

		const right = ac.Cross(ab).Unit;
		if (right.Magnitude < epsilon) continue;

		const up = bc.Cross(right).Unit;
		if (up.Magnitude < epsilon) continue;

		const back = bc.Unit;
		const height = math.abs(ab.Dot(up));
		if (height < epsilon) continue;

		const winding = originalNormal.Dot(normal) < 0 ? -1 : 1;
		let faceNormal = normal.Unit;

		if (manualWinding) {
			faceNormal = faceNormal.mul(winding);
		} else {
			const toCamera = cameraPos.sub(centroid);
			if (toCamera.Dot(faceNormal) < 0) faceNormal = faceNormal.mul(-1);
		}

		if (flippedNormal) faceNormal = faceNormal.mul(-1);

		// right triangle optimization
		if (math.abs(ab.Unit.Dot(ac.Unit)) < 1e-4) {
			const useAbForUp = faceNormal.Dot(normal) < 0;
			const wedgeUp = useAbForUp ? ab.Unit : ac.Unit;

			results.push({
				wedges: [
					{
						size: new Vector3(
							thickness,
							useAbForUp ? ab.Magnitude : ac.Magnitude,
							useAbForUp ? ac.Magnitude : ab.Magnitude,
						),
						cframe: CFrame.fromMatrix(
							p2.add(p3).div(2),
							faceNormal,
							wedgeUp,
							faceNormal.Cross(wedgeUp),
						).add(faceNormal.mul(offset)),
					} as WedgeDetails,
				],
				normal: CFrame.lookAt(centroid, centroid.add(faceNormal), wedgeUp),
			});
		}

		results.push({
			wedges: [
				{
					size: new Vector3(thickness, height, math.abs(ab.Dot(back))),
					cframe: CFrame.fromMatrix(p1.add(p2).div(2), right, up, back).add(faceNormal.mul(offset)),
				} as WedgeDetails,
				{
					size: new Vector3(thickness, height, math.abs(ac.Dot(back))),
					cframe: CFrame.fromMatrix(p1.add(p3).div(2), right.mul(-1), up, back.mul(-1)).add(
						faceNormal.mul(offset),
					),
				} as WedgeDetails,
			],
			normal: CFrame.lookAt(centroid, centroid.add(faceNormal), up),
		});
	}

	return results;
};

type ShapePieceKind = "wedge" | "block";
const piecePreviewClasses = { wedge: "WedgePart", block: "Part" } as const;

type PieceFit = "wedge" | "line";

interface CuratedBlock {
	readonly id: BlockId;
	readonly fits: PieceFit;
	readonly displayName?: string;
	// placed instead of the wedges for the rectangular parts of a polygon
	readonly rectangle?: BlockId;
	// turns the shape part so its long axis runs along the line; pieces lie along Z
	readonly lineTurn?: CFrame;
	// stretched along the line at its own thickness; the line's length also goes in its settings
	readonly configured?: (length: number, thickness: number, color: Color3) => PlacedBlockConfig;
	// copies laid end to end at their own thickness, stretched just enough to end on the points
	readonly tiled?: boolean;
}

// rope and cylinder run along their Y axis
const yAlongLine = CFrame.Angles(math.pi / 2, 0, 0);

// clamped to RopeBlocks' input ranges, which only the settings menu enforces
const ropeConfig = (length: number, thickness: number, color: Color3): PlacedBlockConfig =>
	({
		length: { type: "number", config: math.clamp(length, 0, 50) },
		thickness: { type: "number", config: math.clamp(thickness, 0.01, 10) },
		color: { type: "color", config: color },
	}) as PlacedBlockConfig;

const curatedBlocks: readonly CuratedBlock[] = [
	{ id: "wedge1x1", fits: "wedge", rectangle: "block" },
	{ id: "wedgewing1x1", fits: "wedge", displayName: "Wing", rectangle: "wing1x1" },
	{ id: "block", fits: "line" },
	{ id: "cylinder1x1", fits: "line", lineTurn: yAlongLine },
	{ id: "rope", fits: "line", lineTurn: yAlongLine, configured: ropeConfig },
	{ id: "baselessrope", fits: "line", lineTurn: yAlongLine, configured: ropeConfig },
	// raycast through the meshes: the tube and truss 2 are open along Y; trusses 1 and 3 are alike on every axis
	{ id: "hollowcylinder", fits: "line", lineTurn: yAlongLine },
	{ id: "scalabletruss1", fits: "line", lineTurn: yAlongLine },
	{ id: "scalabletruss2", fits: "line", lineTurn: yAlongLine },
	{ id: "scalabletruss3", fits: "line", lineTurn: yAlongLine },
	{ id: "chain", fits: "line", lineTurn: yAlongLine, tiled: true },
];
const defaultCuratedBlocks: { readonly [k in PieceFit]: CuratedBlock } = {
	wedge: curatedBlocks[0],
	line: curatedBlocks[2],
};

const shapePartOf = (model: BlockModel): BasePart =>
	(model.GetChildren().find((c) => c.IsA("BasePart") && c.Name.lower() !== "colbox" && c.Transparency < 1) as
		BasePart | undefined) ?? model.PrimaryPart!;

interface ShapePiece {
	readonly kind: ShapePieceKind;
	readonly cframe: CFrame;
	readonly size: Vector3;
}

interface ShapeResult {
	readonly pieces: readonly ShapePiece[];
	readonly normal: CFrame;
	readonly normalScale: number;
	readonly warning?: string;
}

interface ShapeDefinition {
	readonly displayName: string;
	readonly fits: PieceFit;
	readonly minPoints: number;
	// undefined for shapes finished by hand
	readonly maxPoints?: number;
	readonly build: (tool: PolygonTool, points: readonly Vector3[]) => ShapeResult | undefined;
}

const wedgePieces = (wedges: readonly WedgeDetails[]): ShapePiece[] =>
	wedges.map((w) => ({ kind: "wedge", cframe: w.cframe, size: w.size }));

const triangleShape: ShapeDefinition = {
	displayName: "Triangle",
	fits: "wedge",
	minPoints: 3,
	maxPoints: 3,
	build: (tool, [p1, p2, p3]) => {
		const data = tool.getBestTriangleWedges(p1, p2, p3);
		if (!data) return;

		return {
			pieces: wedgePieces(data.wedges),
			normal: data.normal,
			normalScale: p1.sub(p3).Cross(p2.sub(p3)).Magnitude / 8,
		};
	},
};

const lineShape: ShapeDefinition = {
	displayName: "Line",
	fits: "line",
	minPoints: 2,
	maxPoints: 2,
	build: (tool, [p1, p2]) => tool.getLine(p1, p2),
};

const polygonShape: ShapeDefinition = {
	displayName: "Polygon",
	fits: "wedge",
	minPoints: 3,
	build: (tool, points) => tool.getPolygon(points),
};

const shapes: readonly ShapeDefinition[] = [triangleShape, lineShape, polygonShape];

const shapeForPointCount = (count: number): ShapeDefinition | undefined => {
	if (count === 2) return lineShape;
	if (count === 3) return triangleShape;
	if (count > 3) return polygonShape;
};

const flattenWarnDistance = 0.01;
// |cos| of a corner angle below this counts as a right angle (about 0.006°)
const rightAngleTolerance = 1e-4;
const isRightCorner = (points: readonly Vector3[], i: number): boolean => {
	const count = points.size();
	const p = points[i];
	const prev = points[(i + count - 1) % count];
	const nextPoint = points[(i + 1) % count];
	return math.abs(p.sub(prev).Unit.Dot(nextPoint.sub(p).Unit)) < rightAngleTolerance;
};

const rotateKey = Keybinds.registerDefinition("polygon_rotate", ["Polygon Tool", "Rotate"], [["R"], ["DPadUp"]]);

// #region Tool
// #endregion

/** A tool for creating triangles, lines and polygons */
@injectable
export class PolygonTool extends ToolBase {
	readonly selectedMaterial = new ObservableValue<Enum.Material>(Enum.Material.Plastic);
	readonly selectedColor = new ObservableValue<Color4>({ color: Colors.white, alpha: 1 });

	readonly alignment = new ObservableValue<ShapeAlignment>("center");
	readonly flippedNormal = new ObservableValue<boolean>(false);
	readonly manualWinding = new ObservableValue<boolean>(false); // if the normal is based on the shape's winding, or always faces the user
	readonly precisionMode = new ObservableValue<boolean>(false); // lets the user move the points

	private readonly moveGrid = new ObservableValue(MoveGrid.def);
	private readonly shapeThickness = new ObservableValue<number>(0.5);

	readonly shape = new ObservableValue<ShapeDefinition>(triangleShape);
	readonly selectedBlock = new ObservableValue<CuratedBlock>(defaultCuratedBlocks.wedge);
	private orientation = 0; // index into the shape's possible orientations, best first; reset by each new shape
	readonly rotateAction;
	readonly placedPoints = new ObservableValue<ShapePoint[]>([]);
	private targetPoint: Model | undefined = undefined;
	targetPointPosition: Vector3 | undefined = undefined;

	private currentViewMode = 0;
	private shapeView: Model | undefined = undefined; // preview of the shape being placed
	private readonly normalIndicator: Part;

	readonly pointsChange = new Signal();

	readonly controller;
	private readonly plot;
	private readonly building;
	readonly currentMode = this.parent(new ComponentChild(true));

	constructor(
		@inject readonly mode: BuildingMode,
		@inject private readonly blockList: BlockList,
		@inject private readonly actionController: ActionController,
		@inject readonly mainScreen: MainScreenLayout,
		@inject readonly di: DIContainer,
		@inject keybinds: Keybinds,
		@inject theme: Theme,
	) {
		super(mode);

		this.rotateAction = this.parent(
			new Action(() => {
				this.orientation++;
				this.updateView();
			}),
		);
		this.rotateAction.initKeybind(keybinds.fromDefinition(rotateKey));

		// fixme: should be a Studio asset (normal part and its Highlight)
		const normalPart = Element.create("Part", {
			Size: new Vector3(0.1, 0.1, 3),
			Color: Colors.black,
			Material: Enum.Material.SmoothPlastic,
			CanCollide: false,
			CanQuery: false,
			CanTouch: false,
			Transparency: 0,
			Anchored: true,
		});
		Element.create("Highlight", {
			FillColor: Color3.fromRGB(166, 48, 48),
			FillTransparency: 0,
			OutlineTransparency: 1,
			DepthMode: Enum.HighlightDepthMode.Occluded,
			Adornee: normalPart,
			Parent: normalPart,
		});
		this.normalIndicator = normalPart;

		this.building = di.resolve<ClientBuilding>();
		this.plot = this.targetPlot;

		this.parent(di.resolveForeignClass(Scene.PolygonToolScene));
		this.controller = this.parent(new Component());
		this.controller.onEnable(() => this.currentMode.set(PlaceController.create(this, di)));
		this.controller.onDisable(() => this.currentMode.set(undefined));
		this.controller.onEnabledStateChange((enabled) => {
			const gridUI = Instances.waitForChild<Frame>(
				Interface.getPlayerGui(),
				"Grid Floating",
				"Grid",
				"Content",
				"ShapeThickness",
			);
			gridUI.Visible = enabled;
		});

		this.event.subscribeObservable(this.mode.moveGrid, (grid) => this.moveGrid.set(MoveGrid.normal(grid)), true);
		this.event.subscribeObservable(this.mode.shapeThickness, (thickness) => {
			this.shapeThickness.set(thickness);
			this.updateView();
		});
		// re-bind on CurrentCamera change, since a freecam switch reassigns it
		let cameraCFrameSub: SignalConnection | undefined;
		this.onDisable(() => cameraCFrameSub?.Disconnect());
		this.event.subscribeObservable(
			this.event.readonlyObservableFromInstanceParam(Workspace, "CurrentCamera"),
			(camera) => {
				cameraCFrameSub?.Disconnect();
				cameraCFrameSub = camera?.GetPropertyChangedSignal("CFrame").Connect(() => this.updateView());
			},
			true,
		);

		this.currentMode.childSet.Connect((mode) => {
			if (!this.isEnabled() || !this.controller.isEnabled()) return;
			if (mode) return;

			this.currentMode.set(PlaceController.create(this, di));
		});

		const actions = {
			setAlignmentTop: this.parent(new Action(() => this.setAlignment("top"))),
			setAlignmentCenter: this.parent(new Action(() => this.setAlignment("center"))),
			setAlignmentBottom: this.parent(new Action(() => this.setAlignment("bottom"))),
		};

		const noController = new ObservableValue(true);
		this.onEnabledStateChange((enabled) => {
			noController.set(enabled);
			if (enabled) {
				this.moveGrid.set(MoveGrid.normal(this.mode.moveGrid.get()));
				this.shapeThickness.set(this.mode.shapeThickness.get());
			} else {
				this.hideEverything();
			}
		});

		actions.setAlignmentTop.subCanExecuteFrom({ noController });
		actions.setAlignmentCenter.subCanExecuteFrom({ noController });
		actions.setAlignmentBottom.subCanExecuteFrom({ noController });

		{
			const layer = this.parentGui(mainScreen.bottom.push());

			layer
				.addButton("Cancel", undefined, "buttonNegative") //
				.addButtonAction(() => this.hideEverything());
			layer
				.addButton("Undo Point", undefined) //
				.addButtonAction(() => this.undoLastPoint());
			const confirmButton = layer
				.addButton("Confirm", undefined, "buttonPositive") //
				.addButtonAction(() => this.placeTheShape());

			const check = () => {
				const controller = noController.get();
				const pointCount = this.placedPoints.get().size();
				confirmButton.setVisibleAndEnabled(pointCount >= this.shape.get().minPoints);
				layer.setVisibleAndEnabled(controller && pointCount !== 0);
			};
			noController.subscribe((nc) => check());
			this.pointsChange.Connect(check);
			this.precisionMode.changed.Connect(check);
		}

		{
			const layer = this.parentGui(mainScreen.bottom.push());
			noController.subscribe((nc) => layer.setVisibleAndEnabled(nc));

			const buttons = {
				top: layer
					.addButton("Align Top")
					.initializeSimpleTransform("BackgroundColor3")
					.subscribeToAction(actions.setAlignmentTop),
				center: layer
					.addButton("Align Center")
					.initializeSimpleTransform("BackgroundColor3")
					.subscribeToAction(actions.setAlignmentCenter),
				bottom: layer
					.addButton("Align Bottom")
					.initializeSimpleTransform("BackgroundColor3")
					.subscribeToAction(actions.setAlignmentBottom),
			};
			this.event.subscribeObservable(
				this.alignment,
				(alignment) => {
					for (const [key, button] of pairs(buttons)) {
						button.overlayValue(
							"BackgroundColor3",
							theme.get(alignment === key ? "buttonActive" : "buttonNormal"),
						);
					}
				},
				true,
			);
		}

		{
			const layer = this.parentGui(mainScreen.bottom.push());
			noController.subscribe((nc) => layer.setVisibleAndEnabled(nc));

			const buttons = shapes.map((shape) => {
				const selectShape = this.parent(new Action(() => this.shape.set(shape)));
				selectShape.subCanExecuteFrom({ noController });

				return layer
					.addButton(shape.displayName)
					.initializeSimpleTransform("BackgroundColor3")
					.subscribeToAction(selectShape);
			});
			this.event.subscribeObservable(
				this.shape,
				(current) => {
					for (let i = 0; i < shapes.size(); i++) {
						buttons[i].overlayValue(
							"BackgroundColor3",
							theme.get(shapes[i] === current ? "buttonActive" : "buttonNormal"),
						);
					}
				},
				true,
			);

			// unfinished points belong to the previous shape
			this.shape.subscribe(() => this.hideEverything());

			// the shape and the block have to agree: changing one moves the other to something that fits
			this.shape.subscribe((shape) => {
				if (this.selectedBlock.get().fits === shape.fits) return;
				this.selectedBlock.set(defaultCuratedBlocks[shape.fits]);
			});
			this.selectedBlock.subscribe((block) => {
				if (this.shape.get().fits === block.fits) return;
				this.shape.set(block.fits === "line" ? lineShape : triangleShape);
			});
		}

		{
			const layer = this.parentGui(mainScreen.bottom.push());
			noController.subscribe((nc) => layer.setVisibleAndEnabled(nc));

			const materialColorEditor = layer.parent(MaterialColorEditControl.autoCreate(true));
			materialColorEditor.autoSubscribe(this.selectedMaterial, this.selectedColor);

			this.selectedMaterial.subscribe((mat) => this.updateView());
			this.selectedColor.subscribe((color) => this.updateView());
		}
	}

	private setAlignment(alignment: ShapeAlignment) {
		this.alignment.set(alignment);
		this.updateView();
	}
	private isNearPoint(pos: Vector3, point: Vector3): boolean {
		const camera = Workspace.CurrentCamera;
		if (!camera) return pos.FuzzyEq(point, epsilon);

		const depth = point.sub(camera.CFrame.Position).Dot(camera.CFrame.LookVector);
		return pos.sub(point).Magnitude < depth * cornerSnapDepthRatio;
	}
	private isComplete(pointCount: number): boolean {
		const max = this.shape.get().maxPoints;
		return max !== undefined && pointCount >= max;
	}
	private updatePlaceColor(shapePoints: readonly Vector3[], shape: ShapeDefinition) {
		const plot = this.plot.get();

		if (shapePoints.size() < shape.minPoints) {
			// not a shape yet - only the points themselves
			const canBePlaced = shapePoints.all((p) => plot.bounds.isPointInside(p));
			BlockGhoster.setColor(canBePlaced ? allowedColor : forbiddenColor);
			return;
		}

		if (!this.shapeView) return;
		const areAllBlocksInsidePlot = plot.bounds.isBBInside(BB.fromModel(this.shapeView));
		const canBePlaced =
			areAllBlocksInsidePlot &&
			BuildingManager.blockCanBePlacedAt(plot, { model: this.shapeView }, this.shapeView.GetPivot(), Vector3.one);

		BlockGhoster.setColor(canBePlaced ? allowedColor : forbiddenColor);
	}
	getBestTriangleWedges(v1: Vector3, v2: Vector3, v3: Vector3): TriangleDetails | undefined {
		const plot = this.plot.get();

		if (!v1 || !v2 || !v3) {
			$warn("Attempt to get invalid triangle");
			return;
		}

		const inBounds = (data: TriangleDetails) => {
			const bb = BB.fromBBs(data.wedges.map((w) => new BB(w.cframe, w.size)));
			return plot.bounds.isBBInside(bb);
		};
		const getScore = (sizes: Vector3[]) => {
			const count = sizes.size();
			if (count <= 1) return 0; // 1 wedge is the best in every case
			const mean = sizes.reduce((a, c) => a.add(c), Vector3.zero).div(count);
			const total = sizes.reduce((a, c) => {
				const max = c.findMax();
				const penalty = max > 0 ? math.pow(1 - c.findMin() / max, 2) * 5 : 0;
				return a + c.sub(mean).Magnitude + penalty;
			}, 0);
			return total / count;
		};

		// get possible triangles and pick the best one
		const possible = getTriangleWedges(
			v1,
			v2,
			v3,
			this.shapeThickness.get(),
			this.alignment.get(),
			this.manualWinding.get(),
			Workspace.CurrentCamera!.CFrame.Position,
			this.flippedNormal.get(),
		);
		let chosen: TriangleDetails | undefined;
		let best: { score: number; data: TriangleDetails | undefined } = { score: math.huge, data: undefined };
		for (const option of possible) {
			if (inBounds(option)) {
				const score = getScore(option.wedges.map((w) => w.size));

				if (score === 0) {
					chosen = option; // 0 is already the best
					break;
				}
				if (score < best.score) best = { score, data: option };
			}
		}
		chosen ??= best.data ?? possible[0];

		// cycling starts from the best option and then runs through the rest in order
		if (this.orientation === 0 || !chosen) return chosen;
		const ordered = [chosen, ...possible.filter((option) => option !== chosen)];
		return ordered[this.orientation % ordered.size()];
	}
	getLine(p1: Vector3, p2: Vector3): ShapeResult | undefined {
		const along = p2.sub(p1);
		const length = along.Magnitude;
		if (length < epsilon) return;

		const dir = along.div(length);
		const center = p1.add(p2).div(2);

		let facing = Vector3.yAxis.sub(dir.mul(dir.Y));
		if (facing.Magnitude < epsilon) {
			const toCamera = Workspace.CurrentCamera!.CFrame.Position.sub(center);
			facing = toCamera.sub(dir.mul(toCamera.Dot(dir)));
			if (facing.Magnitude < epsilon) facing = Vector3.xAxis.sub(dir.mul(dir.X));
		}
		facing = facing.Unit;
		if (this.flippedNormal.get()) facing = facing.mul(-1);

		const thickness = this.shapeThickness.get();
		const offset = (thickness / 2) * alignOffset(this.alignment.get());
		const cframe = CFrame.fromMatrix(center.add(facing.mul(offset)), facing.Cross(dir), facing, dir).mul(
			CFrame.Angles(0, 0, (math.pi / 2) * (this.orientation % 2)),
		);

		return {
			pieces: [{ kind: "block", cframe, size: new Vector3(thickness, thickness, length) }],
			normal: CFrame.lookAt(center, center.add(facing), dir),
			normalScale: length / 8,
		};
	}
	private getRightQuad(
		flat: readonly Vector3[],
		centroid: Vector3,
		normalScale: number,
		warning: string | undefined,
	): ShapeResult | undefined {
		for (let i = 0; i < 4; i++) {
			if (!isRightCorner(flat, i) || !isRightCorner(flat, (i + 1) % 4)) continue;

			const [a, b, c, d] = [flat[i], flat[(i + 1) % 4], flat[(i + 2) % 4], flat[(i + 3) % 4]];
			const sideA = d.sub(a).Magnitude;
			const sideB = c.sub(b).Magnitude;
			const across = d.sub(a).Unit;
			const height = math.min(sideA, sideB);

			// listed in the outline's own order, so a manual winding faces the same way as the whole shape
			let leftover: [Vector3, Vector3, Vector3] | undefined;
			if (sideA - sideB > epsilon) leftover = [a.add(across.mul(height)), c, d];
			else if (sideB - sideA > epsilon) leftover = [d, b.add(across.mul(height)), c];

			// the facing, flip and alignment follow the triangle rules; a rectangle borrows its first three corners
			const data = leftover
				? this.getBestTriangleWedges(leftover[0], leftover[1], leftover[2])
				: this.getBestTriangleWedges(a, b, c);
			if (!data) return;

			const facing = data.normal.LookVector;
			const right = b.sub(a).Unit;
			const thickness = this.shapeThickness.get();
			const offset = (thickness / 2) * alignOffset(this.alignment.get());
			const center = a
				.add(b)
				.div(2)
				.add(across.mul(height / 2))
				.add(facing.mul(offset));

			const pieces: ShapePiece[] = [
				{
					kind: "block",
					cframe: CFrame.fromMatrix(center, right, facing, right.Cross(facing)),
					size: new Vector3(b.sub(a).Magnitude, thickness, height),
				},
			];
			if (leftover) for (const piece of wedgePieces(data.wedges)) pieces.push(piece);

			return { pieces, normal: data.normal.Rotation.add(centroid), normalScale, warning };
		}
	}
	private getRightAnglePanels(
		flat: readonly Vector3[],
		centroid: Vector3,
		planeNormal: Vector3,
		normalScale: number,
		warning: string | undefined,
	): ShapeResult | undefined {
		if (!flat.all((_, i) => isRightCorner(flat, i))) return;

		// laid out along the outline's own edges, so every edge runs along an axis; u × v is the plane normal, which
		// keeps the outline's winding and so the ear clipper's triangles wound the way the outline was drawn
		const u = flat[1].sub(flat[0]).Unit;
		const v = planeNormal.Cross(u);
		const coords = flat.map((p) => {
			const fromCentroid = p.sub(centroid);
			return new Vector2(fromCentroid.Dot(u), fromCentroid.Dot(v));
		});

		const rectangles = PolygonGeometry.rectangles(coords);
		const triangles = PolygonGeometry.earClip(coords);
		if (!rectangles || !triangles) return;

		// the facing, flip and alignment follow the triangle rules, taken from one triangle of the outline
		const [i0, i1, i2] = triangles[0];
		const data = this.getBestTriangleWedges(flat[i0], flat[i1], flat[i2]);
		if (!data) return;

		const facing = data.normal.LookVector;
		const thickness = this.shapeThickness.get();
		const offset = (thickness / 2) * alignOffset(this.alignment.get());
		const pieces = rectangles.map((rectangle): ShapePiece => {
			const middle = rectangle.min.add(rectangle.max).div(2);
			const size = rectangle.max.sub(rectangle.min);
			const center = centroid.add(u.mul(middle.X)).add(v.mul(middle.Y)).add(facing.mul(offset));

			return {
				kind: "block",
				cframe: CFrame.fromMatrix(center, u, facing, u.Cross(facing)),
				size: new Vector3(size.X, thickness, size.Y),
			};
		});

		return { pieces, normal: data.normal.Rotation.add(centroid), normalScale, warning };
	}
	getPolygon(points: readonly Vector3[]): ShapeResult | undefined {
		// corners in a straight line with their neighbours can never be cut off as an ear
		const corners = points.filter((p, i) => {
			const prev = points[(i + points.size() - 1) % points.size()];
			const nextPoint = points[(i + 1) % points.size()];
			return p.sub(prev).Cross(nextPoint.sub(p)).Magnitude > epsilon;
		});
		if (corners.size() < 3) return;

		// Newell's method: a normal that stays stable for non-planar and concave outlines
		let newell = Vector3.zero;
		let centroid = Vector3.zero;
		for (let i = 0; i < corners.size(); i++) {
			const a = corners[i];
			const b = corners[(i + 1) % corners.size()];
			newell = newell.add(
				new Vector3((a.Y - b.Y) * (a.Z + b.Z), (a.Z - b.Z) * (a.X + b.X), (a.X - b.X) * (a.Y + b.Y)),
			);
			centroid = centroid.add(a);
		}
		centroid = centroid.div(corners.size());
		if (newell.Magnitude < epsilon) return;

		const planeNormal = newell.Unit;
		let maxOffset = 0;
		const flat = corners.map((p) => {
			const distance = p.sub(centroid).Dot(planeNormal);
			maxOffset = math.max(maxOffset, math.abs(distance));
			return p.sub(planeNormal.mul(distance));
		});
		const warning =
			maxOffset > flattenWarnDistance
				? `Points were flattened by up to ${Strings.prettyNumber(maxOffset, 0.01)} studs`
				: undefined;

		if (flat.size() === 4) {
			const quad = this.getRightQuad(flat, centroid, newell.Magnitude / 8, warning);
			if (quad) return quad;
		} else {
			const panels = this.getRightAnglePanels(flat, centroid, planeNormal, newell.Magnitude / 8, warning);
			if (panels) return panels;
		}

		const reference = math.abs(planeNormal.Y) < 0.99 ? Vector3.yAxis : Vector3.xAxis;
		const u = reference.Cross(planeNormal).Unit;
		const v = planeNormal.Cross(u);
		const coords = flat.map((p) => {
			const fromCentroid = p.sub(centroid);
			return new Vector2(fromCentroid.Dot(u), fromCentroid.Dot(v));
		});

		const triangles = PolygonGeometry.earClip(coords);
		if (!triangles) return;

		const pieces: ShapePiece[] = [];
		let normal: CFrame | undefined;
		for (const [i0, i1, i2] of triangles) {
			const data = this.getBestTriangleWedges(flat[i0], flat[i1], flat[i2]);
			if (!data) return;

			normal ??= data.normal.Rotation.add(centroid);
			for (const piece of wedgePieces(data.wedges)) pieces.push(piece);
		}
		if (!normal) return;

		return { pieces, normal, normalScale: newell.Magnitude / 8, warning };
	}
	updateView() {
		if (!this.targetPointPosition) return;

		const points = this.placedPoints.get();
		const complete = this.isComplete(points.size());

		const positions = points.map((p) => p.position);
		for (const point of points) point.updateDotSize(positions);

		// over the first point a click finishes what is drawn, so that is what is shown
		const finishing =
			!complete && points.size() >= 2 && this.isNearPoint(this.targetPointPosition, points[0].position);
		const shape = (finishing && shapeForPointCount(points.size())) || this.shape.get();
		const shapePoints = complete || finishing ? positions : [...positions, this.targetPointPosition];

		if (shapePoints.size() < shape.minPoints) {
			if (points.size() === 1) this.updateLinePreview(points[0].position, this.targetPointPosition);
		} else {
			const result = shape.build(this, shapePoints);
			const pieces = result?.pieces;
			const normal = result?.normal;

			if (result && normal) {
				const dir = normal.LookVector;
				this.normalIndicator.Size = new Vector3(0.1, 0.1, 3).mul(math.clamp(result.normalScale, 0.3, 1.5));
				this.normalIndicator.CFrame = normal.add(dir.mul(this.normalIndicator.Size.Z / 2));
				this.normalIndicator.Parent = Workspace; // NOTE: moving to the `Ghosts` folder (`BlockGhoster.parent`) will push out to `Workspace` anyway
			} else {
				if (this.normalIndicator.Parent) this.normalIndicator.Parent = undefined;
			}

			if (!pieces) {
				// no pieces -> no shape
				if (this.shapeView) {
					this.shapeView.Destroy();
					this.shapeView = undefined;
				}
				this.updatePlaceColor(shapePoints, shape);
				return;
			}

			let model = this.shapeView;
			let partsChanged = false;
			// ensure model exists (and in correct state)
			if (!model || this.currentViewMode !== 3) {
				if (model) model.Destroy();

				model = new Instance("Model");
				model.Name = "shapeghost";
				this.shapeView = model;
				this.currentViewMode = 3;
				partsChanged = true;
			}
			const parts: BasePart[] = model.GetChildren() as BasePart[];

			// update/create parts
			for (let i = 0; i < pieces.size(); i++) {
				const piece = pieces[i];
				const className = piecePreviewClasses[piece.kind];

				let part: BasePart | undefined = parts[i];
				if (part && part.ClassName !== className) {
					part.Destroy();
					part = undefined;
				}
				if (!part) {
					partsChanged = true;
					// fixme: should be a Studio asset (preview piece and its SelectionBox)
					part = new Instance(className);
					part.Material = Enum.Material.SmoothPlastic;
					part.Anchored = true;
					part.Parent = model;
					parts[i] = part;

					const box = new Instance("SelectionBox");
					box.LineThickness = 0.01;
					box.Adornee = part;
					box.Parent = part;
				}

				part.Size = piece.size;
				part.CFrame = piece.cframe;
			}
			// remove parts left over from a shape with more pieces
			for (let i = pieces.size(); i < parts.size(); i++) {
				parts[i].Destroy();
				partsChanged = true;
			}
			if (partsChanged) BlockGhoster.ghostModel(model);

			if (complete) {
				if (this.precisionMode.get()) {
					// enable handles
					for (const point of points) {
						point.setHandlesEnabled(true);
					}
				} else {
					// disable handles
					for (const point of points) {
						point.setHandlesEnabled(false);
					}

					// placeTheShape tears everything down, so the rest of this pass would run on stale state
					this.placeTheShape();
					return;
				}
			}
		}

		if (!complete) {
			for (const point of points) {
				point.setHandlesEnabled(false);
			}
		}

		this.updatePlaceColor(shapePoints, shape);
	}
	private updateLinePreview(p1: Vector3, p2: Vector3) {
		const center = p1.add(p2).div(2);
		const dist = p1.sub(p2).Magnitude;

		let model = this.shapeView;

		// destroy model if not correct type
		if (this.currentViewMode !== 2) {
			model?.Destroy();
			model = undefined;
		}

		if (this.normalIndicator.Parent) this.normalIndicator.Parent = undefined;

		let line = model?.GetChildren()[0] as Part | undefined;
		if (!line) {
			// fixme: should be a Studio asset
			line = new Instance("Part");
			line.Anchored = true;
			line.Material = Enum.Material.SmoothPlastic;
			line.Color = Color3.fromRGB(248, 248, 248);
		}
		const thickness = this.shapeThickness.get();
		const offset = (thickness / 2) * alignOffset(this.alignment.get()) * (this.flippedNormal.get() ? -1 : 1);
		const lineThickness = math.max(0.01, math.min(0.5, dist / 2));
		line.Size = new Vector3(thickness, lineThickness, dist);
		line.CFrame = CFrame.lookAt(center, p2)
			.mul(CFrame.Angles(0, 0, math.pi / 2))
			.add(Vector3.yAxis.mul(offset));

		if (!model) {
			model = partsToModel([line]);
			model.Name = "shapeghost";
			BlockGhoster.ghostModel(model);
			this.currentViewMode = 2;
			this.shapeView = model;
		}
	}
	updateTargetPoint() {
		// no target needed once the shape is complete
		const points = this.placedPoints.get();
		if (this.isComplete(points.size())) {
			this.targetPoint?.Destroy();
			this.targetPoint = undefined;
			return;
		}

		if (!this.targetPoint) {
			this.targetPoint = makeTargetBall(undefined, "shapetarget");
		}

		const controller = this.currentMode.get();
		let info = undefined;
		if (controller instanceof PlaceController.Touch) {
			info = controller.prevTarget;
			if (!info) return;
		}

		if (!this.targetPoint) {
			$warn("Target point does not exist!");
			return;
		}
		const pos = getMouseTargetBlockPositionV3(
			this.targetPoint as BlockModel,
			new CFrame(),
			Vector3.one.mul(0.25),
			this.mode.gridEnabled.get(),
			this.mode.moveGrid.get(),
			info,
		);
		if (pos) {
			this.targetPointPosition = pos;
			this.targetPoint.PivotTo(new CFrame(pos));

			const pointData = [
				...points.map((p) => p.position),
				...(this.targetPointPosition ? [this.targetPointPosition] : []),
			];
			updateBallSize(this.targetPointPosition, this.targetPoint, pointData);
			this.updateView();
		}
		this.pointsChange.Fire();
	}
	addPoint(pos: Vector3 | undefined) {
		if (!pos) return;

		const existing = this.placedPoints.get();
		if (this.isComplete(existing.size())) return;
		if (existing.isEmpty()) this.orientation = 0;

		const finishing = existing.size() >= 2 && this.isNearPoint(pos, existing[0].position);
		const drawnShape = finishing ? shapeForPointCount(existing.size()) : undefined;
		if (drawnShape) {
			this.placeTheShape(drawnShape);
			return;
		}

		// check point in same position as an existing point
		for (const point of existing) {
			if (pos.FuzzyEq(point.position, 1e-8)) {
				LogControl.instance.addLine("Point already exists here", Colors.red);
				SoundController.getUISounds().Build.BlockPlaceError.Play();
				return;
			}
		}

		const plot = this.plot.get();
		if (!plot.bounds.isPointInside(pos)) {
			LogControl.instance.addLine("Can't be placed here", Colors.red);
			SoundController.getUISounds().Build.BlockPlaceError.Play();
			this.hideEverything();
			return;
		}

		const points = this.placedPoints.get();
		const point = this.di.resolveForeignClass(ShapePoint, [pos, this.moveGrid, () => this.updateView()]);
		point.enable();
		points.push(point);
		if (!this.isComplete(points.size())) {
			SoundController.getUISounds().Build.BlockPlace.PlaybackSpeed = SoundController.randomSoundSpeed();
			SoundController.getUISounds().Build.BlockPlace.Play();
		}

		const pointData = [
			...points.map((p) => p.position),
			...(this.targetPointPosition ? [this.targetPointPosition] : []),
		];
		if (this.targetPointPosition && this.targetPoint)
			updateBallSize(this.targetPointPosition, this.targetPoint, pointData);
		this.pointsChange.Fire();
		this.updateView();
	}
	private toPlaceRequests(piece: ShapePiece, block: CuratedBlock): PlaceBlockRequest[] {
		const model = this.blockList.blocks[block.id]!.model;
		const turn = block.lineTurn ?? CFrame.identity;
		const color = this.selectedColor.get();
		const material = this.selectedMaterial.get();

		if (block.configured) {
			const length = piece.size.Z;
			// stretched along its long axis (Y) to span the line, at its own thickness
			const scale = new Vector3(1, length / model.PrimaryPart!.Size.Y, 1);
			const location = piece.cframe.mul(turn);
			const config = block.configured(length, piece.size.X, color.color);

			return [{ id: block.id, color, material, scale, location, uuid: undefined, config }];
		}

		if (block.tiled) {
			const length = piece.size.Z;
			const blockLength = model.PrimaryPart!.Size.Y;
			const count = math.max(1, math.round(length / blockLength));
			const segment = length / count;
			const scale = new Vector3(1, segment / blockLength, 1);

			const requests: PlaceBlockRequest[] = [];
			for (let i = 0; i < count; i++) {
				const location = piece.cframe.mul(new CFrame(0, 0, -length / 2 + segment * (i + 0.5))).mul(turn);
				requests.push({ id: block.id, color, material, scale, location, uuid: undefined, config: undefined });
			}
			return requests;
		}

		const part = shapePartOf(model);
		const offset = model.GetPivot().ToObjectSpace(part.CFrame);
		const partSize = turn.Rotation.Inverse().mul(piece.size).Abs();

		return [
			{
				id: block.id,
				color,
				material,
				scale: offset.Rotation.mul(partSize.div(part.Size)).Abs(),
				location: piece.cframe.mul(turn).mul(offset.Inverse()),
				uuid: undefined,
				config: undefined,
			},
		];
	}
	private createShape(points: Vector3[], shape: ShapeDefinition) {
		if (points.size() < shape.minPoints) {
			$warn("Invalid point amount");
			return;
		}
		const hasDuplicate = points.any((p, i) => points.any((q, j) => j > i && p.FuzzyEq(q, epsilon)));
		if (hasDuplicate) {
			LogControl.instance.addLine(`${shape.displayName} contains duplicated points`);
			SoundController.getUISounds().Build.BlockPlaceError.Play();
			return;
		}
		const plot = this.plot.get();
		const result = shape.build(this, points);
		const pieces = result?.pieces;
		if (pieces) {
			const pointsInside = points.all((p) => plot.bounds.isPointInside(p));
			const piecesInside = plot.bounds.isBBInside(BB.fromBBs(pieces.map((w) => new BB(w.cframe, w.size))));
			if (pointsInside && !piecesInside) {
				// points are valid but the shape is not
				LogControl.instance.addLine(`${shape.displayName} cannot be formed here`, Colors.red);
				SoundController.getUISounds().Build.BlockPlaceError.Play();
				return;
			}

			this.actionController.startCombineStack(`Place ${shape.displayName}`);

			if (result?.warning) LogControl.instance.addLine(result.warning, Colors.yellow);

			// a shape finished by clicking the first point again may not be one the selected block can build
			const selected = this.selectedBlock.get();
			const block = selected.fits === shape.fits ? selected : defaultCuratedBlocks[shape.fits];

			const rectangleBlock: CuratedBlock | undefined =
				block.rectangle !== undefined ? { id: block.rectangle, fits: block.fits } : undefined;
			const blocks = pieces.flatmap((piece) =>
				this.toPlaceRequests(piece, piece.kind === "block" ? (rectangleBlock ?? block) : block),
			);
			const response = this.building.placeOperation.execute({ plot, blocks });
			processPlaceResponse(response);

			this.actionController.endCombineStack();
		} else {
			$warn(`${shape.displayName} invalid`);
		}

		this.hideEverything();
	}
	placeTheShape(shape = this.shape.get()) {
		const points = this.placedPoints.get();
		if (points.size() < shape.minPoints) {
			const message = `${shape.displayName} does not have ${shape.minPoints} points!`;
			LogControl.instance.addLine(message, Colors.red);
			$warn(message);
			return;
		}
		// store points and hide everything first to avoid issues
		const triPoints = points.map((p) => p.position);
		this.hideEverything();
		this.createShape(triPoints, shape);
	}
	undoLastPoint() {
		const points = this.placedPoints.get();
		points.pop()?.destroy();

		SoundController.getUISounds().Build.BlockDelete.PlaybackSpeed = SoundController.randomSoundSpeed();
		SoundController.getUISounds().Build.BlockDelete.Play();

		if (points.size() === 0) {
			// no more points
			this.hideEverything();
			return;
		}

		const pointData = [
			...points.map((p) => p.position),
			...(this.targetPointPosition ? [this.targetPointPosition] : []),
		];
		if (this.targetPointPosition && this.targetPoint)
			updateBallSize(this.targetPointPosition, this.targetPoint, pointData);
		this.updateView();
	}
	hideEverything() {
		for (const point of this.placedPoints.get()) point.destroy();
		this.placedPoints.set([]);
		this.currentViewMode = 0;
		if (this.shapeView) {
			this.shapeView.Destroy();
			this.shapeView = undefined;
		}
		if (this.targetPoint) {
			this.targetPoint.Destroy();
			this.targetPoint = undefined;
		}
		if (this.normalIndicator.Parent) this.normalIndicator.Parent = undefined; // hide the normal instead of deleting it
		this.pointsChange.Fire();
	}
	pickBlock() {
		const target = castCursor("world")?.part;
		if (!target) return;

		let model = target as BlockModel | BasePart;
		while (!model.IsA("Model")) {
			model = model.Parent as BlockModel | BasePart;
			if (!model) return;
		}

		const id = BlockManager.manager.id.get(model);
		if (id === undefined) return;

		const block = this.blockList.blocks[id];
		if (!block) return;

		this.selectedMaterial.set(BlockManager.manager.material.get(model));
		this.selectedColor.set(BlockManager.manager.color.get(model));
	}

	getDisplayName(): string {
		return "Polygon";
	}
	getImageID(): string {
		return "rbxassetid://101997657909058";
	}
}
