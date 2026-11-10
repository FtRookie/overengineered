import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpCamera extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Flying the camera");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody({
				Desktop: "While building, {ui:TopRight.Freecam} or {key:freecam} lets you fly around your plot freely.",
				Touch: "While building, {ui:TopRight.Freecam} lets you fly around your plot freely.",
				Gamepad: "While building, {ui:TopRight.Freecam} lets you fly around your plot freely.",
			});
			this.addBody({
				Desktop:
					"Move with {key:freecam_forward} {key:freecam_left} {key:freecam_back} {key:freecam_right}, go up with {key:freecam_up} and down with {key:freecam_down}.",
				Touch: "Your character stays put until you switch it off again.",
				Gamepad: "Go up with {key:freecam_up} and down with {key:freecam_down}.",
			});
			this.addBody("The little slider that pops up sets how fast you fly.");
		}
		this.addPage("Cinematic camera");
		{
			this.addBody({
				Desktop:
					"{key:freecam_cinematic} switches to a smoother camera with no limits. It works while riding too, so it's great for filming.",
				Touch: "While riding, {ui:TopRight.Freecam} switches to a smooth camera with no limits. Great for filming!",
				Gamepad:
					"While riding, {ui:TopRight.Freecam} switches to a smooth camera with no limits. Great for filming!",
			});
		}
	}
}
