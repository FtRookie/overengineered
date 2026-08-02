import { UserInputService } from "@rbxts/services";
import { showColorChooser } from "client/gui/ColorChooserPopup";
import { FloatingWindow } from "client/gui/FloatingWindow";
import { CHANNEL_COLORS, GraphSeriesRenderer, prettyAxis } from "client/gui/graph/GraphSeriesRenderer";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { initDragging } from "engine/client/gui/Draggable";
import { Interface } from "engine/client/gui/Interface";
import { initResizing } from "engine/client/gui/Resizable";
import { Component } from "engine/shared/component/Component";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { SubmittableValue } from "engine/shared/event/SubmittableValue";
import type { FloatingWindowDefinition } from "client/gui/FloatingWindow";
import type { GraphOutputPicker, PickedOutput } from "client/gui/graph/GraphOutputPicker";
import type {
	GraphAxisConfig,
	GraphGroup,
	GraphSessionStore,
	RecordedOutput,
} from "client/gui/graph/GraphSessionStore";
import type { PopupController } from "client/gui/PopupController";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

const VISIBLE_ICON = "rbxassetid://13321848320";
const HIDDEN_ICON = "rbxassetid://125716871945612";

const MIN_SIZE = new Vector2(300, 220);
/** Offset per window so a new one is grabbable rather than buried under the last. */
const CASCADE = 20;
const CASCADE_WRAP = 10;
/** Redraw rate. Sampling runs at the logic tick; repainting that often would be wasted on a pixel-capped plot. */
const REDRAW = 1 / 30;

type SeriesRowDefinition = GuiObject & {
	readonly Frame: GuiObject & {
		readonly Label: TextLabel;
		readonly Frame: GuiObject & { readonly Color: TextButton };
	};
	readonly Visibility: ImageButton;
	readonly Delete: GuiButton;
};
type GridLineDefinition = Frame & { readonly Label: TextLabel };
type GraphWindowDefinition = FloatingWindowDefinition & {
	readonly Title: GuiObject & {
		readonly TextLabel: TextLabel;
		readonly Visibility: ImageButton;
	};
	readonly Content: GuiObject & {
		readonly Plot: GuiObject & {
			readonly DataPoints: GuiObject & {
				readonly Point: Frame;
				readonly Segment: Frame;
				readonly Sentinel: Frame;
			};
			readonly XMinLabel: TextBox;
			readonly XMaxLabel: TextBox;
			readonly YMinLabel: TextBox;
			readonly YMaxLabel: TextBox;
			readonly Status: TextLabel;
			readonly GridLinesX: GuiObject & {
				readonly Template: GridLineDefinition;
				readonly Cursor: Frame & { readonly Intercept: TextLabel };
			};
			readonly GridLinesY: GuiObject & { readonly Template: GridLineDefinition };
		};
		readonly Config: GuiObject & {
			readonly Parameters: GuiObject & {
				readonly YMode: TextButton;
				readonly XMode: TextButton;
				readonly LinesEnabled: TextButton;
				readonly GridEnabled: TextButton;
			};
			readonly Series: GuiObject & { readonly Template: SeriesRowDefinition };
			readonly SetValue: GuiObject & {
				readonly SetY: TextButton;
				readonly SetX: TextButton;
				readonly Window: TextBox;
			};
		};
	};
};

class SeriesRow extends Control<SeriesRowDefinition> {
	constructor(
		gui: SeriesRowDefinition,
		output: RecordedOutput,
		channel: number,
		channels: number,
		remove: () => void,
	) {
		super(gui);

		const label =
			channels === 1 ? output.name : `${output.name} · ${("XYZ" as string).sub(channel + 1, channel + 1)}`;
		// The samples stay readable after the block is gone, so the row says so rather than disappearing.
		gui.Frame.Label.Text = output.unbound ? `${label} (unbound)` : label;
		const swatch = gui.Frame.Frame.Color;
		const initial = output.colors[channel] ?? CHANNEL_COLORS[channel];
		swatch.BackgroundColor3 = initial;

		// One value per row rather than one per click, so the subscription is not re-added every time it opens.
		// Written on change rather than on submit, so the trace recolours while the chooser is still open.
		const picked = new SubmittableValue(new ObservableValue<Color4>({ alpha: 1, color: initial }));
		this.event.subscribe(picked.value.changed, (c) => {
			output.colors[channel] = c.color;
			swatch.BackgroundColor3 = c.color;
		});

		this.$onInjectAuto((popupController: PopupController) => {
			this.parent(new Control(swatch)) //
				.addButtonAction(() => showColorChooser(popupController, swatch, picked, false));
		});

		let shown = true;
		const refresh = () => (gui.Visibility.Image = shown ? VISIBLE_ICON : HIDDEN_ICON);
		refresh();

		this.parent(
			new ButtonControl(gui.Visibility, () => {
				shown = !shown;
				refresh();
			}),
		);
		this.parent(new ButtonControl(gui.Delete, remove));
	}
}

/**
 * One graph. Lives for the session rather than for a ride: the buffers it draws belong to the store, so leaving
 * ride mode freezes the trace rather than clearing it.
 */
export class GraphWindow extends Component {
	constructor(
		store: GraphSessionStore,
		group: GraphGroup,
		picker: GraphOutputPicker,
		managerVisible: ReadonlyObservableValue<boolean>,
	) {
		super();

		const source = Interface.getInterface<{ Floating: { Graph: GraphWindowDefinition } }>().Floating.Graph;
		const gui = source.Clone();
		gui.Parent = source.Parent;

		this.parent(FloatingWindow.create(gui));
		initDragging(this.event, gui.Title, gui);
		// No top grab: the title bar lives there, and a shared band makes drag and resize fight over one press.
		initResizing(this.event, gui, { min: MIN_SIZE, edges: { top: false } });

		// Cascade, so a second window does not land exactly on the first.
		const step = (group.spawnIndex % CASCADE_WRAP) * CASCADE;
		gui.Position = new UDim2(
			gui.Position.X.Scale,
			gui.Position.X.Offset + step,
			gui.Position.Y.Scale,
			gui.Position.Y.Offset + step,
		);

		const plot = gui.Content.Plot;
		const config = gui.Content.Config;
		const params = config.Parameters;

		const renderer = this.parent(
			new GraphSeriesRenderer(
				plot.DataPoints,
				this.asTemplate(plot.DataPoints.Point),
				this.asTemplate(plot.DataPoints.Segment),
				this.asTemplate(plot.DataPoints.Sentinel),
				{
					x: plot.GridLinesX,
					y: plot.GridLinesY,
					xTemplate: this.asTemplate(plot.GridLinesX.Template),
					yTemplate: this.asTemplate(plot.GridLinesY.Template),
					cursorTemplate: this.asTemplate(plot.GridLinesX.Cursor),
				},
			),
		);

		this.$onInjectAuto((playerData: PlayerDataStorage) => {
			this.event.subscribeObservable(
				playerData.config,
				(settings) => {
					renderer.setPointSize(settings.interface.graphing.pointSize);
					renderer.setSegmentThickness(settings.interface.graphing.segmentThickness);
				},
				true,
				true,
			);
		});

		gui.Title.TextLabel.Text = group.name;

		/**
		 * Only the frame is hidden, never the component: `setVisibleAndEnabled` would disable this and tear down
		 * every subscription, leaving the window deaf to the manager row that has to bring it back.
		 *
		 * Closing the manager hides every graph without touching each group's own flag, so reopening it restores
		 * exactly the ones that were on screen.
		 */
		const refreshVisibility = () => {
			gui.Title.Visibility.Image = group.visible.get() ? VISIBLE_ICON : HIDDEN_ICON;
			gui.Visible = group.visible.get() && managerVisible.get();
		};
		this.event.subscribeObservable(group.visible, refreshVisibility, true, true);
		this.event.subscribeObservable(managerVisible, refreshVisibility, true, true);

		this.parent(new ButtonControl(gui.Title.Visibility, () => group.visible.set(false)));

		// Pinning both ends leaves the mode with nothing to derive, so the button reports that rather than a mode
		// that no longer applies. The underlying mode is still toggleable, and resumes as soon as a pin is cleared.
		const modeLabel = (axis: GraphAxisConfig) =>
			axis.min !== undefined && axis.max !== undefined
				? "Manual"
				: axis.mode === "autofit"
					? "Auto-fit"
					: "Expanding";
		const bindMode = (button: TextButton, axis: GraphAxisConfig, prefix: string) => {
			const refresh = () => (button.Text = `${prefix} ${modeLabel(axis)}`);
			refresh();

			this.parent(
				new ButtonControl(button, () => {
					axis.mode = axis.mode === "autofit" ? "expanding" : "autofit";
					refresh();
				}),
			);

			return refresh;
		};
		const refreshYMode = bindMode(params.YMode, group.yAxis, "Y:");
		const refreshXMode = bindMode(params.XMode, group.xAxis, "X:");

		this.bindBound(plot.YMinLabel, group.yAxis, "min", refreshYMode);
		this.bindBound(plot.YMaxLabel, group.yAxis, "max", refreshYMode);
		this.bindBound(plot.XMinLabel, group.xAxis, "min", refreshXMode);
		this.bindBound(plot.XMaxLabel, group.xAxis, "max", refreshXMode);

		// Seconds of history to show. Empty means the whole buffer, which is what the placeholder says.
		const windowBox = config.SetValue.Window;
		windowBox.PlaceholderText = "All";
		this.event.subscribe(windowBox.FocusLost, () => {
			const parsed = tonumber(windowBox.Text.trim());
			if (parsed === undefined || parsed <= 0) {
				windowBox.Text = "";
				group.window = undefined;
				return;
			}

			group.window = parsed;
		});

		const bindToggle = (button: TextButton, prefix: string, get: () => boolean, set: (v: boolean) => void) => {
			button.Text = `${prefix}: ${get() ? "On" : "Off"}`;
			this.parent(
				new ButtonControl(button, () => {
					set(!get());
					button.Text = `${prefix}: ${get() ? "On" : "Off"}`;
				}),
			);
		};
		bindToggle(
			params.LinesEnabled,
			"Lines",
			() => group.lines,
			(v) => (group.lines = v),
		);
		bindToggle(
			params.GridEnabled,
			"Grid",
			() => group.grid,
			(v) => (group.grid = v),
		);

		const outputById = (id: string): RecordedOutput | undefined => {
			for (const output of group.outputs) {
				if (output.id === id) return output;
			}
		};

		const bindPick = (button: TextButton, caption: () => string, bind: (picked: PickedOutput) => void) => {
			// Per-button, because the picker is shared: pressing the other Set button supersedes this pick, and
			// only the button that owned it should have its caption put back.
			let armed = false;
			const refresh = () => {
				if (!armed) button.Text = caption();
			};
			refresh();

			this.parent(
				new ButtonControl(button, () => {
					if (armed) {
						picker.cancel();
						return;
					}

					armed = true;
					button.Text = "Click a block…";
					picker.arm(
						(output) => {
							bind(output);
							rebuildRows();
						},
						// Runs however the pick ended — chosen, clicked away, or superseded.
						() => {
							armed = false;
							refresh();
						},
					);
				}),
			);

			return refresh;
		};

		// Reads its binding like X does. Several series have their own rows, so the button only counts them.
		const refreshY = bindPick(
			config.SetValue.SetY,
			() => {
				if (group.y.isEmpty()) return "Y: None";
				if (group.y.size() > 1) return `Y: ${group.y.size()} series`;

				const only = outputById(group.y[0]);
				return only ? `Y: ${only.name}` : "Y: None";
			},
			(output) => {
				const recorded = store.bindOutput(group, output.uuid, output.outputKey, output.name, output.arity);
				// Re-picking a bound output removes that series, mirroring how X toggles itself off.
				if (group.y.includes(recorded.id)) {
					store.unbindOutput(group, recorded);
					return;
				}

				group.y.push(recorded.id);
			},
		);

		// X has no row anywhere, so the button doubles as the readout of what it currently reads.
		const refreshX = bindPick(
			config.SetValue.SetX,
			() => {
				const bound = group.x.kind === "output" ? outputById(group.x.outputId) : undefined;
				return bound ? `X: ${bound.name}` : "X: Time";
			},
			(output) => {
				const recorded = store.bindOutput(group, output.uuid, output.outputKey, output.name, output.arity);
				// Picking what X already reads clears it back to time — with no row to delete, this is the only
				// way out. The recording goes too unless a Y series is still drawing it.
				if (group.x.kind === "output" && group.x.outputId === recorded.id) {
					group.x = { kind: "time" };
					if (!group.y.includes(recorded.id)) store.unbindOutput(group, recorded);
					return;
				}

				group.x = { kind: "output", outputId: recorded.id };
			},
		);

		/**
		 * Read from UserInputService against the plot's own rect rather than the frame's mouse events: the pooled
		 * points and grid lines sit on top of the plot and would otherwise take the hover for themselves.
		 */
		const pointerOver = (position: Vector3) => {
			const at = plot.AbsolutePosition;
			const size = plot.AbsoluteSize;
			return (
				position.X >= at.X && position.X <= at.X + size.X && position.Y >= at.Y && position.Y <= at.Y + size.Y
			);
		};
		this.event.subscribe(UserInputService.InputChanged, (input) => {
			if (
				input.UserInputType !== Enum.UserInputType.MouseMovement &&
				input.UserInputType !== Enum.UserInputType.Touch
			) {
				return;
			}

			// Touch included so a finger dragged across the plot scrubs the readout, the nearest thing to hovering.
			renderer.setPointer(pointerOver(input.Position) ? input.Position.X : undefined);
		});
		// Taken from the frame rather than from UserInputService: the window is Active so it can be resized, which
		// marks every click on it as game-processed, and a `processed` guard would drop all of them. A Frame only
		// receives InputBegan once it is Active, and being Active also makes the event fire only within the plot.
		plot.Active = true;
		this.event.subscribe(plot.InputBegan, (input) => {
			if (
				input.UserInputType !== Enum.UserInputType.MouseButton1 &&
				input.UserInputType !== Enum.UserInputType.Touch
			) {
				return;
			}

			// Resolved from where the press landed rather than from the last hover: touch has no hover to leave
			// that state behind. Snapping is what makes a pin reachable — a press on one takes it off again.
			const at = renderer.fractionAt(input.Position.X);
			if (at === undefined) return;

			const pinned = renderer.pinnedNear(group, at);
			if (pinned !== undefined) {
				group.cursors.remove(pinned);
				return;
			}

			group.cursors.push(at);
		});

		const rowTemplate = this.asTemplate(config.Series.Template);
		const rows = this.parent(new ComponentChildren<SeriesRow>().withParentInstance(config.Series));

		const rebuildRows = () => {
			// Deleting a Y row can clear the X binding with it, so both captions refresh from the same place.
			refreshX();
			refreshY();

			rows.clear();
			// Rows follow what the renderer draws, not the series' own arity: a scalar paired against a vector is
			// broadcast to three channels, and three lines with one row would leave two colours unaccounted for.
			const xOutput = group.x.kind === "output" ? outputById(group.x.outputId) : undefined;

			for (const id of group.y) {
				const output = outputById(id);
				if (!output) continue;

				const channels = GraphSeriesRenderer.channelsOf(output, xOutput);
				for (let channel = 0; channel < channels; channel++) {
					rows.add(
						new SeriesRow(rowTemplate(), output, channel, channels, () => {
							store.unbindOutput(group, output);
							rebuildRows();
						}),
					);
				}
			}
		};
		rebuildRows();

		// Sampling runs on the logic tick; drawing is throttled and only touches the plot when something moved.
		let lastShape = -1;
		let lastName = group.name;
		// Undefined rather than "" so the first pass always writes, whatever the template authored.
		let lastStatus: string | undefined;
		this.event.loop(REDRAW, () => {
			// Ahead of the visibility guard so a window renamed while hidden is already correct when shown.
			if (group.name !== lastName) {
				lastName = group.name;
				gui.Title.TextLabel.Text = group.name;
			}

			if (!group.visible.get()) return;

			renderer.render(group);

			// The bound actually drawn with, not the data extent: a pin on one side moves the other, and a
			// placeholder still reading the extent would disagree with the axis in front of it.
			plot.YMinLabel.PlaceholderText = prettyAxis(renderer.yMin, 0.01);
			plot.YMaxLabel.PlaceholderText = prettyAxis(renderer.yMax, 0.01);
			plot.XMinLabel.PlaceholderText = prettyAxis(renderer.xMin, 0.01);
			plot.XMaxLabel.PlaceholderText = prettyAxis(renderer.xMax, 0.01);

			// Only on change: this is idle most of the time, and an Instance write crosses into the engine.
			if (renderer.status !== lastStatus) {
				lastStatus = renderer.status;
				plot.Status.Text = renderer.status;
				plot.Status.Visible = renderer.status !== "";
			}

			// A vector output only reveals its arity once it has been sampled, and deleting a block flips `unbound`
			// and can clear X with it. Both change what the rows and captions read, so one accumulator covers both.
			let shape = 0;
			for (const output of group.outputs) shape += output.unbound ? 0 : output.arity;
			if (shape !== lastShape) {
				lastShape = shape;
				rebuildRows();
			}
		});
	}

	/**
	 * Typing a number pins that bound; clearing the box hands it back to the axis mode. The placeholder always
	 * shows what the automatic bound currently is, so an empty box still reads as a value rather than as blank.
	 */
	private bindBound(box: TextBox, axis: GraphAxisConfig, key: "min" | "max", onChanged: () => void) {
		this.event.subscribe(box.FocusLost, () => {
			const text = box.Text.trim();
			if (text === "") {
				axis[key] = undefined;
				onChanged();
				return;
			}

			const parsed = tonumber(text);
			if (parsed === undefined) {
				// Not a number — drop back to automatic rather than leaving a bound the player cannot see.
				box.Text = "";
				axis[key] = undefined;
				onChanged();
				return;
			}

			axis[key] = parsed;
			onChanged();
		});
	}
}
