import { GuiService, StarterGui } from "@rbxts/services";
import { BuildingMode } from "client/modes/build/BuildingMode";
import { requestMode } from "client/modes/PlayModeRequest";
import { RideMode } from "client/modes/ride/RideMode";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { HostedService } from "engine/shared/di/HostedService";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { CustomRemotes } from "shared/Remotes";
import type { PopupController } from "client/gui/PopupController";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";

@injectable
export class PlayModeController extends HostedService {
	readonly playmode = new ObservableValue<PlayModes | undefined>(undefined);
	private readonly modes;

	static initialize(host: GameHostBuilder) {
		host.services.registerSingletonClass(BuildingMode);
		host.services.registerSingletonClass(RideMode);
		host.services.registerService(PlayModeController);
	}
	constructor(@inject build: BuildingMode, @inject ride: RideMode, @inject popupController: PopupController) {
		super();

		GuiService.SetGameplayPausedNotificationEnabled(false);
		StarterGui.SetCoreGuiEnabled(Enum.CoreGuiType.Backpack, false);

		CustomRemotes.modes.setOnClient.subscribe((mode) => {
			this.playmode.set(mode);
			return { success: true };
		});

		this.modes = {
			build,
			ride,
		} as const;

		for (const [_, mode] of pairs(this.modes)) {
			this.parentDestroyOnly(mode);
			mode.disable();
		}

		// TODO: !!important!! this commented code disables the current play mode upon opening any popup, which is usually fine but not always
		// for example, the config tool does not like being disabled when it's the one who opened the popup (byte array editor for example)
		// i see no other way of fixing this right now, so this code is disabled
		// i don't know whether it's fine to disable this or not, so testing required

		// this.event.subscribeObservable(popupController.isShown, (shown) => {
		// 	const active = this.playmode.get();
		// 	if (active) this.modes[active].setEnabled(!shown);
		// });

		this.event.subscribeObservablePrev(this.playmode, (mode, prev) => {
			this.callImmediateSetMode(mode, prev);
			this.setMode(mode, prev);
		});
		this.event.subscribe(LocalPlayer.diedEvent, () => this.setMode(undefined, this.playmode.get()));

		this.setMode(this.playmode.get(), undefined);

		this.onEnable(() => {
			task.spawn(() => requestMode("build"));
			LocalPlayer.spawnEvent.Connect(() => task.spawn(() => requestMode("build")));
		});
	}

	get(): PlayModes | undefined {
		return this.playmode.get();
	}

	private callImmediateSetMode(mode: PlayModes | undefined, prev: PlayModes | undefined) {
		if (prev) {
			this.modes[prev].onImmediateSwitchToNext(mode);
		}

		if (mode) {
			this.modes[mode].onImmediateSwitchFromPrev(prev);
		}
	}
	private setMode(mode: PlayModes | undefined, prev: PlayModes | undefined) {
		if (mode === prev) return;

		if (prev) {
			this.modes[prev].onSwitchToNext(mode);
			this.modes[prev].disable();
		}
		if (mode) {
			this.modes[mode].onSwitchFromPrev(prev);
			this.modes[mode].enable();
		}
	}
}
