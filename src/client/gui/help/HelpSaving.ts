import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpSaving extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Keeping your builds");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody("Hit {ui:Top.Save} at the top to open your slots.");
			this.addBody("Pick a slot, give it a name and a colour, and save. Loading works the same way.");
		}
		this.addPage("Don't lose anything");
		{
			this.addBody(
				"The game saves an <b>Autosave</b> every few minutes, and a <b>Last exit</b> copy when you leave.",
			);
			this.addBody("Got a build you never want to overwrite by accident? Hit the <b>lock</b> on its slot.");
		}
	}
}
