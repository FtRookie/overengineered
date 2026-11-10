import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpHandyButtons extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Oops buttons");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody({
				Desktop:
					"{ui:TopRight.Undo} and {ui:TopRight.Redo} undo and redo what you built. <b>Ctrl + Z</b> and <b>Ctrl + Y</b> do the same.",
				Touch: "{ui:TopRight.Undo} and {ui:TopRight.Redo} undo and redo what you built.",
				Gamepad: "{ui:TopRight.Undo} and {ui:TopRight.Redo} undo and redo what you built.",
			});
		}
		this.addPage("The grid panel");
		{
			this.addBody(
				"{ui:TopRight.Grid} opens a panel for how far blocks move and how much they turn with each step.",
			);
			this.addBody("The <b>+</b> and <b>-</b> buttons double or halve each one.");
			this.addBody({
				Desktop: "Hold <b>Ctrl</b> to stop snapping for a moment.",
				Touch: "Set it to 0 to stop snapping altogether.",
				Gamepad: "Set it to 0 to stop snapping altogether.",
			});
		}
		this.addPage("Mirroring");
		{
			this.addBody("With the <b>Building</b> tool out, {ui:TopRight.mirror} opens the mirror panel.");
			this.addBody("Switch on X, Y or Z and every block you place gets a twin on the other side.");
		}
		this.addPage("Checking your build");
		{
			this.addBody(
				"{ui:TopRight.CenterOfMass} shows where your build's weight sits. Handy for planes that keep flipping!",
			);
			this.addBody("Another button next to it draws red lines between blocks that are stuck together.");
			this.addBody(
				"{ui:TopRight.Graphs} draws a chart of any block's output while it runs, so you can see what your logic is up to.",
			);
		}
		this.addPage("Hiding everything");
		{
			this.addBody({
				Desktop: "Want a clean screenshot? {ui:TopRight.Hide}, or <b>Shift + G</b>, hides all the menus.",
				Touch: "Want a clean screenshot? {ui:TopRight.Hide} hides all the menus.",
				Gamepad: "Want a clean screenshot? {ui:TopRight.Hide} hides all the menus.",
			});
			this.addBody("Press it again to bring them back.");
		}
	}
}
