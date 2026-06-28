import { Players, RunService, Workspace } from "@rbxts/services";
import { SoundController } from "client/controller/SoundController";
import { MaterialColorEditControl } from "client/gui/buildmode/MaterialColorEditControl";
import { ToggleControl } from "client/gui/controls/ToggleControl";
import { LogControl } from "client/gui/static/LogControl";
import { BlockGhoster } from "client/tools/additional/BlockGhoster";
import { ToolBase } from "client/tools/ToolBase";
import { Action } from "engine/client/Action";
import { ClientComponentChild } from "engine/client/component/ClientComponentChild";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { Element } from "engine/shared/Element";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Signal } from "engine/shared/event/Signal";
import { BB } from "engine/shared/fixes/BB";
import { BlockManager } from "shared/building/BlockManager";
import { BuildingManager } from "shared/building/BuildingManager";
import { Colors } from "shared/Colors";
import { VectorUtils } from "shared/utils/VectorUtils";
import type { ToggleControlDefinition } from "client/gui/controls/ToggleControl";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { ActionController } from "client/modes/build/ActionController";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ClientBuilding } from "client/modes/build/ClientBuilding";

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
			tool.triangleChange.Connect(() => hasPoints.set(tool.trianglePoints.get().size() !== 0));
			this.parent(mainScreen.right.push("Undo Point")) //
				.subscribeVisibilityFrom({ main: this.enabledState, isTouch, hasPoints })
				.addButtonAction(() => tool.undoLastPoint());
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
				ih.onKeyDown("P", pick);
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
				ih.onKeyDown("P", pick);

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
	const EPSILON = 1e-5;
	const EPSILON_SQ = EPSILON * EPSILON;

	if (v1.FuzzyEq(v2) || v2.FuzzyEq(v3) || v3.FuzzyEq(v1)) return [];

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

/** A tool for creating triangles */
@injectable
export class TriangleTool extends ToolBase {
	readonly selectedMaterial = new ObservableValue<Enum.Material>(Enum.Material.Plastic);
	readonly selectedColor = new ObservableValue<Color4>({ color: Colors.white, alpha: 1 });

	readonly alignment = new ObservableValue<TriangleAlignment>("center");
	readonly flippedNormal = new ObservableValue<boolean>(false);
	readonly manualWinding = new ObservableValue<boolean>(false); // if the normal is based on the triangle's winding, or always faces the user

	private triangleDots: Model[] = [];
	readonly trianglePoints = new ObservableValue<Vector3[]>([]); // points for the triangle

	private targetPoint: Model | undefined = undefined;
	targetPointPosition: Vector3 | undefined = undefined;

	private triangleViewPoints = 0;
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
			Parent: Workspace, // NOTE: moving to the `Ghosts` folder (`BlockGhoster.parent`) will push out to `Workspace` anyway
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
			if (!enabled) this.hideEverything();
		});

		actions.setAlignmentTop.subCanExecuteFrom({ noController, alignTopSelected });
		actions.setAlignmentCenter.subCanExecuteFrom({ noController, alignCenterSelected });
		actions.setAlignmentBottom.subCanExecuteFrom({ noController, alignBottomSelected });

		{
			const layer = this.parentGui(mainScreen.bottom.push());
			const check = () => {
				layer.setVisibleAndEnabled(noController.get() && this.trianglePoints.get().size() !== 0);
			};
			noController.subscribe((nc) => check());
			this.triangleChange.Connect(check);

			layer
				.addButton("Cancel", undefined, "buttonNegative") //
				.addButtonAction(() => this.hideEverything());
			layer
				.addButton("Undo Point", undefined) //
				.addButtonAction(() => this.undoLastPoint());
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
	private makeTargetBall(target: Vector3 | undefined, name = "triangledot") {
		const part = new Instance("Part");
		part.Shape = Enum.PartType.Ball;
		part.Size = Vector3.one.mul(0.25);
		part.Anchored = true;

		const partModel = partsToModel([part]);
		BlockGhoster.ghostModel(partModel);
		partModel.Name = name;
		if (target) partModel.PivotTo(new CFrame(target));
		return partModel;
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
				plot.bounds.isPointInside(this.targetPointPosition as Vector3) && plot.bounds.isPointInside(points[0]);
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
	private getBestTriangleWedges(
		v1: Vector3,
		v2: Vector3,
		v3: Vector3,
		alignment: TriangleAlignment,
		manualWinding: boolean,
		cameraPos: Vector3,
		flippedNormal: boolean,
	): TriangleDetails | undefined {
		const plot = this.plot.get();

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
		const possible = getTriangleWedges(v1, v2, v3, 0.5, alignment, manualWinding, cameraPos, flippedNormal);
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
		if (points.size() === 1) {
			// line towards target
			const p1 = points[0];
			const p2 = this.targetPointPosition;

			const center = p1.add(p2).div(2);
			const dist = p1.sub(p2).Magnitude;

			let model = this.triangleView;

			// destroy model if not correct type
			if (this.triangleViewPoints !== 2) {
				model?.Destroy();
				model = undefined;
			}

			if (this.triangleNormal.Parent) this.triangleNormal.Parent = undefined;

			let line = model?.GetChildren()[0] as Part | undefined;
			if (!line) {
				line = new Instance("Part");
				line.Anchored = true;
			}
			const offset = 0.25 * triAlignOffset(this.alignment.get()) * (this.flippedNormal.get() ? -1 : 1);
			line.Size = new Vector3(0.5, 0.5, dist);
			line.CFrame = CFrame.lookAt(center, p2)
				.mul(CFrame.Angles(0, 0, math.pi / 2))
				.add(Vector3.yAxis.mul(offset));
			line.Material = Enum.Material.SmoothPlastic;
			line.Color = Color3.fromRGB(248, 248, 248);

			if (!model) {
				model = partsToModel([line]);
				model.Name = "triangleghost";
				BlockGhoster.ghostModel(model);
				this.triangleViewPoints = 2;
				this.triangleView = model;
			}
		} else if (points.size() === 2) {
			// triangle with target
			const data = this.getBestTriangleWedges(
				points[0],
				points[1],
				this.targetPointPosition,
				this.alignment.get(),
				this.manualWinding.get(),
				Workspace.CurrentCamera!.CFrame.Position,
				this.flippedNormal.get(),
			);

			const wedges = data?.wedges;
			const normal = data?.normal;

			if (normal) {
				const dir = normal.LookVector;
				this.triangleNormal.CFrame = normal.add(dir.mul(this.triangleNormal.Size.Z / 2));
				this.triangleNormal.Parent = Workspace;
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
			if (!model || this.triangleViewPoints !== 3) {
				if (model) model.Destroy();

				model = new Instance("Model");
				model.Name = "triangleghost";
				this.triangleView = model;
				this.triangleViewPoints = 3;
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
					box.LineThickness = 0.05;
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
		}

		this.updateTrianglePlaceColor();
	}
	updateTargetPoint() {
		if (!this.targetPoint) {
			this.targetPoint = this.makeTargetBall(undefined, "triangletarget");
		}

		const controller = this.currentMode.get();
		let info = undefined;
		if (controller instanceof PlaceController.Touch) {
			info = controller.prevTarget;
			if (!info) return;
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
			this.updateViewTriangle();
		}
		this.triangleChange.Fire();
	}
	addTrianglePoint(pos: Vector3 | undefined) {
		if (!pos) return;

		// check point in same position as an existing point
		const existing = this.trianglePoints.get();
		for (const point of existing) {
			if (pos.FuzzyEq(point)) {
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
		points.push(pos);
		if (points.size() !== 3) {
			SoundController.getUISounds().Build.BlockPlace.PlaybackSpeed = SoundController.randomSoundSpeed();
			SoundController.getUISounds().Build.BlockPlace.Play();
		}
		this.triangleChange.Fire();
		this.updatePoints();
	}
	private createTriangle(points: Vector3[]) {
		const plot = this.plot.get();
		const wedges = this.getBestTriangleWedges(
			points[0],
			points[1],
			points[2],
			this.alignment.get(),
			this.manualWinding.get(),
			Workspace.CurrentCamera!.CFrame.Position,
			this.flippedNormal.get(),
		)?.wedges;
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
	private updatePoints() {
		const points = this.trianglePoints.get();
		if (points.size() === 3) {
			this.createTriangle(points);
			this.hideEverything();
			return;
		}

		this.updateViewTriangle();

		// remove extra points
		while (this.triangleDots.size() > points.size()) {
			const lastDot = this.triangleDots.pop();
			if (lastDot) lastDot.Destroy();
		}

		// match each point to a dot
		for (let i = 0; i < points.size(); i++) {
			if (!this.triangleDots[i]) {
				this.triangleDots[i] = this.makeTargetBall(points[i]);
			}
			this.triangleDots[i].PivotTo(new CFrame(points[i]));
		}
	}
	undoLastPoint() {
		const points = this.trianglePoints.get();
		points.pop();

		SoundController.getUISounds().Build.BlockDelete.PlaybackSpeed = SoundController.randomSoundSpeed();
		SoundController.getUISounds().Build.BlockDelete.Play();

		if (points.size() === 0) {
			// no more points
			this.hideEverything();
			return;
		}

		this.updatePoints();
	}
	hideEverything() {
		for (const dot of this.triangleDots) {
			dot.Destroy();
		}
		this.triangleDots = [];
		this.trianglePoints.set([]);
		this.triangleViewPoints = 0;
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
