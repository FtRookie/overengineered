import { HelpArticle } from "client/gui/help/HelpArticle";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";

export class HelpGettingStarted extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Welcome");
		{
			this.addHeader("Build anything, then ride it");
			this.addBody("You build on your own plot out of blocks, wire them up to make them move, and then ride it.");
		}
		this.addPage("The top bar");
		{
			this.addHeader("Run and Save");
			this.addBody("Press {ui:Top.Run} to ride what you built. Leave the ride to come back and keep building.");
			this.addBody("Press {ui:Top.Save} to save your build to a slot, or to load one you saved before.");
			this.addBody("Press {key:help} any time to open this help again.");
		}
	}
}

export class HelpBuilding extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Placing blocks");
		{
			this.addHeader("Pick a block, then place it");
			this.addBody("With the Building tool, pick a block from the block menu. Search finds it by name.");
			this.addBody({
				Desktop:
					"Click to place it. {key:build_rotateX}, {key:build_rotateY} and {key:build_rotateZ} turn it. Hold {key:build_grid_hold_off} to place it off the grid.",
				Touch: "Tap where it should go, then press + to place it. X, Y and Z turn it.",
				Gamepad:
					"Press {key:build_place} to place it. {key:build_rotateX}, {key:build_rotateY} and {key:build_rotateZ} turn it.",
			});
		}
		this.addPage("Learning a block");
		{
			this.addHeader("See it in action");
			this.addBody("The following blocks have a demo. Hold the block in the block menu to watch it work.");
			this.addBody("AESA Radar, Radar Section, Radial Radar and Particle Emitter");
		}
	}
}

export class HelpWiring extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Connecting blocks");
		{
			this.addHeader("Outputs go into inputs");
			this.addBody(
				"Logic blocks pass values to each other. With the Wiring tool, every block shows its markers.",
			);
			this.addBody({
				Desktop:
					"Drag from an output marker to an input marker to connect them. Click an input to disconnect it.",
				Touch: "Tap an output marker, then an input marker, to connect them. Tap an input on its own to disconnect it.",
				Gamepad:
					"Press {key:wire_markerSelection} to pick markers, then select an output marker and an input marker to connect them.",
			});
		}
		this.addPage("Settings");
		{
			this.addHeader("Inputs you don't wire");
			this.addBody("An input with no wire uses the value set with the Configuring tool.");
			this.addBody({
				Desktop:
					"Hold {key:wire_hideConnected} with the Wiring tool to hide the markers that are already connected.",
				Touch: "Wired inputs take their value from the wire instead.",
				Gamepad: "Wired inputs take their value from the wire instead.",
			});
		}
	}
}
