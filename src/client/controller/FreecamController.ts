import { Freecam } from "client/Freecam";
import { Keybinds } from "engine/client/Keybinds";
import { Transforms } from "engine/shared/component/Transforms";
import { HostedService } from "engine/shared/di/HostedService";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { PlayModeController } from "client/modes/PlayModeController";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";

// bind above the core camera controller so Shift+O reaches freecam instead of being consumed by keyboard zoom (O)
const keydef = Keybinds.registerDefinition(
	"freecam",
	["Freecam"],
	[["LeftShift", "O"]],
	Enum.ContextActionPriority.High.Value,
);
// same priority: P is the build/paint tools' picker, which must not fire when freecam takes the combination
const cinematicKeydef = Keybinds.registerDefinition(
	"freecam_cinematic",
	["Freecam", "Cinematic"],
	[["LeftShift", "P"]],
	Enum.ContextActionPriority.High.Value,
);

@injectable
export class FreecamController extends HostedService {
	constructor(
		@inject mainScreen: MainScreenLayout,
		@inject keybinds: Keybinds,
		@inject playMode: PlayModeController,
		@inject plot: ReadonlyPlot,
	) {
		super();

		this.event.subscribeObservable(
			playMode.playmode,
			(mode) => {
				Freecam.toggle.canExecute.and("modeBuild", mode === "build");
				Freecam.cinematicToggle.canExecute.and("modeBuild", mode === "build");
			},
			true,
		);
		Freecam.bounds.overlay("main", {
			center: plot.boundingBox.center,
			size: plot.boundingBox.originalSize.add(Vector3.one.mul(2).mul(8)),
		});

		Freecam.toggle.initKeybind(keybinds.fromDefinition(keydef));
		Freecam.cinematicToggle.initKeybind(keybinds.fromDefinition(cinematicKeydef));
		Freecam.initKeybinds(keybinds);

		const button = this.parent(mainScreen.addTopRightButton("Freecam", 85551851050331)) //
			.subscribeToAction(Freecam.toggle)
			.subscribeVisibilityFrom({ can: Freecam.toggle.canExecute });

		this.event.subscribeObservable(
			Freecam.isFreecaming,
			(enabled) =>
				Transforms.create()
					.transform(button.instance, "Transparency", enabled ? 0 : 0.5, Transforms.commonProps.quadOut02)
					.run(button.instance),
			true,
		);
	}
}
