import { HelpArticle, helpPlaceholderImage } from "client/gui/help/HelpArticle";
import { BasicCarTutorial } from "client/tutorial/tutorials/BasicCarTutorial";
import { NewBasicPlaneTutorial } from "client/tutorial/tutorials/NewBasicPlaneTutorial";
import type { HelpController } from "client/controller/HelpController";
import type { HelpArticleDefinition } from "client/gui/help/HelpArticle";
import type { PlayModeController } from "client/modes/PlayModeController";
import type { TutorialDescriber } from "client/tutorial/TutorialController";
import type { TutorialsService } from "client/tutorial/TutorialService";

export class HelpSettingsMenu extends HelpArticle {
	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.addPage("Making it yours");
		{
			this.addImage(helpPlaceholderImage);
			this.addBody("Hit {ui:Top.Settings} at the top. Everything is sorted into tabs down the left.");
			this.addBody("<b>Sounds</b>, <b>Playlist</b> and <b>Graphics</b> cover how the game sounds and looks.");
			this.addBody("<b>Camera</b>, <b>Interface</b> and <b>Colors</b> tweak the view and the menus.");
		}
		this.addPage("Your keys");
		{
			this.addBody(
				"Don't like a key? <b>Keybinds</b> lets you change any of them, and these help pages follow along.",
			);
			this.addBody({
				Desktop: "<b>Reset all</b> puts every key back the way it was.",
				Touch: "<b>Arrange buttons</b> lets you drag the on-screen buttons wherever suits you.",
				Gamepad: "<b>Reset all</b> puts every button back the way it was.",
			});
		}
		this.addPage("The world around you");
		{
			this.addBody("<b>Physics</b> changes gravity, wind and how easily things break.");
			this.addBody("<b>Environment</b> sets the time of day and the terrain.");
			this.addBody("<b>Controls</b> changes how fast you run and how high you jump.");
		}
		this.addPage("Learning more");
		{
			this.addBody("New here? A tutorial walks you through building a basic plane or car, step by step.");

			let run: ((clazz: ConstructorOf<TutorialDescriber>) => void) | undefined;
			const plane = this.addButton("Basic plane", () => run?.(NewBasicPlaneTutorial));
			const car = this.addButton("Basic car", () => run?.(BasicCarTutorial));

			this.$onInjectAuto(
				(
					tutorialsService: TutorialsService,
					help: HelpController,
					playMode: PlayModeController,
					di: DIContainer,
				) => {
					run = (clazz) => {
						task.spawn(() => tutorialsService.run(di.resolveForeignClass(clazz)));
						help.close();
					};

					const inBuild = playMode.get() === "build";
					plane.setButtonInteractable(inBuild);
					car.setButtonInteractable(inBuild);
				},
			);
		}
	}
}
