import { ReplicatedStorage, RunService, UserInputService, Workspace } from "@rbxts/services";
import { TooltipsHolder } from "client/gui/static/TooltipsControl";
import { FloatingText } from "client/tools/additional/FloatingText";
import { MoveGrid, ScaleGrid } from "client/tools/additional/Grid";
import { RotateGrid } from "client/tools/additional/Grid";
import { Action } from "engine/client/Action";
import { Interface } from "engine/client/gui/Interface";
import { InputController } from "engine/client/InputController";
import { Keybinds } from "engine/client/Keybinds";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { OverlayValueStorage } from "engine/shared/component/OverlayValueStorage";
import { Transforms } from "engine/shared/component/Transforms";
import { TransformService } from "engine/shared/component/TransformService";
import { Element } from "engine/shared/Element";
import { ObservableCollectionSet } from "engine/shared/event/ObservableCollection";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { ArgsSignal } from "engine/shared/event/Signal";
import { BB } from "engine/shared/fixes/BB";
import { MathUtils } from "engine/shared/fixes/MathUtils";
import { Strings } from "engine/shared/fixes/String.propmacro";
import { BlockManager } from "shared/building/BlockManager";
import { SharedBuilding } from "shared/building/SharedBuilding";
import { Colors } from "shared/Colors";
import type { MainScreenBottomLayer, MainScreenLayout } from "client/gui/MainScreenLayout";
import type { ClientBuildingTypes } from "client/modes/build/ClientBuilding";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { Theme } from "client/Theme";
import type { Control } from "engine/client/gui/Control";
import type { KeybindDefinition } from "engine/client/Keybinds";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";
import type { SharedPlot } from "shared/building/SharedPlot";

interface EditingBlock {
	readonly block: BlockModel;
	readonly origModel: BlockModel;
	readonly origLocation: CFrame;
	readonly origScale: Vector3;
}

class HandleMovementController extends Component {
	constructor(
		handle: Handles,
		sideways: ReadonlyObservableValue<boolean>,
		update: (delta: Vector3, face: Enum.NormalId) => void,
		release: () => void,
	) {
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

				if (sideways.get()) {
					const point = findRayPlaneIntersection(
						mouseRay.Origin,
						mouseRay.Direction,
						startingPosition,
						arrowDirection,
					);
					if (!point) return Vector3.zero;

					return point.sub(startingPosition);
				}

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
		this.event.subscribe(RunService.Heartbeat, upd);
		this.event.subscribeObservable(sideways, upd);

		this.event.subscribe(handle.MouseButton1Down, (face) => {
			if (!handle.Adornee) return;

			f = face;
			cu = calculateCursorDeltaVecOnPlane(
				handle.Adornee.Position,
				handle.Adornee.CFrame.VectorToWorldSpace(Vector3.FromNormalId(face)),
			);
		});
		this.event.subscribe(handle.MouseButton1Up, () => {
			cu = undefined;
			f = undefined;
			release();
		});
	}
}

type EditMode = "move" | "rotate" | "scale";

const repositionOne = (block: BlockModel, origModel: BlockModel, location: CFrame, scale: Vector3) => {
	block.PivotTo(location);
	SharedBuilding.scale(block, origModel, scale);
};
const almostSame = (left: number, right: number) => math.abs(left - right) < 0.0001;
const reposition = (blocks: readonly EditingBlock[], originalBB: BB, currentBB: BB) => {
	const scalediff = currentBB.originalSize.div(originalBB.originalSize);

	for (const { block, origModel, origLocation, origScale } of blocks) {
		const localToOriginalLocation = originalBB.center.ToObjectSpace(origLocation);

		const newloc = currentBB.center.ToWorldSpace(
			localToOriginalLocation.Rotation.add(localToOriginalLocation.Position.mul(scalediff)),
		);

		let newscale: Vector3;
		if (almostSame(scalediff.X, scalediff.Y) && almostSame(scalediff.Y, scalediff.Z)) {
			newscale = origScale.mul(scalediff.X);
		} else {
			newscale = origScale.mul(
				originalBB.center.ToObjectSpace(origLocation).Rotation.PointToObjectSpace(scalediff).Abs(),
			);
		}

		repositionOne(block, origModel, newloc, newscale);
	}
};

interface EditComponent extends Component {
	readonly error?: ReadonlyObservableValue<string | undefined>;
}

const centerBasedKb = Keybinds.registerDefinition(
	"edit_scale_centerBased",
	["Edit Tool", "Scale", "Scale from the center"],
	[["LeftAlt"]],
);
const sameSizeKb = Keybinds.registerDefinition(
	"edit_scale_sameSize",
	["Edit Tool", "Scale", "Uniform scaling"],
	[["LeftShift"]],
);
const sidewaysKb = Keybinds.registerDefinition(
	"edit_move_sideways",
	["Edit Tool", "Move", "Sideways movement"],
	[["LeftAlt"]],
);

const formatVecForFloatingText = (vec: Vector3, positive: boolean = true): string => {
	const format = (num: number): string => {
		const str = Strings.prettyNumber(num, 0.01);
		if (num > 0 && positive) return `+${str}`;

		return `${str}`;
	};

	return `${format(vec.X)}, ${format(vec.Y)}, ${format(vec.Z)}`;
};

interface b {
	readonly iconId?: string;
	readonly state: OverlayValueStorage<boolean>;
}
const createButtonSwitchList = <K extends string>(
	parent: Component,
	mainScreen: MainScreenLayout,
	theme: Theme,
	buttons: { readonly [k in K]: b },
): LuaTuple<[{ readonly [k in K]: Control }, MainScreenBottomLayer]> => {
	const layer = parent.parentGui(mainScreen.bottom.push());

	const ret: { [k in K]?: Control } = {};
	for (const [k, { iconId, state }] of pairs(buttons)) {
		const kb = new ObservableValue(state.get());

		const btn = layer
			.addButton(k.upper(), iconId, "buttonInactive")
			.addButtonAction(() => state.and("kb", kb.toggle()))
			.initializeSimpleTransform("BackgroundColor3")
			.themeButton(
				theme,
				parent.event.addObservable(
					state.fReadonlyCreateBased((enabled) => (enabled ? "buttonActive" : "buttonInactive")),
				),
			);

		ret[k] = btn;
	}

	return $tuple(ret as { [k in K]: Control }, layer);
};

// #region Move
// #endregion
@injectable
class MoveComponent extends Component implements EditComponent {
	constructor(
		handles: typeof ReplicatedStorage.Assets.Helpers.EditHandles,
		blocks: readonly EditingBlock[],
		originalBB: BB,
		grid: ReadonlyObservableValue<MoveGrid>,
		@inject plot: SharedPlot,
		@inject keybinds: Keybinds,
		@inject theme: Theme,
		@inject mainScreen: MainScreenLayout,
	) {
		super();

		const forEachHandle = (func: (handle: Handles) => void) => {
			func(handles.Move.XHandles);
			func(handles.Move.YHandles);
			func(handles.Move.ZHandles);
		};

		this.onEnabledStateChange((enabled) => forEachHandle((handle) => (handle.Visible = enabled)));

		const sideways = OverlayValueStorage.bool();
		let bb = BB.fromPart(handles);

		const floatingText = this.parent(FloatingText.create(handles));
		const startbb = bb;
		const updateFloatingText = () => {
			floatingText.text.set(formatVecForFloatingText(handles.Position.sub(startbb.center.Position)));
			floatingText.subtext?.set(
				formatVecForFloatingText(handles.Position.sub(plot.instance.BuildingArea.GetPivot().Position), false),
			);
		};
		updateFloatingText();

		const update = (delta: Vector3) => {
			delta = grid.get().constrain(handles.GetPivot(), delta);

			handles.PivotTo(bb.center.add(delta));
			reposition(blocks, originalBB, BB.fromPart(handles));

			updateFloatingText();
		};

		let currentMovement: Vector3 | undefined;
		const updateFromCurrentMovement = (): void => {
			if (!currentMovement) return;
			update(currentMovement);
		};

		this.event.subscribeObservable(grid, updateFromCurrentMovement);

		// #region Keyboard controls initialization
		const tooltips = this.parent(TooltipsHolder.createComponent("Edit Tool > Move"));
		tooltips.setFromKeybinds(keybinds.fromDefinition(sidewaysKb));

		this.event.subscribeObservable(keybinds.fromDefinition(sidewaysKb).isPressed, (value) => {
			sideways.and("kb", value);
			updateFromCurrentMovement();
		});
		const [, buttons] = createButtonSwitchList(this, mainScreen, theme, { sideways: { state: sideways } });
		// #endregion
		buttons
			.addButton("Snap to grid") //
			.addButtonAction(() => {
				bb = BB.fromPart(handles);
				let targetPosition = bb.center.Position;

				// костыль of fixing the plots position
				targetPosition = targetPosition.add(new Vector3(0, 0.5, 0.5));

				const sizeOffset = bb.getRotatedSize().apply((v) => (v < 0.5 ? 0 : (v % 2) / 2));
				targetPosition = targetPosition.sub(sizeOffset);
				targetPosition = grid.get().constrain(CFrame.identity, targetPosition);
				targetPosition = targetPosition.add(sizeOffset);

				// targetPosition = constrainPositionToGrid(targetPosition, 1);
				targetPosition = targetPosition.sub(new Vector3(0, 0.5, 0.5));

				handles.PivotTo(bb.center.Rotation.add(targetPosition));
				reposition(blocks, originalBB, (bb = BB.fromPart(handles)));
				updateFloatingText();
			});

		const createVisualizer = () => {
			const instance = ReplicatedStorage.Assets.Helpers.MovementVisualizer.Clone();

			instance.Decal.Transparency = 1;

			const size = 500;
			instance.Size = new Vector3(0, size, size);

			ComponentInstance.init(this, instance);
			instance.Parent = Workspace;

			let visible = false;

			const props = {
				...TransformService.commonProps.quadOut02,
				duration: 0.5,
			};

			const update = (direction: Vector3, position: Vector3) => {
				if (!sideways.get()) {
					stop();
					return;
				}

				if (!visible) {
					visible = true;

					TransformService.cancel(instance);
					TransformService.run(instance.Decal, (tr) =>
						tr.transform(instance.Decal, "Transparency", 0.95, props),
					);
				}

				instance.CFrame = CFrame.lookAt(Vector3.zero, direction)
					.mul(CFrame.Angles(0, math.rad(90), 0))
					.add(position);
			};

			const stop = () => {
				if (!visible) return;
				visible = false;

				TransformService.cancel(instance);
				TransformService.run(instance.Decal, (tr) => tr.transform(instance.Decal, "Transparency", 1, props));
			};

			return { update, stop };
		};
		const visualizer = createVisualizer();

		forEachHandle((handle) => {
			this.parent(
				new HandleMovementController(
					handle,
					sideways,
					(delta, face) => {
						currentMovement = delta;
						updateFromCurrentMovement();
						visualizer.update(
							bb.center.Rotation.mul(Vector3.FromNormalId(face)),
							bb.center.Position.add(delta),
						);
					},
					() => {
						currentMovement = undefined;

						bb = BB.fromPart(handles);
						reposition(blocks, originalBB, bb);
						visualizer.stop();
					},
				),
			);
		});
	}
}

// #region Rotate
// #endregion
@injectable
class RotateComponent extends Component implements EditComponent {
	constructor(
		handles: typeof ReplicatedStorage.Assets.Helpers.EditHandles,
		blocks: readonly EditingBlock[],
		originalBB: BB,
		grid: ReadonlyObservableValue<RotateGrid>,
		@inject theme: Theme,
		@inject mainScreen: MainScreenLayout,
	) {
		super();

		const forEachHandle = (func: (handle: ArcHandles) => void) => {
			func(handles.Rotate.ArcHandles);
		};

		this.onEnabledStateChange((enabled) => forEachHandle((handle) => (handle.Visible = enabled)));
		this.onEnable(() => (handles.Rotate.Center.Size = handles.Size));

		let bb = BB.fromPart(handles);

		const floatingText = this.parent(FloatingText.create(handles));
		const startbb = bb;
		const updateFloatingText = () => {
			const format = (cframe: CFrame, positive: boolean) => {
				const [x, y, z] = cframe.ToOrientation();
				const vec = new Vector3(x, y, z).apply((c) => MathUtils.round(math.deg(c), 0.01));
				return formatVecForFloatingText(vec, positive);
			};

			floatingText.text.set(format(handles.CFrame.Rotation.ToObjectSpace(startbb.center.Rotation), true));
			floatingText.subtext?.set(format(handles.CFrame.Rotation, false));
		};
		updateFloatingText();

		const update = (axis: Enum.Axis, relativeAngle: number) => {
			const roundedRelativeAngle = grid.get().constrain(relativeAngle);
			handles.PivotTo(bb.center.mul(CFrame.fromAxisAngle(Vector3.FromAxis(axis), roundedRelativeAngle)));
			handles.Rotate.Center.PivotTo(bb.center.mul(CFrame.fromAxisAngle(Vector3.FromAxis(axis), relativeAngle)));

			reposition(blocks, originalBB, BB.fromPart(handles));
			updateFloatingText();
		};

		let currentRotation: { readonly axis: Enum.Axis; relativeAngle: number } | undefined;
		const updateFromCurrentRotation = (): void => {
			if (!currentRotation) return;
			update(currentRotation.axis, currentRotation.relativeAngle);
		};

		this.event.subscribeObservable(grid, updateFromCurrentRotation);

		const [, buttons] = createButtonSwitchList(this, mainScreen, theme, {});
		buttons
			.addButton("Snap to grid") //
			.addButtonAction(() => {
				bb = BB.fromPart(handles);

				const [x, y, z] = handles.CFrame.Rotation.ToObjectSpace(startbb.center.Rotation).ToOrientation();
				handles.PivotTo(
					new CFrame(bb.center.Position).mul(
						CFrame.fromOrientation(
							grid.get().constrain(x),
							grid.get().constrain(y),
							grid.get().constrain(z),
						),
					),
				);
				handles.Rotate.Center.PivotTo(handles.GetPivot());

				reposition(blocks, originalBB, (bb = BB.fromPart(handles)));
				updateFloatingText();
			});

		const sub = (handle: ArcHandles) => {
			this.event.subscribe(handle.MouseDrag, (axis, relativeAngle, deltaRadius) => {
				currentRotation ??= { axis, relativeAngle };
				currentRotation.relativeAngle = relativeAngle;

				updateFromCurrentRotation();
			});

			this.event.subscribe(handle.MouseButton1Up, () => {
				currentRotation = undefined;
				handles.Rotate.Center.PivotTo(handles.GetPivot());

				bb = BB.fromPart(handles);
				reposition(blocks, originalBB, bb);
			});
		};
		forEachHandle(sub);
	}
}

// #region Scale
// #endregion
@injectable
class ScaleComponent extends Component implements EditComponent {
	readonly error = new ObservableValue<string | undefined>(undefined);

	constructor(
		handles: typeof ReplicatedStorage.Assets.Helpers.EditHandles,
		blocks: readonly EditingBlock[],
		originalBB: BB,
		grid: ReadonlyObservableValue<ScaleGrid>,
		@inject keybinds: Keybinds,
		@inject mainScreen: MainScreenLayout,
		@inject theme: Theme,
	) {
		super();

		const forEachHandle = (func: (handle: Handles) => void) => {
			func(handles.Scale.XHandles);
			func(handles.Scale.YHandles);
			func(handles.Scale.ZHandles);
		};

		this.onEnabledStateChange((enabled) => forEachHandle((handle) => (handle.Visible = enabled)));

		let bb = BB.fromPart(handles);

		const centerBased = OverlayValueStorage.bool();
		const sameSize = OverlayValueStorage.bool();

		const pivot = Element.create(
			"Part",
			{
				Anchored: true,
				Size: Vector3.one.mul(0.2),
				Color: Colors.white,
				Shape: Enum.PartType.Ball,
				Parent: Workspace,
			},
			{
				highlight: Element.create("Highlight", {
					FillColor: Colors.red,
					DepthMode: Enum.HighlightDepthMode.AlwaysOnTop,
				}),
			},
		);
		ComponentInstance.init(this, pivot);

		const floatingText = this.parent(FloatingText.create(handles));
		const startbb = bb;

		// couldent find a function that gives the bounds of everything
		const getBoundsSize = () => {
			let min = new Vector3(math.huge, math.huge, math.huge);
			let max = new Vector3(-math.huge, -math.huge, -math.huge);

			for (const { block } of blocks) {
				const [cf, size] = block.GetBoundingBox();
				const h = size.mul(0.5);

				const offsets = [
					new Vector3(h.X, h.Y, h.Z),
					new Vector3(h.X, h.Y, -h.Z),
					new Vector3(h.X, -h.Y, h.Z),
					new Vector3(h.X, -h.Y, -h.Z),
					new Vector3(-h.X, h.Y, h.Z),
					new Vector3(-h.X, h.Y, -h.Z),
					new Vector3(-h.X, -h.Y, h.Z),
					new Vector3(-h.X, -h.Y, -h.Z),
				];

				for (const off of offsets) {
					const c = cf.Position.add(off);
					min = new Vector3(math.min(min.X, c.X), math.min(min.Y, c.Y), math.min(min.Z, c.Z));
					max = new Vector3(math.max(max.X, c.X), math.max(max.Y, c.Y), math.max(max.Z, c.Z));
				}
			}

			return max.sub(min);
		};

		const updateFloatingText = () => {
			floatingText.text.set(formatVecForFloatingText(handles.Size.sub(startbb.originalSize)));
			const scale = getBoundsSize();
			floatingText.subtext?.set("(" + formatVecForFloatingText(scale, false) + ")");
		};
		updateFloatingText();

		const calculatePivotPosition = (face: Enum.NormalId): Vector3 => {
			const globalNormal = Vector3.FromNormalId(face);

			return centerBased.get() //
				? Vector3.zero
				: globalNormal.mul(bb.originalSize.div(-2));
		};
		const update = (face: Enum.NormalId, distance: number): void => {
			const negative =
				face === Enum.NormalId.Front || face === Enum.NormalId.Bottom || face === Enum.NormalId.Left;

			const globalNormal = Vector3.FromNormalId(face);
			const localPivot = calculatePivotPosition(face);
			pivot.Position = bb.center.PointToWorldSpace(localPivot);

			const distanceMul = (1 - localPivot.div(bb.originalSize).Abs().findMax()) * 2;

			const makeUnitWithAxis1 = (vector: Vector3, direction: Vector3) => {
				let axisValue = 0;
				if (direction.X !== 0) axisValue = vector.X;
				else if (direction.Y !== 0) axisValue = vector.Y;
				else if (direction.Z !== 0) axisValue = vector.Z;

				return vector.div(axisValue);
			};

			const gn = sameSize.get() //
				? makeUnitWithAxis1(bb.originalSize, globalNormal)
				: globalNormal.mul(negative ? -1 : 1);
			let g = gn.mul(distance * distanceMul);
			g = grid.get().constrain(globalNormal, handles.GetPivot(), g);

			handles.Size = bb.originalSize.add(g);
			updateFloatingText();

			handles.PivotTo(
				bb.center.ToWorldSpace(
					new CFrame(localPivot.add(localPivot.apply(math.sign).mul(handles.Size.div(-2)))),
				),
			);
			reposition(blocks, originalBB, BB.fromPart(handles));

			const overscaled = blocks.any(
				(b) => b.block.PrimaryPart!.Size.div(b.origModel.PrimaryPart!.Size).findMax() > 256,
			);
			if (overscaled) {
				this.error.set("Some blocks are scaled too big (maximum is 256x)");
			} else {
				const underscaled = blocks.any(
					(b) => b.block.PrimaryPart!.Size.div(b.origModel.PrimaryPart!.Size).findMin() < 1 / 32,
				);
				if (underscaled) {
					this.error.set("Some blocks are scaled too small (minimum is 1/32x)");
				} else {
					this.error.set(undefined);
				}
			}
		};

		let currentMovement: { readonly face: Enum.NormalId; distance: number } | undefined;
		const updateFromCurrentMovement = (): void => {
			if (!currentMovement) return;
			update(currentMovement.face, currentMovement.distance);
		};

		this.event.subscribeObservable(grid, updateFromCurrentMovement);

		// #region Keyboard controls initialization
		const tooltips = this.parent(TooltipsHolder.createComponent("Edit Tool > Scale"));
		tooltips.setFromKeybinds(keybinds.fromDefinition(centerBasedKb), keybinds.fromDefinition(sameSizeKb));

		this.event.subscribeObservable(keybinds.fromDefinition(centerBasedKb).isPressed, (value) => {
			centerBased.and("kb", value);
			updateFromCurrentMovement();
		});
		this.event.subscribeObservable(keybinds.fromDefinition(sameSizeKb).isPressed, (value) => {
			sameSize.and("kb", value);
			updateFromCurrentMovement();
		});
		// #endregion

		forEachHandle((handle) => {
			this.event.subscribe(handle.MouseDrag, (face, distance) => {
				currentMovement ??= { face, distance };
				currentMovement.distance = distance;

				updateFromCurrentMovement();
			});

			this.event.subscribe(handle.MouseButton1Down, (face) => {
				pivot.Position = bb.center.PointToWorldSpace(calculatePivotPosition(face));
			});
			this.event.subscribe(handle.MouseButton1Up, () => {
				currentMovement = undefined;
				pivot.CFrame = CFrame.identity;

				bb = BB.fromPart(handles);
				reposition(blocks, originalBB, bb);
			});
		});

		const [{ centered, uniform }, buttons] = createButtonSwitchList(this, mainScreen, theme, {
			centered: { state: centerBased },
			uniform: { state: sameSize },
		});
		const sameSizeErr = (uniform as Control<ControlWithErrorDefinition>).getComponent(ControlWithError);

		buttons
			.addButton("Snap to grid") //
			.addButtonAction(() => {
				bb = BB.fromPart(handles);
				let target = bb.originalSize;

				target = grid
					.get()
					.constrain(Vector3.xAxis, CFrame.identity, new Vector3(target.X, 0, 0))
					.add(grid.get().constrain(Vector3.yAxis, CFrame.identity, new Vector3(0, target.Y, 0)))
					.add(grid.get().constrain(Vector3.zAxis, CFrame.identity, new Vector3(0, 0, target.Z)));

				handles.Size = target;
				reposition(blocks, originalBB, (bb = BB.fromPart(handles)));
				updateFloatingText();
			});

		// #region Block rotation check
		const areRotations90DegreesApart = (cframeA: CFrame, cframeB: CFrame): boolean => {
			const rotationDifference = cframeA.ToObjectSpace(cframeB);
			const [_1, _2, _3, m00, m01, m02, m10, m11, m12, m20, m21, m22] = rotationDifference.GetComponents();

			const is90DegreeMultiple = (value: number): boolean => {
				const degrees = math.deg(math.acos(math.clamp(value, 0, 1)));
				return math.abs(degrees % 90) < 0.1 || math.abs((degrees % 90) - 90) < 0.1;
			};
			return is90DegreeMultiple(m00) && is90DegreeMultiple(m11) && is90DegreeMultiple(m22);
		};

		if (blocks.any((b) => !areRotations90DegreesApart(bb.center, b.block.GetPivot()))) {
			sameSize.and("multipleBlocks", true);
			sameSizeErr.setError(
				"Uniform scaling is forced because the selection has blocks with non-aligned rotations.",
			);
		}
		// #endregion
	}
}

//

type ControlWithErrorDefinition = GuiObject & {
	readonly WarningImage: ImageLabel;
};
class ControlWithError extends Component {
	constructor(private readonly component: Control<ControlWithErrorDefinition>) {
		super();

		component.instance.WarningImage.Visible = false;
		this.onDisable(() => component.setTooltipText(undefined));
	}

	setError(err: string | undefined) {
		this.component.instance.WarningImage.Visible = err !== undefined;
		this.component.setTooltipText(err);
	}
}

class CompoundObservableSet<T extends defined> {
	readonly set = new ObservableCollectionSet<T>();

	addSource(observable: ReadonlyObservableValue<T | undefined>) {
		observable.subscribePrev((value, prev) => {
			if (value !== undefined) {
				this.set.add(value);
			} else if (prev !== undefined) {
				this.set.remove(prev);
			}
		});
	}
}

@injectable
export class BlockEditor extends Component {
	static readonly keybinds = {
		move: Keybinds.registerDefinition("edit_move", ["Edit tool", "Move"], [["F"], ["ButtonX"]]),
		rotate: Keybinds.registerDefinition("edit_rotate", ["Edit tool", "Rotate"], [["R"]]),
		scale: Keybinds.registerDefinition("edit_scale", ["Edit tool", "Scale"], [["B"]]),
	} as const satisfies { readonly [k in string]: KeybindDefinition };

	private readonly _completed = new ArgsSignal<[state: "completed" | "cancelled"]>();
	readonly completed = this._completed.asReadonly();

	private readonly editBlocks: readonly EditingBlock[];
	private readonly currentMode: ObservableValue<EditMode>;

	private readonly moveGrid = new ObservableValue(MoveGrid.def);
	private readonly rotateGrid = new ObservableValue(RotateGrid.def);
	private readonly scaleGrid = new ObservableValue(ScaleGrid.def);
	private _errors = new CompoundObservableSet<string>();
	readonly errors = this._errors.set.asReadonly();

	constructor(
		blocks: readonly BlockModel[],
		startMode: EditMode,
		bounds: BB,
		editMode: "global" | "local",
		@inject keybinds: Keybinds,
		@inject blockList: BlockList,
		@inject playerData: PlayerDataStorage,
		@inject mainScreen: MainScreenLayout,
		@inject theme: Theme,
		@inject di: DIContainer,
	) {
		super();
		this.currentMode = new ObservableValue<EditMode>(startMode);

		const actions = {
			move: this.parent(new Action(() => setModeByKey("move"))),
			rotate: this.parent(new Action(() => setModeByKey("rotate"))),
			scale: this.parent(new Action(() => setModeByKey("scale"))),

			cancel: this.parent(
				new Action(() => {
					this.cancel();
					this._completed.Fire("cancelled");
				}),
			),
			finish: this.parent(new Action(() => this._completed.Fire("completed"))),
		} as const;

		actions.move.initKeybind(keybinds.fromDefinition(BlockEditor.keybinds.move), { priority: -1 });
		actions.rotate.initKeybind(keybinds.fromDefinition(BlockEditor.keybinds.rotate), { priority: -1 });
		actions.scale.initKeybind(keybinds.fromDefinition(BlockEditor.keybinds.scale), { priority: -1 });

		actions.move.subCanExecuteFrom({ main: new ObservableValue(true) });
		actions.rotate.subCanExecuteFrom({ main: new ObservableValue(true) });
		actions.scale.subCanExecuteFrom({ main: new ObservableValue(true) });

		actions.cancel.subCanExecuteFrom({ main: new ObservableValue(true) });
		actions.finish.subCanExecuteFrom({ main: new ObservableValue(true) });

		{
			const layer = this.parentGui(mainScreen.bottom.push());

			layer.addButton("cancel", "15429854809", "buttonNegative").subscribeToAction(actions.cancel);
			layer.addButton("finish", "15429854809", "buttonPositive").subscribeToAction(actions.finish);
		}

		{
			const layer = this.parentGui(mainScreen.bottom.push());
			layer.visibilityComponent().addTransform(false, () =>
				Transforms.create() //
					.fullFadeOut(layer.instance, Transforms.quadOut02)
					.then()
					.hide(layer.instance),
			);
			this.onDestroy(() => layer.visibilityComponent().waitForTransformThenDestroy());

			const move = layer
				.addButton("move", "18369400240")
				.initializeSimpleTransform("BackgroundColor3")
				.subscribeToAction(actions.move);
			const rotate = layer
				.addButton("rotate", "18369417777")
				.initializeSimpleTransform("BackgroundColor3")
				.subscribeToAction(actions.rotate);
			const scale = layer
				.addButton("scale", "89349384867990")
				.initializeSimpleTransform("BackgroundColor3")
				.subscribeToAction(actions.scale);

			const btns = { move, rotate, scale };
			this.event.subscribeObservable(
				this.currentMode,
				(mode) => {
					for (const [name, button] of pairs(btns)) {
						button.overlayValue(
							"BackgroundColor3",
							theme.get(mode === name ? "buttonActive" : "buttonNormal"),
						);
					}
				},
				true,
			);
		}

		this.editBlocks = blocks.map((b): EditingBlock => {
			const origModel = blockList.blocks[BlockManager.manager.id.get(b)]!.model;
			const scale = b.PrimaryPart!.Size.div(origModel.PrimaryPart!.Size);

			return {
				block: b,
				origModel,
				origLocation: b.GetPivot(),
				origScale: scale,
			};
		});

		const handles = ReplicatedStorage.Assets.Helpers.EditHandles.Clone();
		handles.Parent = Interface.getPlayerGui();
		ComponentInstance.init(this, handles);

		this.event.subscribeObservable(
			playerData.config,
			(config) => {
				const visuals = config.visuals.multiSelection;
				const sb = handles.SelectionBox;

				sb.Color3 = visuals.borderColor;
				sb.Transparency = visuals.borderTransparency;
				sb.LineThickness = visuals.borderThickness;

				sb.SurfaceColor3 = visuals.surfaceColor;
				sb.SurfaceTransparency = visuals.surfaceTransparency;
			},
			true,
		);

		const inBoundsError = new ObservableValue<string | undefined>(undefined);
		this._errors.addSource(inBoundsError);
		const updateHandlesInBounds = () => {
			if (bounds.isBBInside(BB.fromPart(handles))) {
				inBoundsError.set(undefined);
			} else {
				inBoundsError.set("Out of bounds");
			}
		};
		this.event.readonlyObservableFromInstanceParam(handles, "CFrame").subscribe(updateHandlesInBounds);
		this.event.readonlyObservableFromInstanceParam(handles, "Size").subscribe(updateHandlesInBounds);

		const errIndicator = Element.create("SelectionBox", {
			Color3: Colors.red,
			SurfaceColor3: Colors.red,
			Transparency: 1,
			SurfaceTransparency: 1,
			Adornee: handles,
			Parent: handles,
		});
		this.event.subscribe(this.errors.collectionChanged, () => {
			const valid = this.errors.size() === 0;

			const props = {
				...TransformService.commonProps.quadOut02,
				duration: valid ? 0.5 : 0.1,
			};

			TransformService.run(errIndicator, (tr) =>
				tr
					.transform(errIndicator, "Transparency", valid ? 1 : 0, props)
					.transform(errIndicator, "SurfaceTransparency", valid ? 1 : 0.3, props),
			);
		});

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

		const initializeHandles = (handles: Handles | ArcHandles) => {
			handles.Visible = false;

			this.event.subscribeObservable(
				this.event.readonlyObservableFromInstanceParam(handles, "Visible"),
				(visible) => {
					if (!visible) {
						releaseCamera();
					}
				},
			);

			// disable camera on drag
			this.event.subscribeRegistration(() => {
				if (InputController.inputType.get() !== "Touch") {
					return;
				}

				return [handles.MouseButton1Down.Connect(grabCamera), handles.MouseButton1Up.Connect(releaseCamera)];
			});
			this.event.subInput((ih) => {
				ih.onInputEnded((b) => {
					if (b.UserInputType !== Enum.UserInputType.Touch) return;
					releaseCamera();
				});
			});
		};
		initializeHandles(handles.Move.XHandles);
		initializeHandles(handles.Move.YHandles);
		initializeHandles(handles.Move.ZHandles);
		initializeHandles(handles.Scale.XHandles);
		initializeHandles(handles.Scale.YHandles);
		initializeHandles(handles.Scale.ZHandles);
		initializeHandles(handles.Rotate.ArcHandles);

		const setModeByKey = (mode: EditMode) => {
			if (this.currentMode.get() === mode) {
				this._completed.Fire("completed");
				return Enum.ContextActionResult.Sink;
			}

			this.currentMode.set(mode);
			return Enum.ContextActionResult.Sink;
		};

		const bb = BB.fromModels(blocks, editMode === "global" ? CFrame.identity : undefined);
		handles.PivotTo(bb.center);
		handles.Size = bb.originalSize;

		const modes: { readonly [k in EditMode]: () => Component } = {
			move: () => di.resolveForeignClass(MoveComponent, [handles, this.editBlocks, bb, this.moveGrid]),
			rotate: () => di.resolveForeignClass(RotateComponent, [handles, this.editBlocks, bb, this.rotateGrid]),
			scale: () => di.resolveForeignClass(ScaleComponent, [handles, this.editBlocks, bb, this.scaleGrid]),
		};

		const container = this.parent(new ComponentChild<EditComponent>());
		container.childSet.Connect((child) => {
			if (!child?.error) return;
			this._errors.addSource(child.error);
		});
		this.event.subscribeObservable(this.currentMode, (mode) => container.set(modes[mode]()), true);
	}

	initializeGrids(grids: {
		readonly moveGrid: ReadonlyObservableValue<number>;
		readonly rotateGrid: ReadonlyObservableValue<number>;
		readonly scaleGrid: ReadonlyObservableValue<number>;
	}) {
		this.event.subscribeObservable(grids.moveGrid, (grid) => this.moveGrid.set(MoveGrid.normal(grid)), true);
		this.event.subscribeObservable(
			grids.rotateGrid,
			(grid) => this.rotateGrid.set(RotateGrid.normal(math.rad(grid))),
			true,
		);
		this.event.subscribeObservable(grids.scaleGrid, (grid) => this.scaleGrid.set(ScaleGrid.normal(grid)), true);
	}

	getUpdate(): readonly ClientBuildingTypes.EditBlockInfo[] {
		return this.editBlocks.map(
			(b): ClientBuildingTypes.EditBlockInfo => ({
				instance: b.block,
				origPosition: b.origLocation,
				newPosition: b.block.GetPivot(),
				origScale: b.origScale,
				newScale: b.block.PrimaryPart!.Size.div(b.origModel.PrimaryPart!.Size),
			}),
		);
	}

	cancel() {
		for (const { block, origModel, origLocation, origScale } of this.editBlocks) {
			repositionOne(block, origModel, origLocation, origScale);
		}
	}
}
