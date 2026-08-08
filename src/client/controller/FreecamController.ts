import { Freecam } from "client/Freecam";
import { SliderControl } from "client/gui/controls/SliderControl";
import { FloatingWindow } from "client/gui/FloatingWindow";
import { Interface } from "engine/client/gui/Interface";
import { Keybinds } from "engine/client/Keybinds";
import { HostedService } from "engine/shared/di/HostedService";
import type { SliderControlDefinition } from "client/gui/controls/SliderControl";
import type { FloatingWindowDefinition } from "client/gui/FloatingWindow";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { WindowPositionController } from "client/gui/WindowPositions";
import type { PlayModeController } from "client/modes/PlayModeController";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";

type FreecamSliderRowDefinition = Frame & {
	readonly Control: SliderControlDefinition;
	readonly ManualControl: TextBox;
	readonly SliderNameLabel: TextLabel;
};

type FreecamWindowDefinition = FloatingWindowDefinition & {
	readonly TextLabel: TextLabel;
	readonly Content: Frame & {
		readonly SliderTemplate: FreecamSliderRowDefinition;
	};
};

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
		@inject windowPositions: WindowPositionController,
	) {
		super();

		this.event.subscribeObservable(
			playMode.playmode,
			(mode) => {
				Freecam.toggle.canExecute.and("modeBuild", mode === "build");
				// cinematic covers ride too, where the bounded one is off; a player with no mode at all
				// (dead, still loading) has no character for it to hang off
				Freecam.cinematicToggle.canExecute.and("hasMode", mode !== undefined);
				Freecam.stopForModeChange();
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

		this.parent(
			mainScreen
				.addTopRightButton("Freecam", 85551851050331)
				.subscribeToAction(Freecam.toggle)
				.subscribeVisibilityFrom({ can: Freecam.toggle.canExecute }),
		);

		const freecamTemplate = Interface.getInterface<{
			Floating: {
				Freecam: FreecamWindowDefinition;
			};
		}>().Floating.Freecam;
		const freecamGui = freecamTemplate.Clone() as FreecamWindowDefinition;
		freecamGui.Parent = freecamTemplate.Parent;

		const freecamSettings = this.parent(FloatingWindow.create(freecamGui));
		freecamSettings.setVisibleAndEnabled(false);

		const content = freecamGui.Content;

		const sliderTemplate = this.asTemplate(content.SliderTemplate);
		const sliderRow = sliderTemplate();
		sliderRow.Parent = content;
		sliderRow.SliderNameLabel.Visible = false;

		const slider = this.parent(
			new SliderControl(
				sliderRow.Control,
				{ min: 0.05, max: 2, step: 0.01, inputStep: 0.01 },
				{ TextBox: sliderRow.ManualControl },
			),
		);
		slider.value.set(Freecam.speed.get());
		this.event.subscribe(slider.value.changed, (value) => {
			if (Freecam.speed.get() !== value) {
				Freecam.speed.set(value);
			}
		});
		this.event.subscribeObservable(
			Freecam.speed,
			(value) => {
				if (slider.value.get() !== value) {
					slider.value.set(value);
				}
			},
			true,
		);
		windowPositions.attach(this.event, freecamGui.TextLabel, freecamGui, "Freecam");

		this.event.subscribeObservable(
			Freecam.isFreecaming,
			(enabled) => freecamSettings.setVisibleAndEnabled(enabled),
			true,
		);
	}
}
