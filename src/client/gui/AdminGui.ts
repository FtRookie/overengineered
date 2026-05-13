import { Players } from "@rbxts/services";
import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { SavePopup } from "client/gui/popup/SavePopup";
import { Content, Sidebar } from "client/gui/popup/SettingsPopup";
import { PlayerDataStorage } from "client/PlayerDataStorage";
import { BuildingDiffer } from "client/tutorial2/BuildingDiffer";
import { TestTutorial } from "client/tutorial2/tutorials/TestTutorial";
import { TutorialStarter } from "client/tutorial2/TutorialStarter";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { InputController } from "engine/client/InputController";
import { HostedService } from "engine/shared/di/HostedService";
import { Element } from "engine/shared/Element";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Objects } from "engine/shared/fixes/Objects";
import { PlayerRank } from "engine/shared/PlayerRank";
import { CustomRemotes } from "shared/Remotes";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { SettingsPopup2Definition } from "client/gui/popup/SettingsPopup";
import type { PopupController } from "client/gui/PopupController";
import type { PlayModeController } from "client/modes/PlayModeController";
import type { TutorialsService } from "client/tutorial/TutorialService";
import type { GameHost } from "engine/shared/GameHost";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";
import type { Switches } from "engine/shared/Switches";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";

@injectable
export class AdminGui extends HostedService {
	static initializeIfAdminOrStudio(host: GameHostBuilder) {
		if (!PlayerRank.isAdmin(Players.LocalPlayer)) return;
		host.services.registerService(this);
	}

	constructor(@inject di: DIContainer, @inject popupController: PopupController) {
		super();

		const hideUnhide = () => {
			popupController.showPopup(new AdminPopup());
		};

		// samlovebutter
		const mobileGui = Element.create("ScreenGui", {
			Name: "AdminMobile",
			IgnoreGuiInset: true,
			Parent: Interface.getPlayerGui(),
		});
		const mobileButton = Element.create("TextButton", {
			Position: new UDim2(1, 0, 0, 0),
			Size: new UDim2(0, 40, 0, 20),
			Text: "samlovebutter",
			AnchorPoint: new Vector2(1, 0),
		});
		mobileButton.Activated.Connect(hideUnhide);
		mobileButton.Parent = mobileGui;

		this.event.onInputBegin((input) => {
			if (input.UserInputType !== Enum.UserInputType.Keyboard) return;
			if (input.KeyCode !== Enum.KeyCode.F7) return;
			if (!InputController.isShiftPressed()) return;
			hideUnhide();
		});
	}
}

const template = Interface.getInterface<{ Popups: { Crossplatform: { Settings: SettingsPopup2Definition } } }>().Popups
	.Crossplatform.Settings;
template.Visible = false;

export class AdminPopup extends Control<SettingsPopup2Definition> {
	constructor() {
		const gui = template.Clone();
		super(gui);

		this.$onInjectAuto((playerData: PlayerDataStorage, playModeController: PlayModeController) => {
			const original = playerData.config.get();

			const mode = playModeController.get();

			const content = this.parent(new Content(gui.Content.Content, playerData.config));
			const sidebar = this.parent(new Sidebar(gui.Content.Sidebar.ScrollingFrame));

			sidebar.addButton("Toggles", 18627409276, () => content.set(DeveloperSwitchesTab));
			sidebar
				.addButton("Manage Data", 18627409276, () => content.set(DeveloperManageDataTab))
				.setButtonInteractable(mode === "build"); // Only because you can load saves while in Ride Mode
			sidebar
				.addButton("Tutorial", 98943721557973, () => content.set(DeveloperTutorialTab))
				.setButtonInteractable(mode === "build");

			this.onEnable(() => content.set(DeveloperTutorialTab));

			this.onDestroy(() => {
				const unchanged = Objects.deepEquals(original, playerData.config.get());
				if (unchanged) return;

				task.spawn(() => {
					playerData.sendPlayerConfig(playerData.config.get());
				});
			});

			this.parent(new Control(gui.Heading.CloseButton)) //
				.addButtonAction(() => this.hideThenDestroy());
		});
	}
}

class DeveloperSwitchesTab extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);
		this.$onInjectAuto((adminPopup: AdminPopup, di: DIContainer) => {
			this.addCategory("Logs");
			{
				for (const [k, v] of asMap(di.resolve<Switches>().registered)) {
					const btn = this.addToggle(k) //
						.initToObservable(v);
				}
			}
		});
	}
}

class DeveloperManageDataTab extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);
		this.$onInjectAuto((adminPopup: AdminPopup, di: DIContainer) => {
			const pid = new ObservableValue("238427763");
			const getNumberID = (idOrName: string) => tonumber(idOrName) ?? Players.GetUserIdFromNameAsync(idOrName);

			this.addString("Target Player") //
				.setDescription("Player ID or Username")
				.initToObservable(pid);

			this.addCategory("Player Data");
			{
				this.addButton("Load from External and Set", () => {
					const val = pid.get();
					CustomRemotes.admin.adminUpdateMeta.send({ plrID: getNumberID(val) });
				}).button.setButtonText("Submit");
			}
			this.addCategory("Save Data");
			{
				this.addButton("Show Slots", () => {
					adminPopup.destroy();
					const val = pid.get();
					const pds = PlayerDataStorage.forPlayer(getNumberID(val));
					const scope = di.beginScope((builder) => {
						builder.registerSingletonValue(pds);
					});

					const popup = scope.resolveForeignClass(SavePopup);
					const wrapper = new Control(popup.instance);
					wrapper.cacheDI(pds);
					wrapper.parent(popup);
					popup.onDisable(() => {
						wrapper.destroy();
					});

					scope.resolve<PopupController>().showPopup(wrapper);
				}).button.setButtonText("Load");
			}
			this.addCategory("Migrate");
			{
				const fromV = new ObservableValue("238427763");
				const toV = new ObservableValue("10897692300");

				this.addString("From ID") //
					.setDescription("The player to copy data from")
					.initToObservable(fromV);

				this.addString("To ID") //
					.setDescription("The player receiving the data ⚠️ existing entries will be wiped")
					.initToObservable(toV);

				const submit = this.addButton("Submit", () => {
					CustomRemotes.admin.adminMigrateRequest.send({
						from: getNumberID(fromV.get()),
						to: getNumberID(toV.get()),
					});
				});
				CustomRemotes.admin.adminMigrateReply.invoked.Connect((arg) => {
					const toEmoji = (response: "SUCCESS" | "FAIL") => {
						if (response === "SUCCESS") return "✅";
						return "❌";
					};
					submit.button.setButtonText(`Meta: ${toEmoji(arg.metadata)} Saves:${toEmoji(arg.saves)}`);
				});
			}
		});
	}
}

class DeveloperTutorialTab extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		this.$onInjectAuto((adminPopup: AdminPopup, di: DIContainer) => {
			this.addCategory("Tutorial");
			{
				this.addButton("Set BEFORE", () => BuildingDiffer.setBefore(di.resolve<ReadonlyPlot>()));
				this.addButton("Print DIFF", () =>
					print(BuildingDiffer.serializeDiffToTsCode(di.resolve<ReadonlyPlot>())),
				);
				this.addButton("Print FULL", () =>
					print(BuildingDiffer.serializePlotToTsCode(di.resolve<ReadonlyPlot>())),
				);
				for (const tutorial of di.resolve<TutorialsService>().allTutorials) {
					this.addButton(`run '${tutorial.name}'`, () => {
						adminPopup.destroy();
						task.spawn(() => di.resolve<TutorialsService>().run(tutorial));
					});
				}
				this.addButton("[2] Run TestTutorial", () => {
					const stepController = new TutorialStarter();
					TestTutorial.start(stepController, true);
					di.resolve<GameHost>().parent(stepController);
				});
			}
		});
	}
}
