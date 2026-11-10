import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpTriangles extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Making your own shapes");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody("The <b>Triangle</b> tool builds a shape out of points you put down.");
			this.addBody({
				Desktop: "Click to place each point. Once you've got three or more, hit <b>Confirm</b>.",
				Touch: "Tap <b>+</b> on the right to place each point. Once you've got three or more, hit <b>Confirm</b>.",
				Gamepad: "Press <b>X</b> to place each point. Once you've got three or more, hit <b>Confirm</b>.",
			});
			this.addBody({
				Desktop: "<b>Undo Point</b> takes back the last one, and <b>Cancel</b> starts over.",
				Touch: "<b>Undo Point</b> takes back the last one, and <b>Cancel</b> starts over.",
				Gamepad: "<b>Y</b> takes back the last one, and <b>Cancel</b> starts over.",
			});
		}
		this.addPage("Getting it just right");
		{
			this.addBody("Pick a material and colour at the bottom before you confirm.");
			this.addBody(
				"<b>Align Top</b>, <b>Align Center</b> and <b>Align Bottom</b> change how the shape sits on your points.",
			);
			this.addBody("Set how thick it is in the <b>grid</b> panel at the top right.");
			this.addBody("Facing the wrong way? <b>Flip Normal</b> at the top turns it around.");
		}
	}
}
