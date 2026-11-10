import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpRiding extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Taking it for a spin");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody("Hit {ui:Top.Run} at the top and your build comes to life.");
			this.addBody("Any logic you've wired up starts running straight away.");
			this.addBody("Hold it for a second instead to start with the logic paused.");
		}
		this.addPage("Once you're out there");
		{
			this.addBody("{ui:Top.Sit} hops you into your build's seat, if it has one.");
			this.addBody({
				Desktop: "The keys you picked in your blocks' settings drive it.",
				Touch: "Once you're seated, a button shows up for every key your build uses.",
				Gamepad: "The buttons you picked in your blocks' settings drive it.",
			});
			this.addBody("Hit {ui:Top.Stop} to go back to building.");
		}
		this.addPage("Checking your logic");
		{
			this.addBody(
				"{ui:TopRight.Logic} opens a panel to pause your logic, or step through it one tick at a time.",
			);
			this.addBody("Tick <b>Visualizer</b> to see what every block is thinking, floating right above it.");
		}
		this.addPage("Moving your buttons");
		{
			this.addBody({
				Desktop: "On a phone or tablet you can drag the ride buttons wherever you like.",
				Touch: "The edit button at the top right lets you drag the ride buttons wherever you like. The reset button puts them back.",
				Gamepad: "On a phone or tablet you can drag the ride buttons wherever you like.",
			});
		}
	}
}
