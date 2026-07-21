import { RunService, UserInputService, Workspace } from "@rbxts/services";
import { LoadingController } from "client/controller/LoadingController";
import { LocalPlayerController } from "client/controller/LocalPlayerController";
import { ManualBeacon } from "client/gui/Beacon";
import { CheckBoxControl } from "client/gui/controls/CheckBoxControl";
import { FormattedLabelControl } from "client/gui/controls/FormattedLabelControl";
import { ProgressBarControl } from "client/gui/controls/ProgressBarControl";
import { ConfirmPopup } from "client/gui/popup/ConfirmPopup";
import { TouchModeButtonControl } from "client/gui/ridemode/TouchModeButtonControl";
import { LogControl } from "client/gui/static/LogControl";
import { requestMode } from "client/modes/PlayModeRequest";
import { Action } from "engine/client/Action";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { InputController } from "engine/client/InputController";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { Colors } from "engine/shared/Colors";
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { ComponentKeyedChildren } from "engine/shared/component/ComponentKeyedChildren";
import { EventHandler } from "engine/shared/event/EventHandler";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Signal } from "engine/shared/event/Signal";
import { MathUtils } from "engine/shared/fixes/MathUtils";
import { Strings } from "engine/shared/fixes/String.propmacro";
import { BeaconBlock } from "shared/blocks/blocks/BeaconBlock";
import { RocketBlocks } from "shared/blocks/blocks/RocketEngineBlocks";
import { VehicleSeatBlock } from "shared/blocks/blocks/VehicleSeatBlock";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { CustomRemotes } from "shared/Remotes";
import type { ClientMachine } from "client/blocks/ClientMachine";
import type { CheckBoxControlDefinition } from "client/gui/controls/CheckBoxControl";
import type { ProgressBarControlDefinition } from "client/gui/controls/ProgressBarControl";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { PopupController } from "client/gui/PopupController";
import type { RideMode } from "client/modes/ride/RideMode";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { Theme } from "client/Theme";
import type { TextButtonDefinition } from "engine/client/gui/Button";
import type { ReadonlyComponentChildren } from "engine/shared/component/ComponentChildren";
import type { InstanceComponent } from "engine/shared/component/InstanceComponent";
import type { GenericBlockLogic } from "shared/blockLogic/BlockLogic";
import type { BeaconBlockLogic } from "shared/blocks/blocks/BeaconBlock";
import type { RocketBlockLogic } from "shared/blocks/blocks/RocketEngineBlocks";

type RideModeControlsDefinition = GuiObject & {
	readonly Overlay: GuiObject;
	readonly Button: TextButtonDefinition;
};
export class RideModeControls extends Control<RideModeControlsDefinition> {
	readonly onEnterSettingsMode = new Signal<() => void>();
	readonly onQuitSettingsMode = new Signal<() => void>();

	private readonly overlayTemplate;
	private quitSettingsMode?: () => void;

	private readonly keyedChildren;

	constructor(
		gui: RideModeControlsDefinition,
		private readonly playerData: PlayerDataStorage,
	) {
		super(gui, { showOnEnable: true });

		this.keyedChildren = this.parent(
			new ComponentKeyedChildren<string, InstanceComponent<GuiObject>>().withParentInstance(gui),
		);
		this.overlayTemplate = this.asTemplate(this.gui.Overlay);

		this.onDisable(() => {
			if (this.quitSettingsMode) {
				this.toggleSettingsMode();
			}
		});
	}

	resetControl(btn: InstanceComponent<GuiObject>, pos: number) {
		const size = btn.instance.Size;

		let x = 0.95;
		let y = 1 - size.Y.Scale * pos - 0.01 * pos;

		while (y < 0.05) {
			y += 0.95;
			x -= 0.05;
		}

		btn.instance.Position = new UDim2(x, 0, y, 0);
	}
	resetControls() {
		let pos = 0;
		for (const [key, btn] of this.keyedChildren.getAll()) {
			this.resetControl(btn, pos);
			pos++;
		}
	}

	toggleSettingsMode() {
		if (this.quitSettingsMode) {
			this.quitSettingsMode();
			this.quitSettingsMode = undefined;
			return;
		}

		const mode = new Component();

		const overlayInstance = new Instance("Frame");
		mode.onDestroy(() => overlayInstance.Destroy());
		const overlay = mode.parent(new ComponentChildren().withParentInstance(overlayInstance));
		const ehandlers: EventHandler[] = [];
		let inputting = false;

		for (const [_, child] of this.keyedChildren.getAll()) {
			const instance = this.overlayTemplate();
			instance.Position = new UDim2(0, 0, 0, 0);
			instance.Size = new UDim2(1, 0, 1, 0);
			instance.Parent = child.instance;
			child.instance.Active = false;

			instance.InputBegan.Connect((input) => {
				if (inputting) return;

				if (
					input.UserInputType !== Enum.UserInputType.MouseButton1 &&
					input.UserInputType !== Enum.UserInputType.Touch
				)
					return;
				inputting = true;

				let prevpos = input.Position;

				const eh = new EventHandler();
				ehandlers.push(eh);
				eh.subscribe(UserInputService.InputChanged, (input) => {
					if (
						input.UserInputType !== Enum.UserInputType.MouseMovement &&
						input.UserInputType !== Enum.UserInputType.Touch
					)
						return;

					const delta = input.Position.sub(prevpos);
					prevpos = input.Position;
					child.instance.Position = child.instance.Position.add(
						new UDim2(delta.X / this.gui.AbsoluteSize.X, 0, delta.Y / this.gui.AbsoluteSize.Y, 0),
					);
				});

				eh.subscribe(UserInputService.InputEnded, (input) => {
					if (
						input.UserInputType !== Enum.UserInputType.MouseButton1 &&
						input.UserInputType !== Enum.UserInputType.Touch
					)
						return;

					{
						let abs = new Vector2(
							child.instance.Position.X.Scale * this.gui.AbsoluteSize.X,
							child.instance.Position.Y.Scale * this.gui.AbsoluteSize.Y,
						);

						const grid = child.instance.AbsoluteSize.div(4);
						abs = new Vector2(math.round(abs.X / grid.X) * grid.X, math.round(abs.Y / grid.Y) * grid.Y);

						child.instance.Position = new UDim2(
							abs.X / this.gui.AbsoluteSize.X,
							0,
							abs.Y / this.gui.AbsoluteSize.Y,
							0,
						);
					}

					eh.unsubscribeAll();
					ehandlers.remove(ehandlers.indexOf(eh));
					inputting = false;
				});
			});

			const box = new Control(instance);
			overlay.add(box);
		}

		this.onEnterSettingsMode.Fire();
		this.quitSettingsMode = async () => {
			for (const child of overlay.getAll()) {
				if (!(child instanceof Control)) continue;
				child.instance.Active = true;
			}

			this.onQuitSettingsMode.Fire();
			mode.destroy();

			for (const eh of ehandlers) {
				eh.unsubscribeAll();
			}

			const touchControls: Record<string, TouchControlInfo[string]> = {};
			for (const [keycode, child] of this.keyedChildren.getAll()) {
				touchControls[keycode] = {
					pos: [child.instance.Position.X.Scale, child.instance.Position.Y.Scale],
				};
			}

			const result = this.playerData.sendPlayerSlot({
				index: this.playerData.loadedSlot.get() ?? -1,
				touchControls,
				save: false,
			});
			if (!result.success) {
				LogControl.instance.addLine(result.message, Colors.red);
			}
		};
	}

	start(machine: ClientMachine) {
		this.keyedChildren.clear();
		machine.onDestroy(() => this.keyedChildren.clear());
		machine.occupiedByLocalPlayer.subscribe((occupied) => {
			this.setVisibleAndEnabled(occupied, "machineSeatOccupiedByPlayer");
		}, true);

		const inputType = InputController.inputType.get();

		const inputLogics = machine.getLogicInputs();
		const controls = [
			...TouchModeButtonControl.fromBlocks(inputType, inputLogics),
			//
		];

		const controlsInfo = this.playerData.slots.get()[this.playerData.loadedSlot.get() ?? -1]?.touchControls;

		let pos = 0;
		for (const control of controls) {
			this.keyedChildren.add(control.text.get(), control);

			const keycode = control.text.get() as KeyCode;

			const doload =
				controlsInfo !== undefined &&
				controlsInfo[keycode] !== undefined &&
				controlsInfo[keycode].pos[0] >= control.instance.AbsoluteSize.X / this.gui.AbsoluteSize.X &&
				controlsInfo[keycode].pos[0] <= 1 &&
				controlsInfo[keycode].pos[1] >= control.instance.AbsoluteSize.Y / this.gui.AbsoluteSize.Y &&
				controlsInfo[keycode].pos[1] <= 1;

			if (doload) {
				const kc = controlsInfo?.[keycode];
				if (kc) {
					if (kc.pos[0] <= 1) {
						// relative position
						control.instance.Position = new UDim2(kc.pos[0], 0, kc.pos[1], 0);
					} else {
						// pixel position
						control.instance.Position = new UDim2(0, kc.pos[0], 0, kc.pos[1]);
					}
				}
			} else {
				this.resetControl(control, pos);
				pos++;
			}
		}
	}
}

export type RideModeInfoControlDefinition = GuiObject & ProgressBarControlDefinition & { FormattedText: TextLabel };
export class RideModeInfoControl extends Control<RideModeInfoControlDefinition> {
	readonly slider;
	readonly text;

	constructor(gui: RideModeInfoControlDefinition, min: number, max: number, step: number) {
		super(gui);

		this.slider = this.add(new ProgressBarControl(this.gui, min, max, step));
		this.text = this.add(new FormattedLabelControl(this.gui.FormattedText));
	}
}

export type RideModeSceneDefinition = GuiObject & {
	readonly Controls: RideModeControlsDefinition;
	readonly Info: GuiObject & {
		readonly Template: RideModeInfoControlDefinition & { Title: TextLabel };
		readonly TextTemplate: RideModeInfoControlDefinition & { Title: TextLabel };
	};
};

@injectable
export class RideModeScene extends Control<RideModeSceneDefinition> {
	private readonly stopAction;
	private readonly sitAction;

	private readonly controls;
	private readonly info;

	readonly infoTemplate;
	readonly infoTextTemplate;

	private readonly logicVisible = new ObservableValue(false);

	constructor(
		gui: RideModeSceneDefinition,
		@inject readonly mode: RideMode,
		@inject private readonly playerData: PlayerDataStorage,
		@inject popupController: PopupController,
		@inject mainScreen: MainScreenLayout,
		@inject theme: Theme,
	) {
		super(gui);

		const controlsEditMode = new ObservableValue(false);
		const notControlsEditMode = controlsEditMode.fReadonlyCreateBased((b) => !b);

		this.stopAction = this.parent(new Action(() => requestMode("build")));
		this.stopAction.subCanExecuteFrom({
			ride_editcontrols: notControlsEditMode,
			ride_isntloading: LoadingController.isNotLoading,
		});
		this.parent(
			mainScreen.top.main.addButton("Stop", { iconId: 15448899035, background: "buttonNegative", width: 200 }),
		) //
			.themeButton(theme, "accent")
			.subscribeToAction(this.stopAction)
			.subscribeVisibilityFrom({ main_enabled: this.enabledState });

		this.sitAction = this.parent(new Action(() => CustomRemotes.modes.ride.teleportOnSeat.send()));
		this.sitAction.subCanExecuteFrom({
			ride_editcontrols: notControlsEditMode,
			ride_isntloading: LoadingController.isNotLoading,
		});
		this.parent(mainScreen.top.main.addButton("Sit", { iconId: 15568720419 })) //
			.subscribeToAction(this.sitAction)
			.subscribeVisibilityFrom({ main_enabled: this.enabledState });

		this.parent(mainScreen.addTopRightButton("EditControls", 18474772799))
			.addButtonAction(() => this.controls.toggleSettingsMode())
			.subscribeVisibilityFrom({
				ride_touchOnly: InputController.isTouch,
				ride_isntloading: LoadingController.isNotLoading,
				ride_enabled: this.enabledState,
			})
			.addValueOverlayChild(
				"BackgroundColor3",
				controlsEditMode.fReadonlyCreateBased((c) => (c ? theme.get("buttonActive") : undefined)),
			);

		this.parent(mainScreen.addTopRightButton("ResetControls", 15654861713))
			.addButtonAction(() =>
				popupController.showPopup(
					new ConfirmPopup("Reset the controls?", "It will be impossible to undo this action", () =>
						this.controls.resetControls(),
					),
				),
			)
			.subscribeVisibilityFrom({
				ride_editcontrols: controlsEditMode,
				ride_isntloading: LoadingController.isNotLoading,
				ride_enabled: this.enabledState,
			});

		this.parent(mainScreen.addTopRightButton("Logic", 18626718502)) //
			.addButtonAction(() => this.logicVisible.toggle())
			.subscribeVisibilityFrom({
				ride_editcontrols: notControlsEditMode,
				ride_isntloading: LoadingController.isNotLoading,
				ride_enabled: this.enabledState,
			});

		//

		this.controls = this.parent(new RideModeControls(this.gui.Controls, playerData));
		this.controls.onEnterSettingsMode.Connect(() => controlsEditMode.set(true));
		this.controls.onQuitSettingsMode.Connect(() => controlsEditMode.set(false));

		this.info = this.parent(new ComponentChildren<Control>().withParentInstance(this.gui.Info));

		this.infoTemplate = this.asTemplate(this.gui.Info.Template);
		this.infoTextTemplate = this.asTemplate(this.gui.Info.TextTemplate);
	}

	private addMeters(machine: Component & { readonly blocks: ReadonlyComponentChildren<GenericBlockLogic> }) {
		this.info.clear();
		const s2m = GameDefinitions.STUDS_TO_METERS;
		const s2mi = GameDefinitions.STUDS_TO_MILES;
		const s2kmh = GameDefinitions.STUDS_TO_KMH;

		const init = (
			title: string,
			textformat: string,
			gui: RideModeInfoControlDefinition & { Title: TextLabel },
			min: number,
			max: number,
			step: number,
			update: (control: RideModeInfoControl) => void,
		) => {
			gui.Title.Text = title.upper();
			gui.FormattedText!.Text = textformat;

			const control = new RideModeInfoControl(gui, min, max, step);
			control.event.subscribe(RunService.PostSimulation, () => update(control));
			this.info.add(control);
		};

		{
			const targetSpeed = this.playerData.config.get().interface.units.targetSpeed ?? 800;
			const setting = this.playerData.config.get().interface.units.speed;
			let format = (v: number): string => `${v}`;
			switch (setting) {
				case "Studs/s":
					format = (v: number) => `${Strings.prettyKMB(MathUtils.round(v, 0.1))} st/s`;
					break;
				case "m/s":
					format = (v: number) => `${Strings.prettyKMB(MathUtils.round(v * s2m, 0.1))} m/s`;
					break;
				case "km/h":
					format = (v: number) => `${Strings.prettyKMB(math.floor(v * s2kmh))} km/h`;
					break;
				case "MPH":
					format = (v: number) => `${Strings.prettyKMB(math.floor(v * s2mi * 60 * 60))} MPH`;
					break;
				case "Mach":
					format = (v: number) => `Mach ${Strings.prettyKMB((v * s2m) / 343)}`;
					break;
			}

			init("Speed", "%s", this.infoTemplate(), 0, targetSpeed, 0.1, (control) => {
				const rootPart = LocalPlayer.rootPart.get();
				if (!rootPart) return;

				const spd = rootPart.GetVelocityAtPosition(rootPart.Position).Magnitude;

				control.slider.value.set(spd);
				control.text.value.set(format(spd));
			});
		}

		{
			const rocketClass = RocketBlocks[0]!.logic!.ctor; // maybe add support for jet engines too

			const rockets = machine.blocks
				.getAll()
				.filter((c) => c instanceof rocketClass) as unknown as readonly RocketBlockLogic[];
			if (rockets.size() !== 0) {
				init("Thrust", "%s %%", this.infoTemplate(), 0, 100, 1, (control) => {
					let avgg = 0;
					let amount = 0;
					for (const rocket of rockets) {
						if (!rocket.isEnabled()) continue;

						avgg += rocket.getThrust();
						amount++;
					}

					control.slider.value.set(amount === 0 ? 0 : avgg / amount);
					control.text.value.set(math.round(control.slider.value.get()));
				});
			}
		}

		{
			const setting = this.playerData.config.get().interface.units.altitude;
			let format = (v: number): string => `${v}`;
			switch (setting) {
				case "Studs":
					format = (v: number) => `${Strings.prettyKMB(v)} st`;
					break;
				case "Meters":
					format = (v: number) => `${Strings.prettyKMB(v * s2m)} m`;
					break;
				case "Kilometers":
					format = (v: number) => `${Strings.prettyKMB((v * s2m) / 1000)} km`;
					break;
				case "Feet":
					format = (v: number) => `${Strings.prettyKMB(math.floor(v * GameDefinitions.STUDS_TO_FEET))} ft`;
					break;
			}

			const maxAltitude = 420;
			init("Altitude", "%s", this.infoTextTemplate(), 0, maxAltitude, 0.1, (control) => {
				const rootPart = LocalPlayer.rootPart.get();
				if (!rootPart) return;

				const alt = LocalPlayerController.getPlayerRelativeHeight();
				control.slider.value.set(alt);
				control.text.value.set(format(alt));
			});
		}

		{
			const setting = this.playerData.config.get().interface.units.gravity;
			let format = "%.1f st²";
			let multiplier = 1;
			switch (setting) {
				case "Studs/s²":
					format = "%.1f st²";
					multiplier = 1;
					break;
				case "Meters/s²":
					format = "%.1f m²";
					multiplier = s2m;
					break;
			}

			init("Gravity", format, this.infoTextTemplate(), 0, 55, 0.1, (control) => {
				const alt = Workspace.Gravity * multiplier;

				control.text.value.set(alt);
			});
		}

		{
			const setting = this.playerData.config.get().interface.units.position;
			let format = (v: number): number => 0;
			let unit = "";
			switch (setting) {
				case "Studs":
					format = (v: number) => math.floor(v);
					break;
				case "Meters":
					format = (v) => math.floor(v * s2m);
					unit = "(m)";
					break;
				case "Kilometers":
					format = (v) => math.floor((v * s2m) / 10) / 100;
					unit = "(km)";
					break;
				case "Miles":
					format = (v) => math.floor(v * s2mi * 100) / 100;
					unit = "(mi)";
					break;
			}

			init(`Position ${unit}`, "%s", this.infoTextTemplate(), 0, 1, 1, (control) => {
				const rootPart = LocalPlayer.rootPart.get();
				if (!rootPart) return;

				const x = Strings.prettyKMB(format(rootPart.Position.X));
				const z = Strings.prettyKMB(format(rootPart.Position.Z));
				control.text.value.set(`${x} ${z}`);
			});
		}

		{
			const startTime = DateTime.now();
			const pretty = (ms: number) => {
				return `${math.floor(ms / 1000 / 60 / 60)}h ${math.floor(ms / 1000 / 60) % 60}m ${
					math.floor(ms / 1000) % 60
				}s`;
			};

			init("Time", "%s", this.infoTextTemplate(), 0, 1, 1, (control) => {
				control.text.value.set(
					pretty(
						DateTime.fromUnixTimestampMillis(
							DateTime.now().UnixTimestampMillis - startTime.UnixTimestampMillis,
						).UnixTimestampMillis,
					),
				);
			});
		}

		{
			//Beacon Block (Workaround)
			const beaconBlockClass = BeaconBlock!.logic!.ctor;

			const beacons = machine.blocks
				.getAll()
				.filter((c) => c instanceof beaconBlockClass) as unknown as readonly BeaconBlockLogic[];

			for (const beacon of beacons) {
				beacon.beaconInstance = new ManualBeacon(beacon.definition.input.text.displayName);
				beacon.updateData(beacon.definition.input.text.displayName, true);
			}
		}
	}

	addMeter(gui: RideModeInfoControlDefinition & { Title: TextLabel }) {
		const control = new RideModeInfoControl(gui, 0, 1, 0);
		this.info.add(control);

		return control;
	}

	private initLogicController(machine: ClientMachine, runLogic: boolean) {
		const component = this.current.set(new Component());

		const template = Interface.getInterface<{
			Floating: {
				LogicDebug: GuiObject & {
					readonly Visualizer: GuiObject & {
						readonly Control: CheckBoxControlDefinition;
					};
					readonly Content: GuiObject & {
						readonly Pause: TextButtonDefinition & {
							readonly ImageLabel: ImageLabel;
						};
						readonly Step: GuiButton;
					};
				};
			};
		}>().Floating.LogicDebug;
		const logicDebugGui = template.Clone();

		const logicDebug = component.parent(new Control(logicDebugGui));
		logicDebug.instance.Parent = template.Parent;

		this.logicVisible.set(!runLogic);
		const sub = this.logicVisible.subscribe((v) => (logicDebugGui.Visible = v), true);
		logicDebug.onDestroy(() => sub.Disconnect());

		const visualizer = component.parent(new ComponentChild(true));
		const vcb = logicDebug.add(new CheckBoxControl(logicDebug.instance.Visualizer.Control));
		vcb.value.subscribe((c) => {
			if (c) {
				visualizer.set(machine.createVisualizer());
			} else {
				visualizer.clear();
			}
		});

		logicDebug.add(new Control(logicDebug.instance.Content.Step).addButtonAction(() => machine.runner.tick()));

		const pauseButton = logicDebug.add(new Control(logicDebug.instance.Content.Pause));
		pauseButton.parent(
			new Control(pauseButton.instance).addButtonAction(() => {
				if (machine.runner.isRunning.get()) {
					machine.runner.stopTicking();
					machine.logicInputs.setEnabled(false);
				} else {
					machine.runner.startTicking();
					machine.logicInputs.setEnabled(true);
				}
			}),
		);

		component.event.subscribeObservable(
			machine.runner.isRunning,
			(running) => {
				pauseButton.setButtonText(running ? "PAUSE" : "RESUME");
				pauseButton.instance.ImageLabel.Image = running
					? "rbxassetid://18627572768"
					: "rbxassetid://15266883073";
			},
			true,
		);
	}

	private readonly current = this.parent(new ComponentChild(true));

	start(machine: ClientMachine, runLogic: boolean) {
		if (InputController.inputType.get() === "Touch") {
			this.controls.start(machine);
		}

		this.sitAction.canExecute.and(
			"canNotSitIfNoSeat",
			machine.blocks.getAll().any((b) => b instanceof VehicleSeatBlock.logic.ctor),
		);

		this.addMeters(machine);
		this.initLogicController(machine, runLogic);
	}
}
