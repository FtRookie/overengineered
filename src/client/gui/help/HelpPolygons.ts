import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpPolygons extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Making your own shapes");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody("The <b>Polygon</b> tool builds a shape out of points you put down.");
			this.addBody("Pick <b>Triangle</b>, <b>Line</b> or <b>Polygon</b> from the row at the bottom.");
			this.addBody({
				Desktop: "Click to place each point.",
				Touch: "Tap <b>+</b> on the right to place each point.",
				Gamepad: "Press <b>X</b> to place each point.",
			});
			this.addBody(
				"A Triangle is placed on its third point and a Line on its second. A Polygon takes as many points as you like: click the first point again or hit <b>Confirm</b> to finish it.",
			);
			this.addBody(
				"Clicking the first point again finishes whatever you've drawn: two points make a Line, three a Triangle.",
			);
			this.addBody({
				Desktop: "<b>Undo Point</b> takes back the last one, and <b>Cancel</b> starts over.",
				Touch: "<b>Undo Point</b> takes back the last one, and <b>Cancel</b> starts over.",
				Gamepad: "<b>Y</b> takes back the last one, and <b>Cancel</b> starts over.",
			});
		}
		this.addPage("Choosing what it's made of");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody("Pick the block it's built from in the menu on the left.");
			this.addBody(
				"Wedges and Wings make Triangles and Polygons. Blocks, Cylinders, Trusses, Ropes and Chains make Lines. Picking one switches to a shape it can build.",
			);
			this.addBody(
				"Rectangles and other right-angled shapes are built from flat panels, so they take fewer parts.",
			);
		}
		this.addPage("Getting it just right");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody("Points snap to the corners of blocks, so new shapes line up with what's already there.");
			this.addBody({
				Desktop: "{key:polygon_rotate} cycles through the different ways the shape can be built.",
				Touch: "The green <b>Rotate</b> button cycles through the different ways the shape can be built.",
				Gamepad: "{key:polygon_rotate} cycles through the different ways the shape can be built.",
			});
			this.addBody({
				Desktop:
					"<b>Align Top</b>, <b>Align Center</b> and <b>Align Bottom</b> change how the shape sits on your points.",
				Touch: "<b>Align Top</b>, <b>Align Center</b> and <b>Align Bottom</b> change how the shape sits on your points.",
				Gamepad: "<b>D-pad Down</b> changes how the shape sits on your points.",
			});
			this.addBody("Set how thick it is in the <b>grid</b> panel at the top right.");
			this.addBody("Facing the wrong way? <b>Flip Normal</b> at the top turns it around.");
			this.addBody("Turn on <b>Precision mode</b> to drag the points into place before you confirm.");
		}
	}
}
