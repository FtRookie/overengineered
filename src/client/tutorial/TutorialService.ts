import { BSOD } from "client/gui/BSOD";
import { AlertPopup } from "client/gui/popup/AlertPopup";
import { TutorialController } from "client/tutorial/TutorialController";
import { HostedService } from "engine/shared/di/HostedService";
import { CustomRemotes } from "shared/Remotes";
import type { PopupController } from "client/gui/PopupController";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { TutorialDescriber } from "client/tutorial/TutorialController";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";

/** Service for running the tutorials */
@injectable
class TutorialsService extends HostedService {
	private runningTutorial?: TutorialDescriber;

	constructor(
		readonly allTutorials: readonly TutorialDescriber[],
		@inject private readonly popupController: PopupController,
		@inject private readonly di: DIContainer,
	) {
		super();
	}

	/** Run the provided tutorial. Yields until the tutorial end. */
	run(tutorial: TutorialDescriber, config?: { readonly allowClosing: boolean }): void {
		if (this.runningTutorial) {
			$log("Another tutorial is already running");
			return;
		}

		const controller = this.di.resolveForeignClass(TutorialController, [tutorial.name]);
		this.tryProvideDIToChild(controller);
		if (config) {
			controller.canCancel = config.allowClosing;
		}

		try {
			this.runningTutorial = tutorial;

			const parts = tutorial.create(controller);
			controller.enable();

			let finished = true;
			for (const func of parts) {
				try {
					const parts = func();
					const result = controller.waitPart(...parts);

					finished = result === undefined;

					if (result === "skipped") CustomRemotes.tutorial.skipped.send();

					if (result === "canceled") {
						CustomRemotes.tutorial.cancelled.send();
						break;
					}
				} catch (err) {
					$warn(`Exception while running the tutorial "${tutorial.name}":`, err, "\n", debug.traceback());
					this.popupController.showPopup(
						new AlertPopup("There was an error running the tutorial.\nIt has been canceled."),
					);

					controller.destroy();
					break;
				}
			}

			if (finished) CustomRemotes.tutorial.finished.send();
		} catch (err) {
			BSOD.showWithDefaultText(err, "Tutorial has caused a crash");
			throw err;
		} finally {
			controller.destroy();
			this.runningTutorial = undefined;
		}
	}
}
export type { TutorialsService };

export namespace TutorialServiceInitializer {
	type TutorialCtor = new (...args: any[]) => TutorialDescriber;
	type InitializeConfiguration = {
		/** Tutorials to include */
		readonly tutorials: readonly TutorialCtor[];

		/** Tutorial to run when player has no slots on join */
		readonly tutorialToRunWhenNoSlots: TutorialCtor | undefined;
	};

	export function initialize(host: GameHostBuilder, config: InitializeConfiguration): void {
		host.services
			.registerService(TutorialsService)
			.withArgs((di) => [config.tutorials.map((t) => di.resolveForeignClass(t) as TutorialDescriber)]);

		if (config.tutorialToRunWhenNoSlots) {
			host.enabled.Connect((di) => {
				const playerData = di.resolve<PlayerDataStorage>();
				const service = di.resolve<TutorialsService>();
				service.onEnable(() => {
					if (asMap(playerData.slots.get()).any((k, s) => s.blocks !== 0)) return;

					task.delay(0, () =>
						service.run(di.resolveForeignClass(config.tutorialToRunWhenNoSlots!), { allowClosing: false }),
					);
				});
			});
		}
	}
}
