import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpWiring extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Making blocks talk");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody("Some blocks give out a value, like a sensor saying how fast you're going.");
			this.addBody("Others take one in, like a motor deciding how hard to spin.");
		}
		this.addPage("Hooking them up");
		{
			this.addBody({
				Desktop: "Grab the <b>Wiring</b> tool and drag from one block's output to another block's input.",
				Touch: "Grab the <b>Wiring</b> tool, tap one block's output, then tap another block's input.",
				Gamepad:
					"Grab the <b>Wiring</b> tool and press <b>Y</b> for a cursor, then drag from one block's output to another block's input.",
			});
			this.addBody({
				Desktop: "Click an input to unhook it.",
				Touch: "Tap an input on its own to unhook it.",
				Gamepad: "Click an input to unhook it.",
			});
			this.addBody(
				"Things getting crowded? <b>Hide connected</b> on the right hides the inputs you've already used.",
			);
		}
	}
}
