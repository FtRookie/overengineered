import { GuiService, Lighting, ReplicatedStorage, RunService, UserInputService, Workspace } from "@rbxts/services";
import { MultiBlockConfigControl } from "client/gui/BlockConfigControls";
import { FloatingWindow } from "client/gui/FloatingWindow";
import { MarkerWireVisualizer } from "client/gui/MarkerWireVisualizer";
import { ServiceIntegrityChecker } from "client/integrity/ServiceIntegrityChecker";
import { PonderAnimation } from "client/ponders/PonderAnimation";
import { SceneRunner } from "client/scene/SceneRunner";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { touchButtonsVisible } from "engine/client/Keybinds";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { Element } from "engine/shared/Element";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { BlockConfig } from "shared/blockLogic/BlockConfig";
import { GameEnvironment } from "shared/data/GameEnvironment";
import { PartUtils } from "shared/utils/PartUtils";
import { TagUtils } from "shared/utils/TagUtils";
import type { DayCycleController } from "client/controller/DayCycleController";
import type { GameEnvironmentController } from "client/controller/GameEnvironmentController";
import type { PopupController } from "client/gui/PopupController";
import type { ToolController } from "client/tools/ToolController";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockPonder } from "shared/blocks/Block";

type Types = readonly (keyof BlockLogicTypes.Primitives)[];

type ConfigPanelDefinition = GuiObject & {
	readonly Header: TextLabel & {
		readonly Copy: GuiButton;
		readonly Paste: GuiButton;
		readonly Reset: GuiButton;
		readonly Quantity: TextLabel;
	};
	readonly Content: GuiObject & { readonly PreviewButton: GuiButton };
};
type CalloutDefinition = GuiObject & { readonly TextLabel: TextLabel };
type MarkerDefinition = GuiObject & { readonly White: GuiObject; readonly Filled: GuiObject };
type PonderDefinition = GuiObject & {
	readonly Overlay: GuiObject;
	readonly Header: GuiObject & {
		readonly Kicker: TextLabel;
		readonly Title: TextLabel;
		readonly Subtitle: TextLabel;
	};
	readonly Progress: GuiButton & {
		readonly Track: GuiObject & { readonly Filled: GuiObject };
	};
	readonly Buttons: GuiObject & {
		readonly ExitButton: TextButton;
		readonly RestartButton: TextButton;
		readonly PauseButton: TextButton & { readonly Icon: ImageLabel };
		readonly SpeedButton: TextButton;
	};
	readonly Templates: Folder & {
		readonly Highlight: GuiObject;
		readonly Callout: CalloutDefinition;
		readonly Line: GuiObject;
		readonly Dot: GuiObject;
		readonly Marker: MarkerDefinition;
	};
};

const template = Interface.getInterface<{ Popups: { Crossplatform: { Ponder: PonderDefinition } } }>().Popups
	.Crossplatform.Ponder;
template.Visible = false;

/** Far above the map, so the box shares the world with nothing */
const boxCenter = new CFrame(0, 20000, 0);
const boxSize = 160;
/** The speeds the speed button steps through, starting from normal */
const timescales: readonly number[] = [1, 2, 0.5];

/**
 * What one ponder step can show. Blocks, markers and wires stay until the ponder restarts; highlights and text last
 * only the step that shows them. Anything custom a step makes belongs to `step`, or to `ponder.scene` to outlive it.
 */
/** A wire tool marker on a ponder block: the same billboard, colours and hover label, connected by the ponder */
class PonderMarker extends MarkerWireVisualizer.Marker {
	constructor(
		instance: MarkerWireVisualizer.MarkerDefinition,
		kind: "output" | "input",
		name: string,
		types: Types,
		shownTypes: Types,
	) {
		super(instance);

		this.initTooltip(
			() => name,
			() => types,
		);
		this.colors.set(shownTypes.map(MarkerWireVisualizer.getTypeColor));
		instance.TextButton.White.Visible = kind === "input";
		instance.TextButton.Filled.Visible = false;
	}
}

export class PonderScope {
	constructor(
		readonly ponder: Ponder,
		readonly step: Component,
	) {}

	/** A block placed earlier in this run */
	model<T extends Model = Model>(uid: string): T {
		const model = this.ponder.blocks.get(uid);
		if (!model) throw `Unknown block ${uid}`;
		return model as T;
	}

	/**
	 * Where a placed block, or one of its parts, ends up once its placing animation finishes; read this instead of the
	 * model's own position, which moves while the animation plays
	 */
	at(uid: string, part?: BasePart): CFrame {
		const final = this.ponder.blockPivots.get(uid);
		if (!final) throw `Unknown block ${uid}`;
		if (!part) return final;

		return final.mul(this.model(uid).GetPivot().ToObjectSpace(part.CFrame));
	}

	/** Runs `func` now, or once the block's placing animation has put it in place */
	private whenPlaced(uid: string, func: () => void) {
		const waiting = this.ponder.settling.get(uid);
		if (waiting) waiting.push(func);
		else func();
	}

	/**
	 * Lets physics move the block, the way riding does: every part but those tagged to stay anchored is freed. It waits
	 * for the placing animation to finish. Physics runs in real time: pausing freezes it, but the speed button and a
	 * seek do not reach it, so a seek starts physical blocks from where they were placed.
	 */
	unanchor(uid: string): this {
		const model = this.model(uid);
		this.whenPlaced(uid, () => {
			PartUtils.applyToAllDescendantsOfType("BasePart", model, (part) => {
				if (part.HasTag(TagUtils.allTags.ANCHORED)) return;
				this.ponder.setPhysical(part);
			});
		});
		return this;
	}

	/** Welds two placed blocks together by their primary parts, so physics moves them as one */
	weld(uidA: string, uidB: string): this {
		const a = this.model(uidA).PrimaryPart!;
		const b = this.model(uidB).PrimaryPart!;
		Element.create("WeldConstraint", { Part0: a, Part1: b, Parent: a });
		return this;
	}

	/** Runs `func` on the ponder's clock until this step ends: it freezes while paused and is replayed by a seek */
	loop(func: (dt: number) => void): this {
		this.ponder.runner.loop(this.step, func);
		return this;
	}
	/** Like `loop`, but runs until the ponder restarts, across the steps after this one */
	sceneLoop(func: (dt: number) => void): this {
		this.ponder.runner.loop(this.ponder.scene, func);
		return this;
	}

	/**
	 * Places a block, arriving with `animation` (false places it at once, for a block a script moves itself). `config`
	 * is what its config shows, and wires added with {@link connectMarkers} join it.
	 */
	placeBlock(
		uid: string,
		id: BlockId,
		position: CFrame,
		config: PlacedBlockConfig = {},
		animation: PonderAnimation | false = PonderAnimation.drop,
	): this {
		const block = this.ponder.blockList.blocks[id];
		if (!block) throw `Unknown block ${id}`;

		const base = this.ponder.base;
		const model = block.model.Clone();
		model.Name = uid;
		for (const part of model.GetDescendants()) {
			if (part.IsA("BasePart")) part.Anchored = true;
		}
		// the primary part's half height once rotated, so a block on its side still rests on the floor
		const size = model.PrimaryPart!.Size;
		const halfHeight =
			(math.abs(position.XVector.Y) * size.X +
				math.abs(position.YVector.Y) * size.Y +
				math.abs(position.ZVector.Y) * size.Z) /
			2;
		const lift = base.Size.Y / 2 + halfHeight;
		model.PivotTo(
			base
				.GetPivot()
				.ToWorldSpace(position)
				.add(new Vector3(0, lift, 0)),
		);
		model.Parent = this.ponder.world;

		this.ponder.scene.onDestroy(() => model.Destroy());
		this.ponder.blocks.set(uid, model);
		this.ponder.blockIds.set(uid, id);
		this.ponder.blockPivots.set(uid, model.GetPivot());
		this.ponder.configs.set(uid, config);
		if (animation) {
			const waiting: (() => void)[] = [];
			this.ponder.settling.set(uid, waiting);
			PonderAnimation.play(this.ponder.runner, this.ponder.scene, model, animation, () => {
				this.ponder.settling.delete(uid);
				for (const func of waiting) func();
			});
		}
		return this;
	}

	/**
	 * A connector marker for the input or output `key`, where the wire tool would put it. It cycles the colours of
	 * every type the connector takes until a wire or `configType`, for a connector set by its config, settles it on one.
	 */
	createMarker(
		mid: string,
		uid: string,
		kind: "output" | "input",
		key: string,
		configType?: keyof BlockLogicTypes.Primitives,
	): this {
		const model = this.model(uid);
		const block = this.ponder.blockList.blocks[this.ponder.blockIds.get(uid)!]!;
		const definition = block.logic?.definition;
		if (!definition) throw `Block ${block.id} has no logic`;

		const connector = kind === "input" ? definition.input[key] : definition.output[key];
		const types: Types =
			kind === "input" ? asMap(definition.input[key].types).keys() : (definition.output[key].types as Types);

		const primary = model.PrimaryPart!;
		const offset = PonderScope.connectorOffsets(block).get(`${kind}:${key}`) ?? Vector3.zero;
		const final = this.at(uid, primary);
		const at = final.PointToWorldSpace(offset);

		const instance = MarkerWireVisualizer.Marker.createInstanceAt(
			primary,
			offset,
			Vector3.one,
			block.model.PrimaryPart!,
		);
		// placed by the block's final orientation, so the marker turns with the block and meets its wires
		instance.StudsOffsetWorldSpace = final.VectorToWorldSpace(offset);

		const marker = this.ponder.scene.parent(
			new PonderMarker(instance, kind, connector.displayName, types, configType ? [configType] : types),
		);
		this.ponder.markers.set(mid, { uid, key, marker, types, at });
		return this;
	}

	/**
	 * Every shown connector's offset from the block's primary part, resolved in definition order with one set of slot
	 * counters, the way the wire tool lays out one block's markers
	 */
	private static connectorOffsets(block: Block): ReadonlyMap<string, Vector3> {
		const result = new Map<string, Vector3>();
		const definition = block.logic?.definition;
		if (!definition) return result;

		const shown = (order: readonly string[] | undefined, defs: { readonly [k in string]?: object }) =>
			(order ?? asMap(defs).keys()).filter(
				(k) => !(defs[k] as { connectorHidden?: boolean } | undefined)?.connectorHidden,
			);
		const inputs = shown(definition.inputOrder, definition.input);
		const outputs = shown(definition.outputOrder, definition.output);
		const count = inputs.size() + outputs.size();
		const slots = MarkerWireVisualizer.newConnectorSlots();
		const faces = MarkerWireVisualizer.Marker.getPartMarkerPositions(block.model.PrimaryPart!);

		const resolve = (kind: "input" | "output", key: string) => {
			const offset = MarkerWireVisualizer.resolveConnectorOffset(
				block.markerPositions,
				definition,
				key,
				kind,
				count,
				slots,
			);
			result.set(
				`${kind}:${key}`,
				offset === "center" ? Vector3.zero : typeIs(offset, "number") ? faces[offset] : offset,
			);
		};
		for (const key of inputs) resolve("input", key);
		for (const key of outputs) resolve("output", key);

		return result;
	}

	connectMarkers(idOutput: string, idInput: string): this {
		const output = this.ponder.markers.get(idOutput);
		if (!output) throw `Unknown marker ${idOutput}`;
		const input = this.ponder.markers.get(idInput);
		if (!input) throw `Unknown marker ${idInput}`;

		const wireType = output.types.find((t) => input.types.includes(t)) ?? output.types[0];
		const wireColor = MarkerWireVisualizer.getTypeColor(wireType);
		output.marker.colors.set([wireColor]);
		input.marker.colors.set([wireColor]);
		input.marker.instance.TextButton.Filled.Visible = true;

		const wired: PlacedBlockConfig[string] = {
			type: "wire",
			config: {
				blockUuid: output.uid as BlockUuid,
				connectionName: output.key as BlockConnectionName,
				prevConfig: this.ponder.configs.get(input.uid)?.[input.key],
			},
		};
		this.ponder.configs.set(input.uid, { ...this.ponder.configs.get(input.uid), [input.key]: wired });

		// the wire tool's own wire, at its thickness for an unscaled marker
		const wire = this.ponder.scene.parent(MarkerWireVisualizer.Wire.create(0.15, output.at, input.at));
		wire.colors.set([wireColor]);
		return this;
	}

	/** A box around the block, with `text` beside it; a logic block also shows its config for the step */
	highlightBlock(uid: string, text?: string): this {
		const block = this.ponder.blocks.get(uid);
		if (!block) throw `Unknown block ${uid}`;

		this.ponder.showConfig(uid);
		this.step.onDestroy(() => {
			if (this.ponder.configShown() === uid) this.ponder.showConfig(undefined);
		});

		const templates = this.ponder.instance.Templates;
		const box = this.stepClone(templates.Highlight);
		const callout = text !== undefined ? this.stepClone(templates.Callout) : undefined;
		const line = callout && this.stepClone(templates.Line);
		if (callout) callout.TextLabel.Text = text!;

		this.ponder.onFrame(this.step, () => {
			const bounds = this.ponder.bounds(block);
			const shown = bounds !== undefined;
			box.Visible = shown;
			if (callout) callout.Visible = shown;
			if (line) line.Visible = shown;
			if (!bounds) return;

			const pad = 6;
			box.Position = UDim2.fromOffset(bounds.min.X - pad, bounds.min.Y - pad);
			box.Size = UDim2.fromOffset(bounds.max.X - bounds.min.X + pad * 2, bounds.max.Y - bounds.min.Y + pad * 2);
			if (!callout || !line) return;

			const corner = new Vector2(bounds.max.X + pad, bounds.min.Y - pad);
			const anchor = corner.add(new Vector2(56, -40));
			callout.AnchorPoint = new Vector2(0, 0.5);
			callout.Position = UDim2.fromOffset(anchor.X, anchor.Y);
			Ponder.setLine(line, corner, anchor);
		});

		return this;
	}

	/**
	 * A text box. A `Vector3` points at that spot in the scene, relative to the floor;
	 * a `Vector2` places it at that fraction of the screen; neither puts it under the header.
	 */
	text(text: string, at?: Vector3 | Vector2): this {
		const templates = this.ponder.instance.Templates;
		const callout = this.stepClone(templates.Callout);
		callout.TextLabel.Text = text;

		if (!typeIs(at, "Vector3")) {
			callout.AnchorPoint = new Vector2(0.5, 0.5);
			callout.Position = at ? UDim2.fromScale(at.X, at.Y) : UDim2.fromScale(0.5, 0.25);
			callout.Visible = true;
			return this;
		}

		const line = this.stepClone(templates.Line);
		const dot = this.stepClone(templates.Dot);
		const world = this.ponder.base.GetPivot().PointToWorldSpace(at);

		this.ponder.onFrame(this.step, () => {
			const point = this.ponder.project(world);
			callout.Visible = point !== undefined;
			line.Visible = point !== undefined;
			dot.Visible = point !== undefined;
			if (!point) return;

			const anchor = point.add(new Vector2(64, -64));
			dot.Position = UDim2.fromOffset(point.X, point.Y);
			callout.AnchorPoint = new Vector2(0, 0.5);
			callout.Position = UDim2.fromOffset(anchor.X, anchor.Y);
			Ponder.setLine(line, point, anchor);
		});

		return this;
	}

	private stepClone<T extends GuiObject>(object: T): T {
		const clone = this.ponder.overlayClone(object);
		this.step.onDestroy(() => clone.Destroy());
		return clone;
	}
}

export class PonderBuilder {
	/** Each step's length in seconds by its 0-based index; a step that ends on a condition has none */
	readonly durations = new Map<number, number>();

	constructor(private readonly ponder: Ponder) {}

	setTitle(title: string, subtitle = ""): this {
		this.ponder.instance.Header.Title.Text = title;
		this.ponder.instance.Header.Subtitle.Text = subtitle;
		return this;
	}

	setPlotSize(studs: number): this {
		this.ponder.base.Size = new Vector3(studs, this.ponder.base.Size.Y, studs);
		this.ponder.fitFloorCollider();
		return this;
	}

	/** A step that runs `begin` as it starts, and ends after `done` seconds or once `done` returns true */
	step(done: number | ((elapsed: number) => boolean), begin: (scope: PonderScope) => void): this {
		if (typeIs(done, "number")) this.durations.set(this.ponder.runner.count(), done);
		this.ponder.runner.add({
			begin: (scope) => begin(new PonderScope(this.ponder, scope)),
			done: typeIs(done, "number") ? (elapsed) => elapsed >= done : done,
		});

		return this;
	}
}

/** A timed demonstration of blocks, markers and wires in a turnable scene, shown as a popup */
export class Ponder extends Control<PonderDefinition> {
	/** Opens the block's ponder as the only popup; nothing happens for a block without one */
	static open(block: Block, blockList: BlockList, popupController: PopupController): Ponder | undefined {
		const build = block.ponder;
		if (!build) return;

		return Ponder.openBuilt(build, blockList, popupController);
	}

	/** Builds a ponder with `build` and opens it as the only popup */
	static openBuilt(build: BlockPonder, blockList: BlockList, popupController: PopupController): Ponder {
		const ponder = new Ponder(blockList);
		build(ponder.builder);
		popupController.showExclusivePopup(ponder, false);
		return ponder;
	}

	static setLine(line: GuiObject, from: Vector2, to: Vector2) {
		const delta = to.sub(from);
		const middle = from.add(delta.div(2));
		line.Position = UDim2.fromOffset(middle.X, middle.Y);
		line.Size = UDim2.fromOffset(delta.Magnitude, line.Size.Y.Offset);
		line.Rotation = math.deg(math.atan2(delta.Y, delta.X));
	}

	/** A closed room of black walls, so nothing of the map shows behind the scene */
	private static createBox(): Model {
		const box = Element.create("Model", { Name: "PonderBox" });
		const half = boxSize / 2;
		const wall = (offset: Vector3, size: Vector3) =>
			Element.create("Part", {
				Anchored: true,
				CanCollide: false,
				CanQuery: false,
				CanTouch: false,
				CastShadow: false,
				Material: Enum.Material.SmoothPlastic,
				Color: Color3.fromRGB(10, 10, 12),
				Size: size,
				CFrame: boxCenter.add(offset),
				Parent: box,
			});

		wall(new Vector3(0, half, 0), new Vector3(boxSize, 1, boxSize));
		// the bottom catches anything physics drops off the plot
		wall(new Vector3(0, -half, 0), new Vector3(boxSize, 1, boxSize)).CanCollide = true;
		wall(new Vector3(half, 0, 0), new Vector3(1, boxSize, boxSize));
		wall(new Vector3(-half, 0, 0), new Vector3(1, boxSize, boxSize));
		wall(new Vector3(0, 0, half), new Vector3(boxSize, boxSize, 1));
		wall(new Vector3(0, 0, -half), new Vector3(boxSize, boxSize, 1));

		const lamp = wall(new Vector3(0, half * 0.6, 0), Vector3.one);
		lamp.Transparency = 1;
		Element.create("PointLight", { Brightness: 0.5, Range: boxSize, Shadows: false, Parent: lamp });

		ServiceIntegrityChecker.whitelistInstance(box);
		box.Parent = Workspace;
		return box;
	}

	readonly builder: PonderBuilder;
	readonly runner = this.parent(new SceneRunner(true));
	readonly isPaused = new ObservableValue(false);
	/** How fast the ponder's clock runs against real time; the speed button steps through {@link timescales} */
	readonly timescale = new ObservableValue(1);
	readonly base: BasePart;
	/** Thick and unseen under the floor, so a part physics drives into the thin floor is stopped instead of passing through */
	private readonly floorCollider: Part;
	/** The black box the scene is built in, local to this client */
	readonly world: Model;
	/** Owns what stays across steps; replaced on every restart */
	scene = new Component();
	readonly blocks = new Map<string, Model>();
	readonly blockIds = new Map<string, BlockId>();
	/** Each block's placement once its placing animation has finished */
	readonly blockPivots = new Map<string, CFrame>();
	/** What waits on each block whose placing animation is still playing */
	readonly settling = new Map<string, (() => void)[]>();
	/** Parts physics moves, with the velocities they had when the ponder was paused */
	private readonly physical = new Map<BasePart, { linear: Vector3; angular: Vector3 }>();
	readonly configs = new Map<string, PlacedBlockConfig>();
	readonly markers = new Map<
		string,
		{
			readonly uid: string;
			readonly key: string;
			readonly marker: PonderMarker;
			readonly types: Types;
			/** Where the marker sits once its block's placing animation finishes */
			readonly at: Vector3;
		}
	>();
	private readonly frameFuncs = new Set<() => void>();
	private readonly configPanel: ConfigPanelDefinition;
	private readonly configList: ScrollingFrame;
	private readonly configControl = this.parent(new ComponentChild<MultiBlockConfigControl>(true));
	private shownConfig?: string;
	private di?: DIContainer;
	private readonly camera = Workspace.CurrentCamera!;
	private yaw = math.rad(145);
	private pitch = math.rad(30);

	constructor(readonly blockList: BlockList) {
		const gui = template.Clone();
		super(gui);

		this.world = Ponder.createBox();
		this.onDestroy(() => this.world.Destroy());

		const floor = ReplicatedStorage.Assets.WaitForChild("Ponders").WaitForChild("Floor") as BasePart;
		this.base = floor.Clone();
		this.base.Anchored = true;
		this.base.PivotTo(boxCenter);
		this.base.Parent = this.world;

		this.floorCollider = Element.create("Part", {
			Name: "FloorCollider",
			Anchored: true,
			CanQuery: false,
			CanTouch: false,
			CastShadow: false,
			Transparency: 1,
			Parent: this.world,
		});
		this.fitFloorCollider();

		const camera = this.camera;
		const cameraType = camera.CameraType;
		const fieldOfView = camera.FieldOfView;
		camera.CameraType = Enum.CameraType.Scriptable;
		camera.FieldOfView = 35;
		this.onDestroy(() => {
			camera.CameraType = cameraType;
			camera.FieldOfView = fieldOfView;
			camera.CameraSubject = LocalPlayer.humanoid.get();
		});

		const configPanel = this.createConfigPanel();
		this.configPanel = configPanel.panel;
		this.configList = configPanel.list;

		this.onInject((di) => {
			this.di = di;
			const dayCycle = di.resolve<DayCycleController>();
			dayCycle.disable();
			Lighting.ClockTime = 14;
			this.onDestroy(() => dayCycle.enable());

			// physics in the scene runs the same for every player, whatever their gravity setting or height
			const environment = di.resolve<GameEnvironmentController>();
			environment.disable();
			Workspace.Gravity = GameEnvironment.EarthGravity;
			Workspace.AirDensity = GameEnvironment.EarthAirDensity;
			Workspace.GlobalWind = Vector3.zero;
			this.onDestroy(() => environment.enable());

			const tools = di.resolve<ToolController>();
			const tool = tools.selectedTool.get();
			tools.selectedTool.set(undefined);
			// tool keybinds stay live behind a popup
			this.event.subscribeObservable(tools.selectedTool, (selected) => {
				if (selected) tools.selectedTool.set(undefined);
			});
			this.onDestroy(() => {
				if (tool && tools.tools.has(tool) && !tools.selectedTool.get()) tools.selectedTool.set(tool);
			});
		});

		const guis = [Interface.getInterface(), Interface.getUnscaled()];
		const guisEnabled = guis.map((gui) => gui.Enabled);
		const windowsVisible = FloatingWindow.interfaceVisible.get();
		const touchVisible = touchButtonsVisible.get();
		for (const gui of guis) gui.Enabled = false;
		FloatingWindow.interfaceVisible.set(false);
		touchButtonsVisible.set(false);
		this.onDestroy(() => {
			guis.forEach((gui, i) => (gui.Enabled = guisEnabled[i]));
			FloatingWindow.interfaceVisible.set(windowsVisible);
			touchButtonsVisible.set(touchVisible);
		});

		const header = this.instance.Header;
		const headerPosition = header.Position;
		this.onEnable(() => {
			const [inset] = GuiService.GetGuiInset();
			header.Position = headerPosition.add(UDim2.fromOffset(0, inset.Y / this.scale()));
		});

		this.builder = new PonderBuilder(this);
		this.initButtons();
		this.initCameraDrag();
		this.initBlockClicks();
		this.initPhysicsPause();

		// steps are added after construction, so the first run starts once the popup is shown
		let started = false;
		this.onEnable(() => {
			if (started) return;
			started = true;
			this.restart();
		});

		const track = this.instance.Progress.Track;
		this.initProgress(track);
		this.event.subscribe(RunService.RenderStepped, (dt) => {
			this.updateCamera();

			if (!this.isPaused.get()) {
				this.runner.advance(dt * this.timescale.get());
				if (this.runner.isFinished()) this.isPaused.set(true);
			}

			for (const func of this.frameFuncs) func();
			track.Filled.Size = UDim2.fromScale(this.progress(), 1);
		});
	}

	/** Sizes the floor collider to the floor, with its top flush with the floor's */
	fitFloorCollider() {
		const thickness = 4;
		const top = this.base.Position.Y + this.base.Size.Y / 2;
		this.floorCollider.Size = new Vector3(this.base.Size.X, thickness, this.base.Size.Z);
		this.floorCollider.CFrame = new CFrame(this.base.Position.X, top - thickness / 2, this.base.Position.Z);
	}

	/** Hands `part` to physics, or holds it still with no velocity while the ponder is paused */
	setPhysical(part: BasePart) {
		this.physical.set(part, { linear: Vector3.zero, angular: Vector3.zero });
		part.Anchored = this.isPaused.get();
	}

	/** Holds every physical part still while paused, and lets each go with the velocity it had once playing again */
	private initPhysicsPause() {
		// anchoring one part stops its whole welded assembly, so every velocity is read before any part is anchored,
		// and every part freed before any velocity is given back
		this.event.subscribeObservable(this.isPaused, (paused) => {
			const parts: BasePart[] = [];
			for (const [part] of this.physical) {
				if (part.Parent !== undefined) parts.push(part);
			}

			if (paused) {
				for (const part of parts) {
					this.physical.set(part, {
						linear: part.AssemblyLinearVelocity,
						angular: part.AssemblyAngularVelocity,
					});
				}
				for (const part of parts) part.Anchored = true;
				return;
			}

			for (const part of parts) part.Anchored = false;
			for (const part of parts) {
				const motion = this.physical.get(part)!;
				part.AssemblyLinearVelocity = motion.linear;
				part.AssemblyAngularVelocity = motion.angular;
			}
		});
	}

	/** Runs `func` every frame after the camera moves, until `scope` is destroyed */
	onFrame(scope: Component, func: () => void) {
		this.frameFuncs.add(func);
		scope.onDestroy(() => this.frameFuncs.delete(func));
	}

	/**
	 * A copy of the config tool's panel, for showing a ponder block's config. It is read only: its edit buttons are
	 * hidden, every control in it is locked as it appears (see {@link lockControl}), and nothing listens to what its
	 * controls submit.
	 */
	private createConfigPanel(): { readonly panel: ConfigPanelDefinition; readonly list: ScrollingFrame } {
		const panel = Interface.getInterface<{
			Main: { Left: { Config: ConfigPanelDefinition } };
		}>().Main.Left.Config.Clone();
		panel.Visible = false;
		panel.AnchorPoint = new Vector2(0, 0.5);
		panel.Position = new UDim2(0, 20, 0.5, 0);
		panel.Size = new UDim2(0, 380, 0.5, 0);
		panel.Header.Copy.Visible = false;
		panel.Header.Paste.Visible = false;
		panel.Header.Reset.Visible = false;
		panel.Header.Quantity.Visible = false;
		panel.Content.PreviewButton.Visible = false;

		// the config tool leaves its filled copies of the list beside the original, so one is kept and emptied
		const lists = panel.Content.GetChildren().filter((c): c is ScrollingFrame => c.IsA("ScrollingFrame"));
		const list = lists[0];
		for (const other of lists) {
			if (other !== list) other.Destroy();
		}
		for (const child of list.GetChildren()) {
			if (child.IsA("GuiObject") && child.Name !== "Template" && child.Name !== "Container") child.Destroy();
		}
		list.Visible = false;

		panel.Parent = this.instance;
		return { panel, list };
	}

	/** A button that cannot be pressed and a text box that cannot be typed into; the list still scrolls */
	private static lockControl(this: void, instance: Instance) {
		if (instance.IsA("GuiButton")) instance.Interactable = false;
		if (instance.IsA("TextBox")) {
			instance.TextEditable = false;
			instance.Interactable = false;
		}
	}

	/** Which block's config is shown, if any */
	configShown(): string | undefined {
		return this.shownConfig;
	}

	/** Shows the config of the block `uid`, or hides the panel; a block without inputs hides it too */
	showConfig(uid: string | undefined) {
		this.configControl.clear();
		this.shownConfig = undefined;
		this.configPanel.Visible = false;
		if (uid === undefined || !this.di) return;

		const block = this.blockList.blocks[this.blockIds.get(uid) ?? ""];
		const definition = block?.logic?.definition;
		if (!block || !definition || asMap(definition.input).size() === 0) return;

		const list = this.configList.Clone();
		list.Visible = true;
		list.Parent = this.configPanel.Content;

		const config = BlockConfig.addDefaults(this.configs.get(uid) ?? {}, definition.input);
		const control = this.configControl.set(
			this.di.resolveForeignClass(MultiBlockConfigControl, [
				list,
				definition.input,
				{ [uid]: config },
				definition.inputOrder,
				new Map(),
			]),
		);
		for (const child of list.GetDescendants()) Ponder.lockControl(child);
		control.event.subscribe(list.DescendantAdded, Ponder.lockControl);

		this.configPanel.Header.Text = block.displayName.upper();
		this.shownConfig = uid;
		this.configPanel.Visible = true;
	}

	/** A click on a block in the scene shows its config, and a click on nothing hides it; a drag does neither */
	private initBlockClicks() {
		const params = new RaycastParams();
		params.FilterType = Enum.RaycastFilterType.Include;
		params.FilterDescendantsInstances = [this.world];

		let pressedAt: Vector3 | undefined;
		this.event.subscribe(this.instance.Overlay.InputBegan, (input) => {
			const inputType = input.UserInputType;
			if (inputType !== Enum.UserInputType.MouseButton1 && inputType !== Enum.UserInputType.Touch) return;

			// the overlay hears presses meant for the panel and the buttons drawn over it too; GetGuiObjectsAtPosition
			// counts from the top of the window, input positions from below the top bar inset
			const [inset] = GuiService.GetGuiInset();
			const playerGui = LocalPlayer.player.WaitForChild("PlayerGui") as PlayerGui;
			const under = playerGui.GetGuiObjectsAtPosition(input.Position.X, input.Position.Y + inset.Y);
			const onGui = under.some(
				(gui) =>
					gui.IsA("GuiButton") ||
					(this.configPanel.Visible && (gui === this.configPanel || gui.IsDescendantOf(this.configPanel))),
			);
			pressedAt = onGui ? undefined : input.Position;
		});
		this.event.subscribe(UserInputService.InputEnded, (input) => {
			const inputType = input.UserInputType;
			if (inputType !== Enum.UserInputType.MouseButton1 && inputType !== Enum.UserInputType.Touch) return;
			if (!pressedAt) return;

			const moved = input.Position.sub(pressedAt).Magnitude;
			pressedAt = undefined;
			if (moved > 6) return;

			const ray = this.camera.ScreenPointToRay(input.Position.X, input.Position.Y);
			const hit = Workspace.Raycast(ray.Origin, ray.Direction.mul(1000), params);
			const clicked = hit && this.blocks.findKey((_, model) => hit.Instance.IsDescendantOf(model));
			this.showConfig(clicked);
		});
	}

	/** Clears the scene and starts again from the first step */
	restart() {
		this.scene.destroy();
		this.blocks.clear();
		this.markers.clear();
		this.blockIds.clear();
		this.blockPivots.clear();
		this.settling.clear();
		this.physical.clear();
		this.configs.clear();
		this.showConfig(undefined);
		this.scene = this.parent(new Component());
		this.runner.restart();
	}

	/** How far through the steps the ponder is, from 0 to 1; a step that ends on a condition counts once it ends */
	private progress(): number {
		const count = this.runner.count();
		if (count === 0 || this.runner.isFinished()) return 1;

		const index = this.runner.current.get() - 1;
		const duration = this.builder.durations.get(index);
		const within = duration !== undefined ? math.min(this.runner.stepElapsed() / math.max(duration, 1e-3), 1) : 0;
		return (index + within) / count;
	}

	/** Replays the steps from the start, without rendering, up to `fraction` of the way through */
	private seek(fraction: number) {
		const count = this.runner.count();
		const target = math.clamp(fraction, 0, 1) * count;
		const index = math.min(math.floor(target), count - 1);

		this.restart();
		// a step that ends on a condition is given up to a minute of simulated time to end
		for (let i = 0; i < 1800 * count && this.runner.current.get() - 1 < index && !this.runner.isFinished(); i++) {
			this.runner.advance(1 / 30);
		}

		const duration = this.builder.durations.get(index);
		if (duration !== undefined) this.runner.advance((target - index) * duration);
	}

	private initButtons() {
		const buttons = this.instance.Buttons;

		this.parent(new Control(buttons.ExitButton)) //
			.addButtonAction(() => this.hideThenDestroy());
		this.parent(new Control(buttons.RestartButton)) //
			.addButtonAction(() => {
				this.restart();
				this.isPaused.set(false);
			});
		this.parent(new Control(buttons.PauseButton)) //
			.addButtonAction(() => {
				if (this.isPaused.get() && this.runner.isFinished()) this.restart();
				this.isPaused.toggle();
			});
		this.event.subscribeObservable(
			this.isPaused,
			(paused) => {
				buttons.PauseButton.Text = paused ? "►" : "";
				buttons.PauseButton.Icon.Visible = !paused;
			},
			true,
		);

		this.parent(new Control(buttons.SpeedButton)) //
			.addButtonAction(() => {
				const index = timescales.indexOf(this.timescale.get());
				this.timescale.set(timescales[(index + 1) % timescales.size()]);
			});
		this.event.subscribeObservable(this.timescale, (scale) => (buttons.SpeedButton.Text = `${scale}x`), true);
	}

	private initProgress(track: GuiObject) {
		const progress = this.instance.Progress;

		let seeking = false;
		const seek = (x: number) => this.seek((x - track.AbsolutePosition.X) / track.AbsoluteSize.X);

		this.event.subscribe(progress.InputBegan, (input) => {
			const inputType = input.UserInputType;
			if (inputType !== Enum.UserInputType.MouseButton1 && inputType !== Enum.UserInputType.Touch) return;

			seeking = true;
			seek(input.Position.X);
		});
		this.event.subscribe(UserInputService.InputChanged, (input) => {
			if (!seeking) return;
			const inputType = input.UserInputType;
			if (inputType !== Enum.UserInputType.MouseMovement && inputType !== Enum.UserInputType.Touch) return;

			seek(input.Position.X);
		});
		this.event.subscribe(UserInputService.InputEnded, (input) => {
			const inputType = input.UserInputType;
			if (inputType === Enum.UserInputType.MouseButton1 || inputType === Enum.UserInputType.Touch)
				seeking = false;
		});
	}

	private initCameraDrag() {
		let last: Vector3 | undefined;

		this.event.subscribe(this.instance.Overlay.InputBegan, (input) => {
			const inputType = input.UserInputType;
			if (inputType !== Enum.UserInputType.MouseButton2 && inputType !== Enum.UserInputType.Touch) return;
			last = input.Position;
		});
		this.event.subscribe(UserInputService.InputChanged, (input) => {
			if (!last) return;
			const inputType = input.UserInputType;
			if (inputType !== Enum.UserInputType.MouseMovement && inputType !== Enum.UserInputType.Touch) return;

			const delta = input.Position.sub(last);
			last = input.Position;
			this.yaw -= delta.X * 0.008;
			this.pitch = math.clamp(this.pitch + delta.Y * 0.006, math.rad(5), math.rad(80));
		});
		this.event.subscribe(UserInputService.InputEnded, (input) => {
			const inputType = input.UserInputType;
			if (inputType === Enum.UserInputType.MouseButton2 || inputType === Enum.UserInputType.Touch)
				last = undefined;
		});
	}

	private updateCamera() {
		const size = this.base.Size;
		const distance = math.max(size.X, size.Z) * 2.3 + 4;
		const focus = this.base.Position.add(new Vector3(0, 1, 0));

		this.camera.CFrame = new CFrame(focus)
			.mul(CFrame.Angles(0, this.yaw, 0))
			.mul(CFrame.Angles(-this.pitch, 0, 0))
			.mul(new CFrame(0, 0, distance));
	}

	/** Clones a template into the overlay, hidden until its step shows it */
	overlayClone<T extends GuiObject>(object: T): T {
		const clone = object.Clone();
		clone.Visible = false;
		clone.Parent = this.instance.Overlay;
		return clone;
	}

	/** The popup's UIScale, so absolute pixels can be turned back into the overlay's offsets */
	private scale(): number {
		const screen = this.instance.FindFirstAncestorOfClass("ScreenGui");
		return screen?.FindFirstChildOfClass("UIScale")?.Scale ?? 1;
	}

	/** Overlay offset of a world point, or nothing when it is behind the camera */
	project(world: Vector3): Vector2 | undefined {
		const [point] = this.camera.WorldToViewportPoint(world);
		if (point.Z <= 0) return;

		// viewport points start at the top of the window, GUI absolute positions below the top bar inset
		const [inset] = GuiService.GetGuiInset();
		const origin = this.instance.Overlay.AbsolutePosition.add(inset);
		return new Vector2(point.X - origin.X, point.Y - origin.Y).div(this.scale());
	}

	placeAt(gui: GuiObject, world: Vector3) {
		const point = this.project(world);
		gui.Visible = point !== undefined;
		if (point) gui.Position = UDim2.fromOffset(point.X, point.Y);
	}

	/** Overlay bounds of every corner of the model's parts */
	bounds(model: Model): { readonly min: Vector2; readonly max: Vector2 } | undefined {
		let min = new Vector2(math.huge, math.huge);
		let max = new Vector2(-math.huge, -math.huge);
		let any = false;

		for (const part of model.GetDescendants()) {
			if (!part.IsA("BasePart") || part.Transparency >= 1) continue;

			const half = part.Size.div(2);
			for (const x of [-1, 1]) {
				for (const y of [-1, 1]) {
					for (const z of [-1, 1]) {
						const point = this.project(
							part.CFrame.PointToWorldSpace(new Vector3(half.X * x, half.Y * y, half.Z * z)),
						);
						if (!point) continue;

						min = min.Min(point);
						max = max.Max(point);
						any = true;
					}
				}
			}
		}

		if (!any) return;
		return { min, max };
	}
}
