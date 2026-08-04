import { Players } from "@rbxts/services";
import { FlyController } from "client/controller/FlyController";
import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { SavePopup } from "client/gui/popup/SavePopup";
import { Content, Sidebar } from "client/gui/popup/SettingsPopup";
import { LogControl } from "client/gui/static/LogControl";
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
import { Strings } from "engine/shared/fixes/String.propmacro";
import { PlayerRank } from "engine/shared/PlayerRank";
import { Colors } from "shared/Colors";
import { CustomRemotes } from "shared/Remotes";
import { TestFramework } from "shared/test/TestFramework";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { SettingsPopup2Definition } from "client/gui/popup/SettingsPopup";
import type { Popup, PopupController } from "client/gui/PopupController";
import type { PlayModeController } from "client/modes/PlayModeController";
import type { TutorialsService } from "client/tutorial/TutorialService";
import type { Component } from "engine/shared/component/Component";
import type { GameHost } from "engine/shared/GameHost";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";
import type { Switches } from "engine/shared/Switches";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";
import type { AnnouncementDisplay } from "shared/Remotes";

const getNumberID = (idOrName: string) => tonumber(idOrName) ?? Players.GetUserIdFromNameAsync(idOrName);

// Spawned because the remote yields for the round trip, and a button handler should not hold the UI thread
// for it. The server answers rather than announcing: only the client can raise a toast.
const join = (jobId: string) =>
	task.spawn(() => {
		const result = CustomRemotes.admin.adminJoinServer.send(jobId);
		if (result.success) return;

		LogControl.instance.addLine(result.message, Colors.red);
	});

@injectable
export class ShowAdminGui extends HostedService {
	static initializeIfAdminOrStudio(host: GameHostBuilder) {
		if (!PlayerRank.isDev(Players.LocalPlayer) && !PlayerRank.isMod(Players.LocalPlayer)) return;
		host.services.registerService(this);
		host.services.registerService(FlyController);
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
	private content?: Content;

	rebuild<T extends GuiObject>(
		clazz: ConstructorOf<Component, [T & ConfigControlTemplateList, ObservableValue<PlayerConfig>]>,
	): void {
		this.content?.set(undefined);
		this.content?.set(clazz);
	}

	constructor() {
		const gui = template.Clone();
		super(gui);

		this.$onInjectAuto((playerData: PlayerDataStorage, playModeController: PlayModeController) => {
			const mode = playModeController.get();

			const content = this.parent(new Content(gui.Content.Content, playerData.config));
			const sidebar = this.parent(new Sidebar(gui.Content.Sidebar.ScrollingFrame));
			this.content = content;

			const isDev = PlayerRank.isDev(Players.LocalPlayer);
			const isMod = PlayerRank.isMod(Players.LocalPlayer);

			sidebar
				.addButton("Announcement", 3209694600, () => content.set(DeveloperAnnouncementTab))
				.setButtonInteractable(isMod || isDev);
			sidebar
				.addButton("Moderation", 73572164006663, () => content.set(DeveloperModerationTab))
				.setButtonInteractable(isMod);
			sidebar
				.addButton("Servers", 9692125126, () => content.set(DeveloperServersTab))
				.setButtonInteractable(isDev || isMod);
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
			sidebar.addButton("Tests", 18627409276, () => content.set(DeveloperTestsTab)).setButtonInteractable(isDev);

			this.onEnable(() => content.set(isMod ? DeveloperModerationTab : DeveloperManageDataTab));

			this.parent(new Control(gui.Heading.CloseButton)) //
				.addButtonAction(() => this.hideThenDestroy());
		});
	}
}

class DeveloperAnnouncementTab extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		const msgv = new ObservableValue<string>("");
		const displayv = new ObservableValue<AnnouncementDisplay>("both");
		const ttlv = new ObservableValue<number>(60);
		const allv = new ObservableValue<boolean>(false);

		this.addCategory("Announcement");
		{
			this.addString("Message") //
				.setDescription("Message to be displayed, avoid profanity.")
				.initToObservable(msgv);
			this.addSwitch<AnnouncementDisplay>("Display", [
				["chat", { name: "Chat", description: "System message in chat" }],
				["popup", { name: "Popup", description: "Warning Popup" }],
				["both", { name: "Both", description: "System Message and Popup" }],
			]).initToObservable(displayv);
			this.addSlider("Duration", { min: 0, max: 3600, step: 5 })
				.setDescription("Seconds it keeps showing to players who join late. 0 shows it once")
				.initToObservable(ttlv);
			this.addToggle("Send to All")
				.setDescription("When true, announces to all servers and not just this one")
				.initToObservable(allv);
			this.addButton("Announce", () => {
				CustomRemotes.admin.adminAnnounce.send({
					payload: {
						text: msgv.get(),
						display: displayv.get(),
						ttl: ttlv.get(),
					},
					all: allv.get(),
				});
			}).button.setButtonText("Announce");
		}
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

class DeveloperServersTab extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);
		this.$onInjectAuto((adminPopup: AdminPopup) => {
			const jobId = new ObservableValue<string>("");

			this.addCategory("Join by Job ID");
			{
				this.addString("Target Server") //
					.setDescription("Job id of a public server; private and reserved servers cannot be joined")
					.initToObservable(jobId);
				this.addButton("Join Server", () => join(jobId.get())) //
					.button.setButtonText("Join");
			}

			this.addCategory("Live Servers");
			{
				this.addButton("Refresh", () => adminPopup.rebuild(DeveloperServersTab)) //
					.setDescription("Peers appear within one announce interval of starting up")
					.button.setButtonText("Refresh");

				// The roster arrives over a remote function, so the rows are appended once it answers rather
				// than blocking the tab's construction on the round trip.
				task.spawn(() => {
					const result = CustomRemotes.admin.adminServerList.send(undefined);
					if (this.isDestroyed()) return;

					if (!result.success) {
						this.addLine(`Could not fetch the roster: ${result.message}`);
						return;
					}

					for (const server of result.servers) {
						const isSelf = server.jobId === game.JobId;
						const row = this.addButton(server.jobId, () => join(server.jobId));

						row.setDescription(
							isSelf ? "This server" : `Announced ${Strings.prettySecondsAgo(server.secondsAgo)}`,
						);
						row.button.setButtonText(isSelf ? "Current" : "Join");
						if (isSelf) row.button.setButtonInteractable(false);
					}
				});
			}
		});
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

				const fly = di.tryResolve<FlyController>();
				if (fly) {
					this.addToggle("Fly / Noclip")
						.setDescription(
							"Noclip flight, passes through everything. WASD and E/Q move, Shift accelerates, Ctrl slows",
						)
						.initToObservable(fly.enabled);
				}
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
			this.addCategory("Player Data");
			{
				this.addButton("Load and Set", () => {
					const val = pid.get();
					CustomRemotes.admin.adminUpdateMeta.send({ plrID: getNumberID(val) });
				}).button.setButtonText("Submit");
			}
			this.addCategory("Block Limits");
			{
				const blockIdv = new ObservableValue<string>("luacircuit");
				const limitv = new ObservableValue<number>(1);

				this.addString("Block ID") //
					.setDescription("Overrides that block's global limit for this player only")
					.initToObservable(blockIdv);
				this.addNumber("Limit", 0, undefined, undefined) //
					.setDescription("How many they may place")
					.initToObservable(limitv);

				this.addButton("Grant", () => {
					CustomRemotes.admin.adminGrantBlock.send({
						plrID: getNumberID(pid.get()),
						blockId: blockIdv.get(),
						limit: limitv.get(),
					});
				}).button.setButtonText("Grant");
				this.addButton("Remove", () => {
					CustomRemotes.admin.adminGrantBlock.send({
						plrID: getNumberID(pid.get()),
						blockId: blockIdv.get(),
					});
				}).button.setButtonText("Remove");
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

class DeveloperTestsTab extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		// Every other tab has a designed row count; this one grows with however many tests exist, so it is the
		// only one that can outgrow the template's canvas.
		gui.AutomaticCanvasSize = Enum.AutomaticSize.Y;
		gui.ScrollingEnabled = true;

		this.$onInjectAuto((di: DIContainer) => {
			const tests = TestFramework.findAllTests();

			this.addCategory(`Tests (${tests.size()})`);
			for (const { label, run } of tests) {
				this.addButton(label, () => run(di)).button.setButtonText("Run");
			}
		});
	}
}
