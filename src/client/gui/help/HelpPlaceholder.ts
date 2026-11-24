import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

// fixme: placeholder text standing in for every section until the articles are written
export class HelpPlaceholder extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Coming soon");
		{
			this.addImage(helpPlaceholderImage, "placeholder image");
			this.addBody("This page has not been written yet.");
		}
		this.addPage("Placeholder");
		{
			this.addHeader("Placeholder header");
			this.addBody("Placeholder text. Press {key:help} to close the help.");
		}
	}
}
