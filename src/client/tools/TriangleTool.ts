import { Players, ReplicatedStorage, RunService, UserInputService, Workspace } from "@rbxts/services";
import { SoundController } from "client/controller/SoundController";
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
import { LocalPlayer } from "engine/client/LocalPlayer";
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { Element } from "engine/shared/Element";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Signal } from "engine/shared/event/Signal";
import { BB } from "engine/shared/fixes/BB";
import { Strings } from "engine/shared/fixes/String.propmacro";
import { BlockManager } from "shared/building/BlockManager";
import { BuildingManager } from "shared/building/BuildingManager";
import { Colors } from "shared/Colors";
import { VectorUtils } from "shared/utils/VectorUtils";
import type { ToggleControlDefinition } from "client/gui/controls/ToggleControl";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { ActionController } from "client/modes/build/ActionController";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ClientBuilding } from "client/modes/build/ClientBuilding";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";
import type { SharedPlot } from "shared/building/SharedPlot";

const allowedColor = Colors.blue;
const forbiddenColor = Colors.red;
const mouse = Players.LocalPlayer.GetMouse();

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

const getMouseTargetBlockPositionV3 = (
	block: BlockModel,
	rotation: CFrame,
	scale: Vector3,
	gridEnabled: boolean,
	step: number,
	info?: [target: BasePart | undefined, hit: CFrame, surface: Enum.NormalId | undefined],
): Vector3 | undefined => {
	const snapFaceCorner = (target: BasePart, hitWorld: Vector3, faceWorld: Vector3, step: number) => {
		const cf = target.CFrame;
		const hitLocal = cf.PointToObjectSpace(hitWorld);
		const faceLocal = cf.VectorToObjectSpace(faceWorld);

		const absNormal = new Vector3(math.abs(faceLocal.X), math.abs(faceLocal.Y), math.abs(faceLocal.Z));

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

	const target = info?.[0] ?? mouse.Target;
	if (!target) return;

	const mouseHit = info?.[1] ?? mouse.Hit;
	const mouseSurface = info?.[2] ?? mouse.TargetSurface;

	const globalMouseHitPos = mouseHit.PointToWorldSpace(Vector3.zero);
	const normal = target.CFrame.Rotation.VectorToWorldSpace(Vector3.FromNormalId(mouseSurface));

	const aabb = fromModelBB(block, rotation);
	let targetPosition = globalMouseHitPos;
	targetPosition = addTargetSize(target, normal, targetPosition);
	targetPosition = offsetBlockPivotToCenter(block, targetPosition);
	targetPosition = addBlockSize(normal, targetPosition);

	if (gridEnabled) {
		targetPosition = snapFaceCorner(target, targetPosition, normal, step);
	}

	return targetPosition;
};

const getMouseTargetBlockPosition = getMouseTargetBlockPositionV3;

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
		constructor(@inject tool: TriangleTool, @inject mainScreen: MainScreenLayout) {
			super();

			const isTouch = new ObservableValue(false);
			this.event.onPrepare((inputType) => isTouch.set(inputType === "Touch"));

			this.parent(mainScreen.right.push("+")) //
				.subscribeVisibilityFrom({ main: this.enabledState, isTouch })
				.addButtonAction(() => tool.addTrianglePoint(tool.targetPointPosition));
			const hasPoints = new ObservableValue(false);
			this.parent(mainScreen.right.push("Undo Point")) //
				.subscribeVisibilityFrom({ main: this.enabledState, isTouch, hasPoints })
				.addButtonAction(() => tool.undoLastPoint());
			const possibleShape = new ObservableValue(false);
			this.parent(mainScreen.right.push("Confirm")) //
				.subscribeVisibilityFrom({ main: this.enabledState, isTouch, possibleShape })
				.addButtonAction(() => tool.placeTheShape());

			tool.triangleChange.Connect(() => {
				const pointCount = tool.trianglePoints.get().size();
				hasPoints.set(pointCount !== 0);
				possibleShape.set(pointCount >= 3);
			});
		}
	}

	@injectable
	export class TriangleToolScene extends Component {
		readonly tool;

		constructor(@inject tool: TriangleTool, @inject mainScreen: MainScreenLayout, @inject di: DIContainer) {
			super();
			this.tool = tool;

			this.parent(di.resolveForeignClass(TouchButtons));

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
					toggle.value.subscribe((v) => this.tool.updateViewTriangle());

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
		protected readonly tool: TriangleTool;
		constructor(state: TriangleTool, di: DIContainer) {
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
		constructor(@inject state: TriangleTool, @inject di: DIContainer) {
			super(state, di);

			this.event.subInput((ih) => {
				ih.onMouse1Up(() => {
					if (Interface.isCursorOnVisibleGui()) return;
					this.tool.addTrianglePoint(this.tool.targetPointPosition);
				}, false);

				const pick = () => {
					state.pickBlock();
					state.hideEverything();
				};
				ih.onMouse3Down(pick, false);
				ih.onKeyDown("P", (io) => {
					// ignore freecam's shift+p shortcut
					if (io.IsModifierKeyDown("Shift")) return;
					pick();
				});
			});
		}
	}
	@injectable
	export class Touch extends Controller {
		prevTarget: [target: BasePart, hit: CFrame, surface: Enum.NormalId] | undefined;

		constructor(@inject state: TriangleTool, @inject di: DIContainer) {
			super(state, di);

			this.event.subInput((ih) => {
				ih.onTouchTap(() => {
					if (Interface.isCursorOnVisibleGui()) return;
					const target = mouse.Target;
					if (target) {
						this.prevTarget = [target, mouse.Hit, mouse.TargetSurface];
					}
				}, false);
			});
		}
	}
	@injectable
	class Gamepad extends Desktop {
		constructor(@inject state: TriangleTool, @inject di: DIContainer) {
			super(state, di);

			this.event.subInput((ih) => {
				const pick = () => {
					state.pickBlock();
					this.tool.updateTargetPoint();
				};
				ih.onMouse3Down(pick, false);
				ih.onKeyDown("P", (io) => {
					// ignore freecam's shift+p shortcut
					if (io.IsModifierKeyDown("Shift")) return;
					pick();
				});

				ih.onKeyDown("ButtonX", () => this.tool.addTrianglePoint(this.tool.targetPointPosition));
				ih.onKeyDown("ButtonY", () => this.tool.undoLastPoint());
				ih.onKeyDown("DPadLeft", () => this.tool.manualWinding.toggle());
				ih.onKeyDown("DPadRight", () => this.tool.flippedNormal.toggle());
				ih.onKeyDown("DPadUp", () => {
					// move triangle up (align goes down)
					const align = this.tool.alignment;
					const alignv = align.get();
					if (alignv === "center") align.set("bottom");
					if (alignv === "top") align.set("center");
				});
				ih.onKeyDown("DPadDown", () => {
					// move triangle down (align goes up)
					const align = this.tool.alignment;
					const alignv = align.get();
					if (alignv === "center") align.set("top");
					if (alignv === "bottom") align.set("center");
				});
			});
		}
	}

	export function create(tool: TriangleTool, di: DIContainer) {
		di = di.beginScope((di) => di.registerSingletonValue(tool));

		return ClientComponentChild.createOnceBasedOnInputType({
			Desktop: () => di.resolveForeignClass(Desktop),
			Touch: () => di.resolveForeignClass(Touch),
			Gamepad: () => di.resolveForeignClass(Gamepad),
		});
	}
}

// helper for creating a target
const makeTargetBall = (target: Vector3 | undefined, name = "triangledot") => {
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
			const camera = Workspace.CurrentCamera;
			if (!camera) return () => Vector3.zero;

			const mouseLocation = UserInputService.GetMouseLocation();
			const mouseRay = camera.ScreenPointToRay(mouseLocation.X, mouseLocation.Y);
			const startingMouseRay = mouseRay;

			const startingPosition = findRayPlaneIntersection(
				mouseRay.Origin,
				mouseRay.Direction,
				arrowPosition,
				mouseRay.Direction,
			);
			if (!startingPosition) return () => Vector3.zero;

			return () => {
				const camera = Workspace.CurrentCamera;
				if (!camera) return Vector3.zero;

				const mouseLocation = UserInputService.GetMouseLocation();
				const mouseRay = camera.ScreenPointToRay(mouseLocation.X, mouseLocation.Y);

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

// #region TrianglePoint
// #endregion

@injectable
class TrianglePoint extends Component {
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

type TriangleAlignment = "top" | "center" | "bottom";

const triAlignOffset = (alignment: TriangleAlignment) => {
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

const getTriangleWedges = (
	v1: Vector3,
	v2: Vector3,
	v3: Vector3,
	thickness: number,
	alignment: TriangleAlignment,
	manualWinding: boolean,
	cameraPos: Vector3,
	flippedNormal: boolean,
): TriangleDetails[] => {
	const EPSILON = 1e-8;
	const EPSILON_SQ = EPSILON * EPSILON;

	if (v1.FuzzyEq(v2, EPSILON) || v2.FuzzyEq(v3, EPSILON) || v3.FuzzyEq(v1, EPSILON)) return [];

	const originalNormal = v2.sub(v1).Cross(v3.sub(v1));
	if (originalNormal.Dot(originalNormal) <= EPSILON_SQ) return [];

	const centroid = v1.add(v2).add(v3).div(3);
	const offset = (thickness / 2) * triAlignOffset(alignment);

	const permutations = [
		[v1, v2, v3],
		[v2, v3, v1],
		[v3, v1, v2],
	];

	const results: TriangleDetails[] = [];

	for (const [p1, p2, p3] of permutations) {
		const [ab, ac, bc] = [p2.sub(p1), p3.sub(p1), p3.sub(p2)];
		const [abd, acd, bcd] = [ab.Dot(ab), ac.Dot(ac), bc.Dot(bc)];

		if (abd <= EPSILON_SQ || acd <= EPSILON_SQ || bcd <= EPSILON_SQ) continue;

		if (ab.Dot(bc) > EPSILON || ac.Dot(bc) < -EPSILON) continue;

		const normal = ab.Cross(ac);
		if (normal.Dot(normal) <= EPSILON_SQ) continue;

		const right = ac.Cross(ab).Unit;
		if (right.Magnitude < EPSILON) continue;

		const up = bc.Cross(right).Unit;
		if (up.Magnitude < EPSILON) continue;

		const back = bc.Unit;
		const height = math.abs(ab.Dot(up));
		if (height < EPSILON) continue;

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

// #region Tool
// #endregion

/** A tool for creating triangles */
@injectable
export class TriangleTool extends ToolBase {
	readonly selectedMaterial = new ObservableValue<Enum.Material>(Enum.Material.Plastic);
	readonly selectedColor = new ObservableValue<Color4>({ color: Colors.white, alpha: 1 });

	readonly alignment = new ObservableValue<TriangleAlignment>("center");
	readonly flippedNormal = new ObservableValue<boolean>(false);
	readonly manualWinding = new ObservableValue<boolean>(false); // if the normal is based on the triangle's winding, or always faces the user
	readonly precisionMode = new ObservableValue<boolean>(false); // lets the user move the points

	private readonly moveGrid = new ObservableValue(MoveGrid.def);
	private readonly triangleThickness = new ObservableValue<number>(0.5);

	readonly trianglePoints = new ObservableValue<TrianglePoint[]>([]);
	private targetPoint: Model | undefined = undefined;
	targetPointPosition: Vector3 | undefined = undefined;

	private currentTriangleViewMode = 0;
	private triangleView: Model | undefined = undefined; // example triangle when placing
	private readonly triangleNormal: Part;

	readonly triangleChange = new Signal();

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
	) {
		super(mode);

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
		this.triangleNormal = normalPart;

		this.building = di.resolve<ClientBuilding>();
		this.plot = this.targetPlot;

		this.parent(di.resolveForeignClass(Scene.TriangleToolScene));
		this.controller = this.parent(new Component());
		this.controller.onEnable(() => this.currentMode.set(PlaceController.create(this, di)));
		this.controller.onDisable(() => this.currentMode.set(undefined));
		this.controller.onEnabledStateChange((enabled) => {
			const gridUI = Interface.getPlayerGui()
				.WaitForChild("Grid Floating")
				.WaitForChild("Grid")
				.WaitForChild("Content")
				.WaitForChild("TriangleThickness") as Frame;
			gridUI.Visible = enabled;
		});

		this.event.subscribeObservable(this.mode.moveGrid, (grid) => this.moveGrid.set(MoveGrid.normal(grid)), true);
		this.event.subscribeObservable(this.mode.triangleThickness, (thickness) => {
			this.triangleThickness.set(thickness);
			this.updateViewTriangle();
		});
		// re-bind on CurrentCamera change, since a freecam switch reassigns it
		let cameraCFrameSub: SignalConnection | undefined;
		this.onDisable(() => cameraCFrameSub?.Disconnect());
		this.event.subscribeObservable(
			this.event.readonlyObservableFromInstanceParam(Workspace, "CurrentCamera"),
			(camera) => {
				cameraCFrameSub?.Disconnect();
				cameraCFrameSub = camera?.GetPropertyChangedSignal("CFrame").Connect(() => this.updateViewTriangle());
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

		const alignTopSelected = this.alignment.createBased((alignment) => alignment !== "top");
		const alignCenterSelected = this.alignment.createBased((alignment) => alignment !== "center");
		const alignBottomSelected = this.alignment.createBased((alignment) => alignment !== "bottom");

		const noController = new ObservableValue(true);
		this.onEnabledStateChange((enabled) => {
			noController.set(enabled);
			if (enabled) {
				this.moveGrid.set(MoveGrid.normal(this.mode.moveGrid.get()));
				this.triangleThickness.set(this.mode.triangleThickness.get());
			} else {
				this.hideEverything();
			}
		});

		actions.setAlignmentTop.subCanExecuteFrom({ noController, alignTopSelected });
		actions.setAlignmentCenter.subCanExecuteFrom({ noController, alignCenterSelected });
		actions.setAlignmentBottom.subCanExecuteFrom({ noController, alignBottomSelected });

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
				const pointCount = this.trianglePoints.get().size();
				confirmButton.setVisibleAndEnabled(pointCount >= 3);
				layer.setVisibleAndEnabled(controller && pointCount !== 0);
			};
			noController.subscribe((nc) => check());
			this.triangleChange.Connect(check);
			this.precisionMode.changed.Connect(check);
		}

		{
			const layer = this.parentGui(mainScreen.bottom.push());
			noController.subscribe((nc) => layer.setVisibleAndEnabled(nc));

			layer.addButton("Align Top").subscribeToAction(actions.setAlignmentTop);
			layer.addButton("Align Center").subscribeToAction(actions.setAlignmentCenter);
			layer.addButton("Align Bottom").subscribeToAction(actions.setAlignmentBottom);
		}

		{
			const layer = this.parentGui(mainScreen.bottom.push());
			noController.subscribe((nc) => layer.setVisibleAndEnabled(nc));

			const materialColorEditor = layer.parent(MaterialColorEditControl.autoCreate(true));
			materialColorEditor.autoSubscribe(this.selectedMaterial, this.selectedColor);

			this.selectedMaterial.subscribe((mat) => this.updateViewTriangle());
			this.selectedColor.subscribe((color) => this.updateViewTriangle());
		}
	}

	private setAlignment(alignment: TriangleAlignment) {
		this.alignment.set(alignment);
		this.updateViewTriangle();
	}
	private updateTrianglePlaceColor() {
		const plot = this.plot.get();
		const points = this.trianglePoints.get();

		if (points.size() === 0) {
			// no triangle placed - start point
			const canBePlaced = plot.bounds.isPointInside(this.targetPointPosition as Vector3);
			BlockGhoster.setColor(canBePlaced ? allowedColor : forbiddenColor);
			return;
		} else if (points.size() === 1) {
			// one point placed - a line
			const canBePlaced =
				plot.bounds.isPointInside(this.targetPointPosition as Vector3) &&
				plot.bounds.isPointInside(points[0].position);
			BlockGhoster.setColor(canBePlaced ? allowedColor : forbiddenColor);
			return;
		}

		if (!this.triangleView) return;
		const areAllBlocksInsidePlot = plot.bounds.isBBInside(BB.fromModel(this.triangleView));
		const canBePlaced =
			areAllBlocksInsidePlot &&
			BuildingManager.blockCanBePlacedAt(
				plot,
				{ model: this.triangleView },
				this.triangleView.GetPivot(),
				Vector3.one,
			);

		BlockGhoster.setColor(canBePlaced ? allowedColor : forbiddenColor);
	}
	private getBestTriangleWedges(v1: Vector3, v2: Vector3, v3: Vector3): TriangleDetails | undefined {
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
			this.triangleThickness.get(),
			this.alignment.get(),
			this.manualWinding.get(),
			Workspace.CurrentCamera!.CFrame.Position,
			this.flippedNormal.get(),
		);
		let best: { score: number; data: TriangleDetails | undefined } = { score: math.huge, data: undefined };
		for (const option of possible) {
			if (inBounds(option)) {
				const score = getScore(option.wedges.map((w) => w.size));

				if (score === 0) return option; // 0 is already the best
				if (score < best.score) best = { score, data: option };
			}
		}
		return best.data ?? possible[0];
	}
	updateViewTriangle() {
		if (!this.targetPointPosition) return;

		const points = this.trianglePoints.get();

		for (const point of points) point.updateDotSize(points.map((p) => p.position));

		if (points.size() === 1) {
			// line towards target
			const p1 = points[0].position;
			const p2 = this.targetPointPosition;

			const center = p1.add(p2).div(2);
			const dist = p1.sub(p2).Magnitude;

			let model = this.triangleView;

			// destroy model if not correct type
			if (this.currentTriangleViewMode !== 2) {
				model?.Destroy();
				model = undefined;
			}

			if (this.triangleNormal.Parent) this.triangleNormal.Parent = undefined;

			let line = model?.GetChildren()[0] as Part | undefined;
			if (!line) {
				line = new Instance("Part");
				line.Anchored = true;
			}
			const thickness = this.triangleThickness.get();
			const offset = (thickness / 2) * triAlignOffset(this.alignment.get()) * (this.flippedNormal.get() ? -1 : 1);
			const lineThickness = math.max(0.01, math.min(0.5, dist / 2));
			line.Size = new Vector3(thickness, lineThickness, dist);
			line.CFrame = CFrame.lookAt(center, p2)
				.mul(CFrame.Angles(0, 0, math.pi / 2))
				.add(Vector3.yAxis.mul(offset));
			line.Material = Enum.Material.SmoothPlastic;
			line.Color = Color3.fromRGB(248, 248, 248);

			if (!model) {
				model = partsToModel([line]);
				model.Name = "triangleghost";
				BlockGhoster.ghostModel(model);
				this.currentTriangleViewMode = 2;
				this.triangleView = model;
			}
		} else if (points.size() >= 2) {
			// full triangle
			const p1 = points[0].position;
			const p2 = points[1].position;
			const p3 = points.size() === 3 ? points[2].position : this.targetPointPosition;
			const data = this.getBestTriangleWedges(p1, p2, p3);

			const wedges = data?.wedges;
			const normal = data?.normal;

			if (normal) {
				const dir = normal.LookVector;
				const scale = p1.sub(p3).Cross(p2.sub(p3)).Magnitude / 8;
				this.triangleNormal.Size = new Vector3(0.1, 0.1, 3).mul(math.clamp(scale, 0.3, 1.5));
				this.triangleNormal.CFrame = normal.add(dir.mul(this.triangleNormal.Size.Z / 2));
				this.triangleNormal.Parent = Workspace; // NOTE: moving to the `Ghosts` folder (`BlockGhoster.parent`) will push out to `Workspace` anyway
			} else {
				if (this.triangleNormal.Parent) this.triangleNormal.Parent = undefined;
			}

			if (!wedges) {
				// no wedges -> no triangle
				if (this.triangleView) {
					this.triangleView.Destroy();
					this.triangleView = undefined;
				}
				this.updateTrianglePlaceColor();
				return;
			}

			let model = this.triangleView;
			// ensure model exists (and in correct state)
			if (!model || this.currentTriangleViewMode !== 3) {
				if (model) model.Destroy();

				model = new Instance("Model");
				model.Name = "triangleghost";
				this.triangleView = model;
				this.currentTriangleViewMode = 3;
			}
			const parts: BasePart[] = model.GetChildren() as BasePart[];

			// update/create parts
			for (let i = 0; i < wedges.size(); i++) {
				let part = parts[i];
				if (!part) {
					part = new Instance("WedgePart");
					part.Material = Enum.Material.SmoothPlastic;
					part.Anchored = true;
					part.Parent = model;
					parts[i] = part;

					const box = new Instance("SelectionBox");
					box.LineThickness = 0.01;
					box.Adornee = part;
					box.Parent = part;
				}

				const wedge = wedges[i];
				part.Size = wedge.size;
				part.CFrame = wedge.cframe;
			}
			// remove extra 2nd part if not needed
			if (wedges.size() === 1 && parts[1]) {
				parts[1].Destroy();
			}
			BlockGhoster.ghostModel(model);

			if (points.size() === 3) {
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

		if (points.size() !== 3) {
			for (const point of points) {
				point.setHandlesEnabled(false);
			}
		}

		this.updateTrianglePlaceColor();
	}
	updateTargetPoint() {
		// no target needed if already 3 points
		const points = this.trianglePoints.get();
		if (points.size() === 3) {
			this.targetPoint?.Destroy();
			this.targetPoint = undefined;
			return;
		}

		if (!this.targetPoint) {
			this.targetPoint = makeTargetBall(undefined, "triangletarget");
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
		const pos = getMouseTargetBlockPosition(
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
			this.updateViewTriangle();
		}
		this.triangleChange.Fire();
	}
	addTrianglePoint(pos: Vector3 | undefined) {
		if (!pos) return;

		const existing = this.trianglePoints.get();
		if (existing.size() === 3) return; // skip if already 3 points

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

		const points = this.trianglePoints.get();
		const point = this.di.resolveForeignClass(TrianglePoint, [pos, this.moveGrid, () => this.updateViewTriangle()]);
		point.enable();
		points.push(point);
		if (points.size() !== 3) {
			SoundController.getUISounds().Build.BlockPlace.PlaybackSpeed = SoundController.randomSoundSpeed();
			SoundController.getUISounds().Build.BlockPlace.Play();
		}

		const pointData = [
			...points.map((p) => p.position),
			...(this.targetPointPosition ? [this.targetPointPosition] : []),
		];
		if (this.targetPointPosition && this.targetPoint)
			updateBallSize(this.targetPointPosition, this.targetPoint, pointData);
		this.triangleChange.Fire();
		this.updateViewTriangle();
	}
	private createTriangle(points: Vector3[]) {
		if (points.size() !== 3) {
			$warn("Invalid point amount");
			return;
		}
		const EPSILON = 1e-8;
		if (
			points[0].FuzzyEq(points[1], EPSILON) ||
			points[1].FuzzyEq(points[2], EPSILON) ||
			points[2].FuzzyEq(points[0], EPSILON)
		) {
			LogControl.instance.addLine("Triangle contains duplicated points");
			SoundController.getUISounds().Build.BlockPlaceError.Play();
			return;
		}
		const plot = this.plot.get();
		const wedges = this.getBestTriangleWedges(points[0], points[1], points[2])?.wedges;
		if (wedges) {
			if (this.triangleView) {
				const pointsInside = points.all((p) => plot.bounds.isPointInside(p));
				const areAllBlocksInsidePlot = plot.bounds.isBBInside(BB.fromModel(this.triangleView));
				if (pointsInside && !areAllBlocksInsidePlot) {
					// points are valid but triangle is not
					LogControl.instance.addLine("Triangle cannot be formed here", Colors.red);
					SoundController.getUISounds().Build.BlockPlaceError.Play();
					return;
				}
			}

			this.actionController.startCombineStack("Place Triangle");

			const blocks: PlaceBlockRequest[] = wedges.map((wedge) => {
				return {
					id: "wedge1x1", // place basic wedges
					color: this.selectedColor.get(),
					material: this.selectedMaterial.get(),
					scale: wedge.size.mul(0.5),
					location: wedge.cframe,
					uuid: undefined,
					config: undefined,
				} as PlaceBlockRequest;
			});
			const response = this.building.placeOperation.execute({ plot, blocks });
			processPlaceResponse(response);

			this.actionController.endCombineStack();
		} else {
			warn("Triangle invalid");
		}

		this.hideEverything();
	}
	placeTheShape() {
		const points = this.trianglePoints.get();
		if (points.size() !== 3) {
			LogControl.instance.addLine("Triangle does not have 3 points!", Colors.red);
			$warn("Triangle does not have 3 points!");
			return;
		}
		// store points and hide everything first to avoid issues
		const triPoints = points.map((p) => p.position);
		this.hideEverything();
		this.createTriangle(triPoints);
	}
	undoLastPoint() {
		const points = this.trianglePoints.get();
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
		this.updateViewTriangle();
	}
	hideEverything() {
		for (const point of this.trianglePoints.get()) point.destroy();
		this.trianglePoints.set([]);
		this.currentTriangleViewMode = 0;
		if (this.triangleView) {
			this.triangleView.Destroy();
			this.triangleView = undefined;
		}
		if (this.targetPoint) {
			this.targetPoint.Destroy();
			this.targetPoint = undefined;
		}
		if (this.triangleNormal.Parent) this.triangleNormal.Parent = undefined; // hide the normal instead of deleting it
		this.triangleChange.Fire();
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
		if (id === undefined) return;

		const block = this.blockList.blocks[id];
		if (!block) return;

		this.selectedMaterial.set(BlockManager.manager.material.get(model));
		this.selectedColor.set(BlockManager.manager.color.get(model));
	}

	getDisplayName(): string {
		return "Triangle";
	}
	getImageID(): string {
		return "rbxassetid://101997657909058";
	}
}
