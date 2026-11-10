import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpConfiguring extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Changing a block's settings");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody(
				"Grab the <b>Configuring</b> tool and pick a block. Its settings show up in the panel on the left, so you can pick keys, speeds and the like.",
			);
			this.addBody({
				Desktop:
					"Hold <b>Shift</b> to pick more than one. They all change together, as long as they're the same kind of block.",
				Touch: "Pick more blocks to change them all together, as long as they're the same kind of block.",
				Gamepad: "Pick more blocks to change them all together, as long as they're the same kind of block.",
			});
		}
		this.addPage("Copying settings");
		{
			this.addBody({
				Desktop:
					"Got a block set up just right? Copy its settings with {key:config_copy} and paste them onto another of the same kind with {key:config_paste}.",
				Touch: "Got a block set up just right? <b>Copy</b> and <b>Paste</b> at the top of the panel carry its settings over to another of the same kind.",
				Gamepad:
					"Got a block set up just right? <b>Copy</b> and <b>Paste</b> at the top of the panel carry its settings over to another of the same kind.",
			});
			this.addBody({
				Desktop: "Messed it up? {key:config_reset} puts it back to how it started.",
				Touch: "Messed it up? <b>Reset</b> puts it back to how it started.",
				Gamepad: "Messed it up? <b>Reset</b> puts it back to how it started.",
			});
		}
	}
}
