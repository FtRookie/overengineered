import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { PlayerConfigDefinition } from "shared/config/PlayerConfig";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { ObservableValue } from "engine/shared/event/ObservableValue";
import type { Color4 } from "shared/Color4";

type ColorKeys<T> = { [K in keyof T]: T[K] extends Color4 ? K : never }[keyof T] & string;

export class PlayerSettingsTheme extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		const df = PlayerConfigDefinition.visuals.config;
		const dffrom = (transparency: number, color: Color3): Color4 => ({ alpha: 1 - transparency, color });

		this.addCategory("Selection");
		{
			this.addColor("Surface color", dffrom(df.selection.surfaceTransparency, df.selection.surfaceColor), true) //
				.initColor(
					value,
					["visuals", "selection", "surfaceColor"],
					["visuals", "selection", "surfaceTransparency"],
				);

			this.addColor("Border color", dffrom(df.selection.borderTransparency, df.selection.borderColor), true) //
				.initColor(
					value,
					["visuals", "selection", "borderColor"],
					["visuals", "selection", "borderTransparency"],
				);

			this.addSlider("Border thickness", { min: 0.01, max: 1, inputStep: 0.01 }) //
				.initToObjectPart(value, ["visuals", "selection", "borderThickness"]);
		}

		this.addCategory("Active selection");
		{
			this.addColor(
				"Surface color",
				dffrom(df.multiSelection.surfaceTransparency, df.multiSelection.surfaceColor),
				true,
			) //
				.initColor(
					value,
					["visuals", "multiSelection", "surfaceColor"],
					["visuals", "multiSelection", "surfaceTransparency"],
				);

			this.addColor(
				"Border color",
				dffrom(df.multiSelection.borderTransparency, df.multiSelection.borderColor),
				true,
			) //
				.initColor(
					value,
					["visuals", "multiSelection", "borderColor"],
					["visuals", "multiSelection", "borderTransparency"],
				);

			this.addSlider("Border thickness", { min: 0.01, max: 1, inputStep: 0.01 }) //
				.initToObjectPart(value, ["visuals", "multiSelection", "borderThickness"]);
		}

		this.addCategory("Edit tool");
		{
			this.addSlider("Handle transparency", { min: 0, max: 1, inputStep: 0.01 }) //
				.initToObjectPart(value, ["visuals", "editHandles", "transparency"]);

			for (const axis of ["x", "y", "z"] as const) {
				this.addColor(`${axis.upper()} axis color`, df.editHandles[axis], false) //
					.initToObjectPart(value, ["visuals", "editHandles", axis]);
			}
		}

		this.addCategory("Polygon tool");
		{
			this.addSlider("Point size", { min: 0.05, max: 2, inputStep: 0.01 }) //
				.initToObjectPart(value, ["visuals", "polygon", "pointSize"]);
			this.addColor("Point color", df.polygon.point, true) //
				.initToObjectPart(value, ["visuals", "polygon", "point"]);
			this.addSlider("Handle transparency", { min: 0, max: 1, inputStep: 0.01 }) //
				.initToObjectPart(value, ["visuals", "polygon", "handleTransparency"]);
			this.addSlider("Fill transparency", { min: 0, max: 1, inputStep: 0.01 }) //
				.setDescription("Transparency of the shape preview")
				.initToObjectPart(value, ["visuals", "polygon", "fillTransparency"]);
		}

		this.addCategory("Logic Debug");
		{
			const dfl = df.logicDebug;
			const color = (name: string, token: ColorKeys<typeof dfl>, description: string) =>
				this.addColor(name, dfl[token], false)
					.setDescription(description)
					.initToObjectPart(value, ["visuals", "logicDebug", token]);

			this.addNumber("Font Size", 1, 100, 1)
				.setDescription("Font size of the text")
				.initToObjectPart(value, ["visuals", "logicDebug", "fontSize"]);
			this.addColor("Stroke", dfl.textStroke, true)
				.setDescription("color and transparency of text outline")
				.initToObjectPart(value, ["visuals", "logicDebug", "textStroke"]);
			this.addToggle("Bold Text")
				.setDescription("Makes your text bold")
				.initToObjectPart(value, ["visuals", "logicDebug", "boldText"]);

			// AVAIBLELATER, GARBAGE, !DISABLED!
			color("AVAILATER", "AVAILATER", "color of AVAILABLELATER value");
			color("GARBAGE", "GARBAGE", "color of GARBAGE value");
			color("!DISABLED!", "DISABLED", "color of !DISABLED! values");
			color("NaN", "nan", "color of NaN value");

			// Boolean
			color("true", "true", "color of booleans when true");
			color("false", "false", "color of booleans when false");

			// Number & Vector
			color("Zero", "numberZero", "color of a number at zero");
			color("Positive", "numberPositive", "color of a number with a value above zero");
			color("Negative", "numberNegative", "color of a number with a value below zero");

			// Color as Color
			this.addToggle("Color as Color")
				.setDescription("Text color is the color of the value")
				.initToObjectPart(value, ["visuals", "logicDebug", "colorAsColor"]);
		}
	}
}
