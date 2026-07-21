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
import { PlayerRank } from "engine/shared/PlayerRank";
import { CustomRemotes } from "shared/Remotes";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { SettingsPopup2Definition } from "client/gui/popup/SettingsPopup";
import type { Popup, PopupController } from "client/gui/PopupController";
import type { PlayModeController } from "client/modes/PlayModeController";
import type { TutorialsService } from "client/tutorial/TutorialService";
import type { GameHost } from "engine/shared/GameHost";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";
import type { Switches } from "engine/shared/Switches";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";
import type { AnnouncementDisplay } from "shared/Remotes";

const getNumberID = (idOrName: string) => tonumber(idOrName) ?? Players.GetUserIdFromNameAsync(idOrName);

@injectable
export class ShowAdminGui extends HostedService {
	static initializeIfAdminOrStudio(host: GameHostBuilder) {
		if (!PlayerRank.isDev(Players.LocalPlayer) && !PlayerRank.isMod(Players.LocalPlayer)) return;
		host.services.registerService(this);
	}
	avatarMimic = new ObservableValue<boolean>(true);
	useExternal = new ObservableValue<boolean>(false);

	constructor(@inject popupController: PopupController) {
		super();

		let state = false;
		let popup: Popup;
		const hideUnhide = () => {
			state = !state;
			if (state) {
				popup = popupController.showPopup(new AdminPopup());
			} else {
				popup.destroy();
			}
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
			const mode = playModeController.get();

			const content = this.parent(new Content(gui.Content.Content, playerData.config));
			const sidebar = this.parent(new Sidebar(gui.Content.Sidebar.ScrollingFrame));

			const isDev = PlayerRank.isDev(Players.LocalPlayer);
			const isMod = PlayerRank.isMod(Players.LocalPlayer);

			sidebar
				.addButton("Moderation", 73572164006663, () => content.set(DeveloperModerationTab))
				.setButtonInteractable(isMod);
			sidebar
				// fixme: placeholder icon (reused Moderation id); swap for a proper announcement icon
				.addButton("Announcement", 73572164006663, () => content.set(DeveloperAnnouncementTab))
				.setButtonInteractable(isMod || isDev);
			sidebar
				.addButton("Toggles", 18627409276, () => content.set(DeveloperSwitchesTab))
				.setButtonInteractable(isDev);
			sidebar
				.addButton("Manage Data", 18627409276, () => content.set(DeveloperManageDataTab))
				.setButtonInteractable(isDev && mode === "build"); // Only because you can load saves while in Ride Mode
			sidebar
				.addButton("Tutorial", 98943721557973, () => content.set(DeveloperTutorialTab))
				.setButtonInteractable(mode === "build")
				.setButtonInteractable(isDev);

			this.onEnable(() => content.set(isMod ? DeveloperModerationTab : DeveloperManageDataTab));

			this.parent(new Control(gui.Heading.CloseButton)) //
				.addButtonAction(() => this.hideThenDestroy());
		});
	}
}

class DeveloperModerationTab extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);
		this.$onInjectAuto((adminPopup: AdminPopup, di: DIContainer) => {
			const pid = new ObservableValue<string>("19823479");
			const durationv = new ObservableValue<number>(0);
			const dreasonv = new ObservableValue<string>("No reason was given");
			const preasonv = new ObservableValue<string>("No reason was given");

			this.addCategory("Moderation");
			{
				const target = this.addString("Target Player") //
					.setDescription("Player ID or Username")
					.initToObservable(pid);
				this.addNumber("Duration", -1, undefined, undefined) //
					.setDescription("-1 = forever, given in seconds")
					.initToObservable(durationv);
				this.addString("Display Reason") //
					.setDescription("Reason shown to player")
					.initToObservable(dreasonv);
				this.addString("Private Reason") //
					.setDescription("Record keeping")
					.initToObservable(preasonv);

				this.addButton("Kick", () => {
					CustomRemotes.admin.adminKickPlayer.send({
						plrID: getNumberID(pid.get()),
						displayReason: dreasonv.get(),
						privateReason: preasonv.get(),
					});
				}).button.setButtonText("Kick");
				this.addButton("Ban", () => {
					CustomRemotes.admin.adminBanPlayer.send({
						plrID: getNumberID(pid.get()),
						duration: durationv.get(),
						displayReason: dreasonv.get(),
						privateReason: preasonv.get(),
					});
				}).button.setButtonText("Ban");
			}
		});
	}
}

class DeveloperAnnouncementTab extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		const msgv = new ObservableValue<string>("");
		const displayv = new ObservableValue<AnnouncementDisplay>("both");

		this.addCategory("Announcement");
		{
			this.addString("Message") //
				.setDescription("Broadcast to every server")
				.initToObservable(msgv);
			this.addSwitch<AnnouncementDisplay>("Display", [
				["chat", { name: "Chat", description: "System message in chat" }],
				["popup", { name: "Popup", description: "Popup dialog" }],
				["both", { name: "Both", description: "Chat + popup" }],
			]).initToObservable(displayv);
			this.addButton("Announce", () => {
				CustomRemotes.admin.adminAnnounce.send({ text: msgv.get(), display: displayv.get() });
			}).button.setButtonText("Announce");
		}
	}
}
class DeveloperSwitchesTab extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);
		this.$onInjectAuto((adminGui: ShowAdminGui, di: DIContainer) => {
			this.addCategory("Logs");
			{
				for (const [k, v] of asMap(di.resolve<Switches>().registered)) {
					const btn = this.addToggle(k) //
						.initToObservable(v);
				}
			}
			this.addCategory("Other");
			{
				this.addToggle("Always save to external") //
					.setDescription("Toggles whether or not saves are saved to external as well")
					.initToObservable(adminGui.useExternal);
				this.addToggle("Avatar Mimic")
					.setDescription("Toggle replacing your avatar with your original account's")
					.initToObservable(adminGui.avatarMimic);
			}
			this.event.subscribeObservable(adminGui.avatarMimic, (s) => CustomRemotes.admin.adminToggleMimic.send(s));
		});
	}
}

class DeveloperManageDataTab extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);
		this.$onInjectAuto((adminPopup: AdminPopup, di: DIContainer) => {
			const pid = new ObservableValue<string>("238427763");
			const SAFETYLOCK = new ObservableValue<boolean>(false);

			const target = this.addString("Target Player") //
				.setDescription("Player ID or Username")
				.initToObservable(pid);
			pid.subscribe((v) => {
				target.setValues({ value: `${getNumberID(v)}` });
			});

			this.addCategory("Player Data");
			{
				this.addButton("Load and Set", () => {
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
			this.addCategory("");
			this.addCategory("⚠️ I KNOW WHAT IM DOING ⚠️");
			this.addToggle("sudo").initToObservable(SAFETYLOCK);
			const wipe = this.addButton("Wipe Meta", () => {
				if (!SAFETYLOCK.get()) return;
				const val = pid.get();
				CustomRemotes.admin.adminWipeData.send(getNumberID(val));
			})
				.setDescription(
					"Cuts the target off from their saves: clears their slot list so nothing shows up in game. " +
						"The builds themselves are NOT deleted and come back if the list is restored",
				)
				.button.setButtonText("DEATH");
			wipe.setVisibleAndEnabled(false);

			SAFETYLOCK.subscribe((v) => wipe.setVisibleAndEnabled(v));
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
