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
	/** The template lays the box and its label out beside the slider rather than under the row itself. */
	readonly Frame: Frame & {
		readonly ManualControl: TextBox;
		readonly SliderNameLabel: TextLabel;
	};
};

type FreecamWindowDefinition = FloatingWindowDefinition & {
	readonly TextLabel: TextLabel & {
		readonly Minimize: TextButton & {
			readonly ImageLabel: ImageLabel;
		};
	};
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
		const minimizeIcon = freecamGui.TextLabel.Minimize.ImageLabel;

		const minimizeIconId = "rbxassetid://86194272596479";
		const maximizeIconId = "rbxassetid://115144443204400";

		this.event.subscribe(freecamGui.TextLabel.Minimize.MouseButton1Click, () => {
			content.Visible = !content.Visible;
			minimizeIcon.Image = content.Visible ? minimizeIconId : maximizeIconId;
		});
		const sliderTemplate = this.asTemplate(content.SliderTemplate);
		const sliderRow = sliderTemplate();
		sliderRow.Parent = content;

		const slider = this.parent(
			new SliderControl(
				sliderRow.Control,
				{ min: 0.05, max: 2, step: 0.01, inputStep: 0.01 },
				{ TextBox: sliderRow.Frame.ManualControl },
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

		// Cinematic locks the pointer and is meant to be flown, not tuned, so the slider stays out of the shot.
		// Both are watched because the other key switches modes without stopping freecam.
		const updateSettingsVisibility = () =>
			freecamSettings.setVisibleAndEnabled(Freecam.isFreecaming.get() && !Freecam.isCinematic.get());
		this.event.subscribeObservable(Freecam.isFreecaming, updateSettingsVisibility, true);
		this.event.subscribeObservable(Freecam.isCinematic, updateSettingsVisibility, true);
	}
}
