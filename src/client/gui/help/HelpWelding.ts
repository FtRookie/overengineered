import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpWelding extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Holding things together");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody(
				"Blocks that touch get stuck together on their own. The <b>Welding</b> tool lets you pick which ones stay stuck.",
			);
			this.addBody("Each weld shows up as a line between two markers. White means stuck, red means loose.");
		}
		this.addPage("Switching welds");
		{
			this.addBody({
				Desktop: "Drag from one marker to another to switch the weld between them on or off.",
				Touch: "Tap one marker, then another, to switch the weld between them on or off.",
				Gamepad:
					"Press <b>Y</b> for a cursor, then hold <b>A</b> on one marker and let go on another to switch that weld.",
			});
			this.addBody({
				Desktop: "Let go on the same marker to switch all of its welds at once.",
				Touch: "Tap the same marker twice to switch all of its welds at once.",
				Gamepad: "Let go on the same marker to switch all of its welds at once.",
			});
			this.addBody({
				Desktop: "Hold <b>F</b> to hide the lines for a moment.",
				Touch: "Changed your mind halfway? Hit <b>Cancel</b> at the bottom.",
				Gamepad: "Hold <b>F</b> to hide the lines for a moment.",
			});
		}
	}
}
