import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpBuilding extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Placing blocks");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody("Grab the <b>Building</b> tool and pick a block from the list.");
			this.addBody({
				Desktop:
					"Click where you want it to go. Looking for something specific? {key:build_block_search} searches the list.",
				Touch: "Tap where you want it to go.",
				Gamepad: "Point at where you want it to go and place it.",
			});
		}
		this.addPage("Snapping to the grid");
		{
			this.addBody("Blocks snap to a grid so everything lines up nicely.");
			this.addBody({
				Desktop:
					"Make the grid smaller with {key:build_grid_size_down} and bigger with {key:build_grid_size_up}.",
				Touch: "The <b>grid</b> button at the top right lets you make it smaller or bigger.",
				Gamepad: "The <b>grid</b> button at the top right lets you make it smaller or bigger.",
			});
		}
	}
}
