import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpDeleting extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Getting rid of blocks");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody({
				Desktop: "Grab the <b>Deleting</b> tool and click a block to get rid of it.",
				Touch: "Grab the <b>Deleting</b> tool and tap blocks to mark them, then hit the red delete button on the right.",
				Gamepad: "Grab the <b>Deleting</b> tool, point at a block and press <b>X</b> to get rid of it.",
			});
			this.addBody({
				Desktop:
					"Hold {key:selection_assembly} to delete everything stuck together, or {key:selection_machine} for a whole machine.",
				Touch: "Switch to <b>Assembly selection</b> or <b>Machine selection</b> on the right to delete a whole chunk at once.",
				Gamepad:
					"Switch to <b>Assembly selection</b> or <b>Machine selection</b> on the right to delete a whole chunk at once.",
			});
		}
		this.addPage("Starting fresh");
		{
			this.addBody({
				Desktop: "<b>Clear plot</b> at the bottom wipes everything off your plot.",
				Touch: "<b>Clear plot</b> at the bottom wipes everything off your plot.",
				Gamepad: "<b>Clear plot</b> at the bottom, or {key:delete_clearPlot}, wipes everything off your plot.",
			});
			this.addBody("It asks first, because there's no undo for that one!");
		}
	}
}
