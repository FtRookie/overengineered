import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpEditing extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Moving things around");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody("Grab the <b>Editing</b> tool and select the blocks you want to change.");
			this.addBody({
				Desktop:
					"Move them with {key:edit_move}, spin them with {key:edit_rotate} and resize them with {key:edit_scale}.",
				Touch: "Tap the buttons at the bottom to move, spin or resize them.",
				Gamepad: "Move them with {key:edit_move}, or use the buttons at the bottom to spin and resize them.",
			});
			this.addBody({
				Desktop: "Need a second one? Copy with {key:edit_copy} and paste with {key:edit_paste}.",
				Touch: "Need a second one? The <b>copy</b> and <b>paste</b> buttons at the bottom have you covered.",
				Gamepad: "Need a second one? The <b>copy</b> and <b>paste</b> buttons at the bottom have you covered.",
			});
		}
		this.addPage("Selecting lots at once");
		{
			this.addBody({
				Desktop: "Hold {key:selection_box} and drag to box select a bunch of blocks.",
				Touch: "<b>Select all</b> on the right grabs every block you've got.",
				Gamepad: "<b>Select all</b> on the right grabs every block you've got.",
			});
			this.addBody({
				Desktop:
					"Hold {key:selection_assembly} to grab everything stuck together, or {key:selection_machine} for the whole machine.",
				Touch: "Switch to <b>Assembly selection</b> to grab everything stuck together, or <b>Machine selection</b> for the whole machine.",
				Gamepad:
					"Switch to <b>Assembly selection</b> to grab everything stuck together, or <b>Machine selection</b> for the whole machine.",
			});
		}
		this.addPage("Cleaning up");
		{
			this.addBody("The <b>Deleting</b> tool removes whatever you pick.");
			this.addBody({
				Desktop: "While editing, {key:edit_delete} deletes your selection and {key:edit_paint} paints it.",
				Touch: "While editing, the buttons at the bottom can delete or paint your selection.",
				Gamepad: "While editing, the buttons at the bottom can delete or paint your selection.",
			});
		}
	}
}
