import { showColorChooser } from "client/gui/ColorChooserPopup";
import { ColorVisualizerWithAlpha } from "client/gui/ColorVisualizerWithAlpha";
import { ConfigControlBase } from "client/gui/configControls/ConfigControlBase";
import { Color4TextBox } from "client/gui/controls/Color4TextBox";
import { NumberTextBoxControl } from "client/gui/controls/NumberTextBoxControl";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { SubmittableValue } from "engine/shared/event/SubmittableValue";
import { ConfigSequences } from "shared/blockLogic/ConfigSequences";
import type { ColorVisualizerWithAlphaDefinition } from "client/gui/ColorVisualizerWithAlpha";
import type { ConfigControlBaseDefinition } from "client/gui/configControls/ConfigControlBase";
import type { PopupController } from "client/gui/PopupController";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";

type Row<T> = ConfigSequences.Row<T>;
type RowDefinition = GuiObject & {
	readonly Time: TextBox;
	readonly DeleteButton: GuiButton;
};
type SequenceDefinition<TRow extends RowDefinition> = ConfigControlBaseDefinition & {
	readonly Data: GuiObject & { readonly Control: GuiButton };
	readonly Buttons: GuiObject & {
		readonly Template: TRow;
		readonly NothingLabel: TextLabel;
	};
};

type NumberRowDefinition = RowDefinition & { readonly Number: TextBox };
type ColorRowDefinition = RowDefinition & {
	readonly Color: GuiObject & {
		readonly Preview: ColorVisualizerWithAlphaDefinition;
		readonly RGBA: TextBox;
		readonly EditControl: GuiButton;
	};
};
export type ConfigControlNumberSequenceDefinition = SequenceDefinition<NumberRowDefinition>;
export type ConfigControlColorSequenceDefinition = SequenceDefinition<ColorRowDefinition>;

declare module "client/gui/configControls/ConfigControlsList" {
	export interface ConfigControlTemplateList {
		readonly NumberSequence: ConfigControlNumberSequenceDefinition;
		readonly ColorSequence: ConfigControlColorSequenceDefinition;
	}
}

/** Builds the value column of one row; `changed` is called with the row's new value once the player commits it */
type ValueColumn<TRow extends RowDefinition, T> = (row: Control<TRow>, value: T, changed: (value: T) => void) => void;

class ConfigControlSequence<TRow extends RowDefinition, T, V extends defined> extends ConfigControlBase<
	SequenceDefinition<TRow>,
	V
> {
	constructor(
		gui: SequenceDefinition<TRow>,
		name: string,
		shape: BlockLogicTypes.ConfigSequenceShape,
		defaultValue: V,
		toRows: (value: V) => Row<T>[],
		fromRows: (rows: readonly Row<T>[]) => V,
		valueColumn: ValueColumn<TRow, T>,
	) {
		super(gui, name);

		const maxRows = shape === "range" ? 2 : ConfigSequences.maxRows;
		const template = this.asTemplate(gui.Buttons.Template, true);
		const children = this.parent(new ComponentChildren<Control<TRow>>().withParentInstance(gui.Buttons));
		gui.Buttons.NothingLabel.Visible = false;

		let rows: Row<T>[] = [];
		const submit = () => {
			const value = fromRows(rows);
			this.submit(this.multiMap(() => value));
		};

		const render = () => {
			children.clear();
			rows.forEach((row, i) => {
				const control = children.add(new Control(template()));
				control.instance.LayoutOrder = i;

				// a range's two points are its min and max, so their positions are fixed at 0 and 1
				const time = control.parent(new NumberTextBoxControl(control.instance.Time, 0, 1));
				time.value.set(row.time);
				control.instance.Time.TextEditable = shape !== "range";
				time.submitted.Connect((t) => {
					rows[i] = { ...rows[i], time: t };
					submit();
				});

				valueColumn(control, row.value, (value) => {
					rows[i] = { ...rows[i], value };
					submit();
				});

				control.instance.DeleteButton.Visible = rows.size() > 1;
				control.parent(
					new ButtonControl(control.instance.DeleteButton, () => {
						rows.remove(i);
						submit();
					}),
				);
			});

			gui.Data.Control.Visible = rows.size() < maxRows;
		};

		this.valueChanged((values) => {
			rows = toRows(this.multiOf(values) ?? defaultValue);
			if (shape === "range" && rows.size() === 2) rows = [rows[0], { ...rows[rows.size() - 1], time: 1 }];
			render();
		});

		this.parent(
			new ButtonControl(gui.Data.Control, () => {
				if (rows.size() >= maxRows) return;

				const last = rows[rows.size() - 1];
				rows.push({ time: shape === "range" ? 1 : nextTime(rows), value: last.value });
				submit();
			}),
		);
	}
}

/**
 * An empty end first, since a sequence missing a point at 0 or 1 gets one filled in (`ConfigSequences.toKeypoints`)
 * and that would appear as an extra row; then the middle of the widest gap.
 */
const nextTime = <T>(rows: readonly Row<T>[]): number => {
	if (!rows.any((r) => r.time >= 1)) return 1;
	if (!rows.any((r) => r.time <= 0)) return 0;

	const times = rows.map((r) => r.time).sort((a, b) => a < b);

	let best = 0;
	let at = 1;
	for (let i = 1; i < times.size(); i++) {
		const gap = times[i] - times[i - 1];
		if (gap <= best) continue;

		best = gap;
		at = times[i - 1] + gap / 2;
	}

	return at;
};

export class ConfigControlNumberSequence extends ConfigControlSequence<
	NumberRowDefinition,
	number,
	ConfigSequences.NumberValue
> {
	constructor(
		gui: ConfigControlNumberSequenceDefinition,
		name: string,
		shape: BlockLogicTypes.ConfigSequenceShape,
		defaultValue: number,
		min: number | undefined,
		max: number | undefined,
	) {
		super(
			gui,
			name,
			shape,
			defaultValue,
			ConfigSequences.numberRows,
			ConfigSequences.fromNumberRows,
			(row, value, changed) => {
				const box = row.parent(new NumberTextBoxControl(row.instance.Number, min, max));
				box.value.set(value);
				box.submitted.Connect(changed);
			},
		);
	}
}

export class ConfigControlColorSequence extends ConfigControlSequence<
	ColorRowDefinition,
	Color3,
	ConfigSequences.ColorValue
> {
	constructor(
		gui: ConfigControlColorSequenceDefinition,
		name: string,
		shape: BlockLogicTypes.ConfigSequenceShape,
		defaultValue: Color3,
	) {
		// rows are rebuilt after this control is injected, and a row's own $onInjectAuto would then never run
		let popupController: PopupController | undefined;

		super(
			gui,
			name,
			shape,
			defaultValue,
			ConfigSequences.colorRows,
			ConfigSequences.fromColorRows,
			(row, value, changed) => {
				const color = row.instance.Color;
				const v = new SubmittableValue(new ObservableValue<Color4>({ color: value, alpha: 1 }));

				row.parent(new Color4TextBox(color.RGBA, v, false));
				row.parent(new ColorVisualizerWithAlpha(color.Preview, v.value));
				row.parent(new Control(color.EditControl)) //
					.addButtonAction(() => {
						if (!popupController) return;
						showColorChooser(popupController, color, v, false);
					});
				v.submitted.Connect((c) => changed(c.color));
			},
		);

		this.$onInjectAuto((popup: PopupController) => (popupController = popup));
	}
}

type PointRowDefinition = GuiObject & {
	readonly X: TextBox;
	readonly Y: TextBox;
	readonly DeleteButton: GuiButton;
};
export type ConfigControlPointListDefinition = ConfigControlBaseDefinition & {
	readonly Data: GuiObject & { readonly Control: GuiButton };
	readonly Buttons: GuiObject & {
		readonly Template: PointRowDefinition;
		readonly NothingLabel: TextLabel;
	};
};

declare module "client/gui/configControls/ConfigControlsList" {
	export interface ConfigControlTemplateList {
		readonly PointList: ConfigControlPointListDefinition;
	}
}

/** `Path2D:SetControlPoints` warns above this many (Creator Docs) */
const maxPoints = 50;
/** A line needs two points to draw */
const minPoints = 2;

/** A `list` vector3 input: screen points edited as X, Y rows, kept in order */
export class ConfigControlPointList extends ConfigControlBase<ConfigControlPointListDefinition, readonly Vector3[]> {
	constructor(gui: ConfigControlPointListDefinition, name: string, defaultValue: readonly Vector3[]) {
		super(gui, name);

		const template = this.asTemplate(gui.Buttons.Template, true);
		const children = this.parent(
			new ComponentChildren<Control<PointRowDefinition>>().withParentInstance(gui.Buttons),
		);
		gui.Buttons.NothingLabel.Visible = false;

		let points: Vector3[] = [];
		const submit = () => {
			const value = [...points];
			this.submit(this.multiMap(() => value));
		};

		const render = () => {
			children.clear();
			points.forEach((point, i) => {
				const row = children.add(new Control(template()));
				row.instance.LayoutOrder = i;

				const x = row.parent(new NumberTextBoxControl(row.instance.X, 0, 1));
				const y = row.parent(new NumberTextBoxControl(row.instance.Y, 0, 1));
				x.value.set(point.X);
				y.value.set(point.Y);
				x.submitted.Connect((value) => {
					points[i] = new Vector3(value, points[i].Y, 0);
					submit();
				});
				y.submitted.Connect((value) => {
					points[i] = new Vector3(points[i].X, value, 0);
					submit();
				});

				row.instance.DeleteButton.Visible = points.size() > minPoints;
				row.parent(
					new ButtonControl(row.instance.DeleteButton, () => {
						points.remove(i);
						submit();
					}),
				);
			});

			gui.Data.Control.Visible = points.size() < maxPoints;
		};

		this.valueChanged((values) => {
			const value = this.multiOf(values) ?? defaultValue;
			points = typeIs(value, "Vector3") ? [value] : [...value];
			render();
		});

		this.parent(
			new ButtonControl(gui.Data.Control, () => {
				if (points.size() >= maxPoints) return;

				const last = points[points.size() - 1] ?? new Vector3(0.5, 0.5, 0);
				points.push(new Vector3(math.clamp(last.X + 0.05, 0, 1), last.Y, 0));
				submit();
			}),
		);
	}
}
