import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpTopBar extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("The big buttons up top");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody("{ui:Top.Run} takes your build for a ride.");
			this.addBody("{ui:Top.Teleport} picks where you start when you hit it.");
			this.addBody("{ui:Top.TeleportToPlot} brings you straight back to your plot.");
		}
		this.addPage("The rest of them");
		{
			this.addBody("{ui:Top.Save} opens your slots, so you can keep a build or load an old one.");
			this.addBody("{ui:Top.Settings} has everything from sound to graphics to your keys.");
			this.addBody("{ui:Top.Update Logs} shows what's new in the game.");
			this.addBody({
				Desktop: "And {ui:Top.Help} brings you back here. So does {key:help}, or typing <b>/help</b> in chat.",
				Touch: "And {ui:Top.Help} brings you back here. So does typing <b>/help</b> in chat.",
				Gamepad: "And {ui:Top.Help} brings you back here. So does typing <b>/help</b> in chat.",
			});
		}
	}
}
