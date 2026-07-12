import { ReplicatedStorage, StarterGui, UserInputService } from "@rbxts/services";
import { Anim } from "client/gui/Anim";
import { ButtonControl } from "engine/client/gui/Button";
import { Interface } from "engine/client/gui/Interface";
import { HostedService } from "engine/shared/di/HostedService";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { SharedPlots } from "shared/building/SharedPlots";

@injectable
export class HideInterfaceController extends HostedService {
	readonly visible = new ObservableValue(true);

	private readonly guis = [Interface.getUnscaled(), Interface.getInterface()] as const;
	private currentUnhideScreen?: ScreenGui;

	constructor(@inject mainScreen: MainScreenLayout, @inject plots: SharedPlots) {
		super();

		this.event.subscribeObservable(this.visible, (visible) => {
			if (visible) {
				this.currentUnhideScreen?.Destroy();
				this.currentUnhideScreen = undefined;
			}
		});

		this.event.subscribe(UserInputService.InputBegan, (input) => {
			if (input.UserInputType !== Enum.UserInputType.Keyboard) {
				return;
			}

			if (UserInputService.GetFocusedTextBox()) {
				return;
			}

			if (!input.IsModifierKeyDown("Shift") || !UserInputService.IsKeyDown(Enum.KeyCode.G)) {
				return;
			}

			this.visible.set(!this.visible.get());
		});

		this.visible.subscribe((visible) => {
			// hide screen guis
			for (const ui of this.guis) {
				ui.Enabled = visible;
			}

			// Hide core gui (excluding backpack)
			StarterGui.SetCoreGuiEnabled(Enum.CoreGuiType.All, visible);
			StarterGui.SetCoreGuiEnabled(Enum.CoreGuiType.Backpack, false);

			// Plot owner gui hide
			plots.plots.forEach((plot) => {
				const ownerGui = plot.instance.FindFirstChild(ReplicatedStorage.Assets.Guis.PlotOwnerGui.Name) as
					| BillboardGui
					| undefined;
				if (ownerGui) {
					ownerGui.Enabled = visible;
				}
			});
		});

		const hideButton = this.parentGui(mainScreen.addTopRightButton("Hide", 18887954146));
		this.parent(
			new ButtonControl(hideButton.instance, () => {
				this.currentUnhideScreen = this.createUnhideGui(hideButton.instance);
				this.visible.set(false);
			}),
		);
	}

	private createUnhideGui(button: GuiButton): ScreenGui {
		const [screen, ghost] = Anim.createScreenForAnimating(button);
		ghost.Transparency = 0.8;

		new ButtonControl(ghost, () => this.visible.set(true)).enable();
		return screen;
	}
}
