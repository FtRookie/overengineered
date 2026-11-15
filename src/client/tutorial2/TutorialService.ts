import { LoadingController } from "client/controller/LoadingController";
import { TutorialStarter } from "client/tutorial2/TutorialStarter";
import { HostedService } from "engine/shared/di/HostedService";
import { CustomRemotes } from "shared/Remotes";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { TutorialDescription } from "client/tutorial2/TutorialDescription";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";

/** Runs one tutorial at a time and reports its outcome to the server */
@injectable
class TutorialService extends HostedService {
	private running?: TutorialStarter;

	constructor(
		readonly allTutorials: readonly TutorialDescription[],
		@inject private readonly buildingMode: BuildingMode,
	) {
		super();
	}

	/** Yields while switching to build mode */
	run(tutorial: TutorialDescription, firstTime = false): void {
		if (this.running) {
			$log("Another tutorial is already running");
			return;
		}

		const starter = new TutorialStarter();
		this.running = starter;

		try {
			LoadingController.run("Starting tutorial", () => CustomRemotes.modes.set.send({ mode: "build" }));
		} catch {
			// empty
		}
		if (starter.isDestroyed()) return;

		this.buildingMode.switchTutorialMode(true);
		starter.onDestroy(() => {
			this.buildingMode.switchTutorialMode(false);
			this.running = undefined;
		});

		starter.event.subscribe(starter.stepSkipped, () => CustomRemotes.tutorial.skipped.send());
		starter.completed.Connect((outcome) => {
			if (outcome === "finished") CustomRemotes.tutorial.finished.send();
			else CustomRemotes.tutorial.cancelled.send();
		});

		tutorial.start(starter, firstTime);
		this.parent(starter);
	}
}
export type { TutorialService };

export namespace TutorialServiceInitializer {
	type InitializeConfiguration = {
		readonly tutorials: readonly TutorialDescription[];
		/** Tutorial to run when the player has no slots on join */
		readonly tutorialToRunWhenNoSlots: TutorialDescription | undefined;
	};

	export function initialize(host: GameHostBuilder, config: InitializeConfiguration): void {
		host.services.registerService(TutorialService).withArgs([config.tutorials]);

		const firstTutorial = config.tutorialToRunWhenNoSlots;
		if (!firstTutorial) return;

		host.enabled.Connect((di) => {
			const playerData = di.resolve<PlayerDataStorage>();
			const service = di.resolve<TutorialService>();
			service.onEnable(() => {
				if (asMap(playerData.slots.get()).any((k, s) => s.blocks !== 0)) return;

				task.delay(0, () => service.run(firstTutorial, true));
			});
		});
	}
}
