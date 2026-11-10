import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpGettingStarted extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Welcome to OverEngineered");
		{
			this.addImage(helpPlaceholderImage, "your plot, all yours to build on");
			this.addBody("This is your plot. Build whatever you want on it, then take it for a ride.");
			this.addBody("Cars, planes, boats, rockets, contraptions that make no sense at all. It's all fair game.");
		}
		this.addPage("Your tools");
		{
			this.addBody({
				Desktop:
					"Your tools live in the bar at the bottom. Press <b>1</b> to <b>8</b> to grab one, or press it again to put it away.",
				Touch: "Your tools live in the bar at the bottom. Tap one to grab it, and tap it again to put it away.",
				Gamepad:
					"Your tools live in the bar at the bottom. Use <b>L1</b> and <b>R1</b> to flip through them, and <b>B</b> to put them away.",
			});
			this.addHeader("What they do");
			this.addBody(
				"<b>Building</b> places blocks, <b>Editing</b> moves them around, and <b>Deleting</b> gets rid of them.",
			);
			this.addBody("<b>Configuring</b> changes a block's settings, and <b>Painting</b> gives it a fresh coat.");
			this.addBody("<b>Wiring</b> hooks blocks up so they can talk, and <b>Welding</b> sticks them together.");
		}
		this.addPage("Ready to go");
		{
			this.addBody("Hit {ui:Top.Run} at the top to ride what you've made.");
			this.addBody("Something not working? Come back to building, tweak it, and try again. That's half the fun.");
		}
	}
}
