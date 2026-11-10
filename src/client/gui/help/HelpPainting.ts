import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpPainting extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("A fresh coat");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody("Grab the <b>Painting</b> tool and pick a material and colour at the bottom.");
			this.addBody({
				Desktop: "Then click blocks to paint them.",
				Touch: "Then tap blocks to paint them.",
				Gamepad: "Then point at blocks and press <b>X</b> to paint them.",
			});
			this.addBody(
				"Only want to change one of the two? Switch off <b>Colors</b> or <b>Materials</b> at the top.",
			);
		}
		this.addPage("Copying a look");
		{
			this.addBody({
				Desktop: "Press <b>P</b> or middle click a block to copy its material and colour.",
				Touch: "The pipettes at the bottom copy the material and colour from a block.",
				Gamepad: "The pipettes at the bottom copy the material and colour from a block.",
			});
			this.addBody(
				"<b>Paint colors</b> and <b>Paint materials</b> on the right repaint your whole build in one go, so be careful!",
			);
		}
	}
}
