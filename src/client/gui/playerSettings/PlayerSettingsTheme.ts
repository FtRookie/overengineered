import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { Colors } from "shared/Colors";
import { PlayerConfigDefinition } from "shared/config/PlayerConfig";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { ObservableValue } from "engine/shared/event/ObservableValue";
import type { Color4 } from "shared/Color4";

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

		this.addCategory("Logic Debug");
		{
			const fontSize = this.addNumber("Font Size", 1, 100, 1)
				.setDescription("Font size of the text")
				.initToObjectPart(value, ["visuals", "logicDebug", "fontSize"]);
			const textStroke = this.addColor("Stroke", { alpha: 1, color: Colors.white }, true)
				.setDescription("color and transparency of text outline")
				.initToObjectPart(value, ["visuals", "logicDebug", "textStroke"]);
			const boldText = this.addToggle("Bold Text")
				.setDescription("Makes your text bold")
				.initToObjectPart(value, ["visuals", "logicDebug", "boldText"]);

			// AVAIBLELATER, GARBAGE, !DISABLED!
			const AVAILATERcolor = this.addColor("AVAILATER", { alpha: 1, color: Colors.white }, false)
				.setDescription("color of AVAILABLELATER value")
				.initToObjectPart(value, ["visuals", "logicDebug", "AVAILATER"]);
			const GARBAGEcolor = this.addColor("GARBAGE", { alpha: 1, color: Colors.white }, false)
				.setDescription("color of GARBAGE value")
				.initToObjectPart(value, ["visuals", "logicDebug", "GARBAGE"]);
			const DISABLEDcolor = this.addColor("!DISABLED!", { alpha: 1, color: Colors.white }, false)
				.setDescription("color of !DISABLED! values")
				.initToObjectPart(value, ["visuals", "logicDebug", "DISABLED"]);
			const nanColor = this.addColor("NaN", { alpha: 1, color: Colors.white }, false)
				.setDescription("color of NaN value")
				.initToObjectPart(value, ["visuals", "logicDebug", "nan"]);

			// Boolean
			const trueColor = this.addColor("true", { alpha: 1, color: Colors.white }, false)
				.setDescription("color of booleans when true")
				.initToObjectPart(value, ["visuals", "logicDebug", "true"]);
			const falseColor = this.addColor("false", { alpha: 1, color: Colors.white }, false)
				.setDescription("color of booleans when false")
				.initToObjectPart(value, ["visuals", "logicDebug", "false"]);

			// Number & Vector
			const numberZero = this.addColor("Zero", { alpha: 1, color: Colors.white }, false)
				.setDescription("color of a number at zero")
				.initToObjectPart(value, ["visuals", "logicDebug", "numberZero"]);
			const numberPositive = this.addColor("Positive", { alpha: 1, color: Colors.white }, false)
				.setDescription("color of a number with a value above zero")
				.initToObjectPart(value, ["visuals", "logicDebug", "numberPositive"]);
			const numberNegative = this.addColor("Negative", { alpha: 1, color: Colors.white }, false)
				.setDescription("color of a number with a value below zero")
				.initToObjectPart(value, ["visuals", "logicDebug", "numberNegative"]);

			// Color as Color
			const ColorAsColor = this.addToggle("Color as Color")
				.setDescription("Text color is the color of the value")
				.initToObjectPart(value, ["visuals", "logicDebug", "colorAsColor"]);
		}
	}
}
