import { Players, UserService } from "@rbxts/services";
import { ConfigControlSwitch } from "client/gui/configControls/ConfigControlSwitch";
import { ToggleControl } from "client/gui/controls/ToggleControl";
import { AlertPopup } from "client/gui/popup/AlertPopup";
import { TextCopyPopup } from "client/gui/popup/TextCopyPopup";
import { LogControl } from "client/gui/static/LogControl";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { PartialControl } from "engine/client/gui/PartialControl";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { BlurController } from "client/controller/BlurController";
import type { ConfigControlSwitchDefinition } from "client/gui/configControls/ConfigControlSwitch";
import type { ToggleControlDefinition } from "client/gui/controls/ToggleControl";
import type { PopupController } from "client/gui/PopupController";
import type { ExportError } from "server/database/SlotDatabase";

const template = Interface.getInterface<{
	Popups: { Crossplatform: { SlotExport: GuiObject } };
}>().Popups.Crossplatform.SlotExport;
template.Visible = false;

type AllowlistTemplate = Frame & {
	TextButton: TextButton & {
		Texts: Frame & {
			TitleLabel: TextLabel;
			UsernameLabel: TextLabel;
		};
		UserIcon: ImageLabel;
	};
};

type ExportSlotParts = {
	readonly ExportSlotTitleLabel: TextLabel;
	readonly CloseButton: GuiButton;

	readonly ConfirmButton: GuiButton;
	readonly CancelButton: GuiButton;

	readonly AllowList: Frame & {
		// Whitelist
		Left: Frame & {
			AddItem: Frame & {
				ConfirmButton: GuiButton;
				TextBox: TextBox;
			};
			InnerLeft: Frame;
		};
		// Blacklist
		Right: Frame & {
			AddItem: Frame & {
				ConfirmButton: GuiButton;
				TextBox: TextBox;
			};
			InnerRight: Frame;
		};
	};
	readonly AllowlistItemTemplate: AllowlistTemplate;

	readonly ExportMode: ConfigControlSwitchDefinition;
	readonly SlotExpiration: ConfigControlSwitchDefinition;
	readonly PublicExport: {
		Control: ToggleControlDefinition;
	};
};

interface UserProfile {
	userid: number;
	username: string; // the @user
	displayname: string;
}

// Default `(?)` profile icon
const defaultProfileIcon = "rbxassetid://18626672553";

const userProfileCache = new Map<number, UserProfile>();
const usernameToIdCache = new Map<string, number>();
const thumbnailCache = new Map<number, string>();

const getPlayerIcon = (userId: number): { success: true; icon: string } | { success: false } => {
	const cached = thumbnailCache.get(userId);
	if (cached) return { success: true, icon: cached };

	const [success, result, isReady] = pcall(() => {
		return Players.GetUserThumbnailAsync(userId, Enum.ThumbnailType.HeadShot, Enum.ThumbnailSize.Size180x180);
	});

	if (success && result !== undefined && isReady) {
		thumbnailCache.set(userId, result);
		return { success: true, icon: result };
	}

	$warn(`Failed to fetch thumbnail for user ${userId}:`, result);
	// It still needs to display something
	return { success: false };
};

// Profile from userid
const getUserProfileFromId = (userid: number): UserProfile | undefined => {
	const cached = userProfileCache.get(userid);
	if (cached) return cached;

	const [success, result] = pcall(() => UserService.GetUserInfosByUserIdsAsync([userid]));
	if (success && result !== undefined && result.size() > 0) {
		const info = result[0];
		const profile: UserProfile = {
			userid,
			username: info.Username,
			displayname: info.DisplayName,
		};
		userProfileCache.set(userid, profile);
		usernameToIdCache.set(info.Username.lower(), userid);
		return profile;
	}

	$warn(`Failed to fetch user profile for ID "${userid}":`, result);
	return undefined;
};

// Profile from username
const getUserProfileFromUsername = (username: string): UserProfile | undefined => {
	const cleanUsername = username.trim();
	if (cleanUsername === "") return undefined;

	const lowerName = cleanUsername.lower();
	let targetId = usernameToIdCache.get(lowerName);

	if (targetId === undefined) {
		const [success, result] = pcall(() => Players.GetUserIdFromNameAsync(cleanUsername));
		if (success && result !== undefined) {
			targetId = result;
			usernameToIdCache.set(lowerName, targetId);
		} else {
			$warn(`Failed to resolve username "${cleanUsername}" to an ID:`, result);
			return undefined;
		}
	}

	return getUserProfileFromId(targetId);
};

/**
 * - "@userid"
 * - "username"
 */
const getUserProfileFromInput = (input: string): UserProfile | undefined => {
	const cleanInput = input.trim();
	if (cleanInput === "") return undefined;

	// "@userid"
	if (cleanInput.sub(1, 1) === "@") {
		const idPart = cleanInput.sub(2).trim();
		const userid = tonumber(idPart);

		if (userid === undefined || userid < 1) {
			$warn(`Invalid User ID format: "${cleanInput}". @userid syntax cannot contain letters or symbols.`);
			return undefined;
		}

		return getUserProfileFromId(userid);
	}

	return getUserProfileFromUsername(cleanInput);
};

// Slot expiration durations
type ExpirationDurations = "5m" | "1h" | "1d" | "7d" | "30d" | "forever";
const expirationList: Record<ExpirationDurations, string> = {
	"5m": "Valid for 5 minutes",
	"1h": "Valid for one hour",
	"1d": "Valid for 1 day",
	"7d": "Valid for 7 days",
	"30d": "Valid for 30 days",
	forever: "Valid <b>forever</b>",
};
const expirationValues: ExpirationDurations[] = ["5m", "1h", "1d", "7d", "30d", "forever"];

export class ExportSlotPopup extends PartialControl<ExportSlotParts> {
	readonly whitelistIds: Set<number> = new Set();
	readonly blacklistIds: Set<number> = new Set();
	readonly allowlistTemplate;

	readonly publicExportObv = new ObservableValue<boolean>(false);
	readonly exportModeObv = new ObservableValue<"reference" | "static">("reference");
	readonly expirationObv = new ObservableValue<ExpirationDurations>("7d");

	constructor(
		readonly slotIdx: number | "current",
		readonly doExport: (data: PlayerExportSlotRequest) => ExportSlotResponse,
	) {
		super(template.Clone());

		$log("Exporting", slotIdx === "current" ? "current build" : "slot " + slotIdx, "...");

		// Store template for later
		this.allowlistTemplate = this.parts.AllowlistItemTemplate;
		this.allowlistTemplate.Visible = false;

		this.$onInjectAuto((popupController: PopupController) => {
			this.parent(new Control(this.parts.ConfirmButton)) //
				.addButtonActionSelf((button) => {
					button.setButtonInteractable(false);
					this.showExportOutput(popupController);
					button.setButtonInteractable(true);
				});
		});

		this.parent(new ButtonControl(this.parts.CancelButton, () => this.destroy()));
		this.parent(new ButtonControl(this.parts.CloseButton, () => this.destroy()));

		const allowListLeft = this.parts.AllowList.Left;
		const addItemWhitelist = () => {
			const inputBox = allowListLeft.AddItem.TextBox;
			const profile = getUserProfileFromInput(inputBox.Text);
			if (profile !== undefined) {
				if (profile.userid === LocalPlayer.player.UserId) {
					LogControl.instance.addLine("Cannot add yourself to the list.");
					return;
				}

				// Remove from blacklist to prevent user in both lists
				if (this.blacklistIds.contains(profile.userid)) {
					this.blacklistIds.delete(profile.userid);
					this.updateItems(this.blacklistIds, allowListRight.InnerRight);
				}

				this.whitelistIds.add(profile.userid);
				inputBox.Text = "";
				this.updateItems(this.whitelistIds, allowListLeft.InnerLeft);
			} else {
				$warn(`Whitelist could not add user from input: "${inputBox.Text}"`);
				LogControl.instance.addLine(`Could not find user "${inputBox.Text}"`);
			}
		};
		this.parent(new Control(allowListLeft.AddItem.ConfirmButton)) //
			.addButtonAction(addItemWhitelist);
		allowListLeft.AddItem.TextBox.FocusLost.Connect((isEnter) => {
			if (isEnter) addItemWhitelist();
		});

		const allowListRight = this.parts.AllowList.Right;
		const addItemBlacklist = () => {
			const inputBox = allowListRight.AddItem.TextBox;
			const profile = getUserProfileFromInput(inputBox.Text);
			if (profile !== undefined) {
				if (profile.userid === LocalPlayer.player.UserId) {
					LogControl.instance.addLine("Cannot add yourself to the list.");
					return;
				}

				// Remove from whitelist to prevent user in both lists
				if (this.whitelistIds.contains(profile.userid)) {
					this.whitelistIds.delete(profile.userid);
					this.updateItems(this.whitelistIds, allowListLeft.InnerLeft);
				}

				this.blacklistIds.add(profile.userid);
				inputBox.Text = "";
				this.updateItems(this.blacklistIds, allowListRight.InnerRight);
			} else {
				$warn(`Blacklist could not add user from input: ${inputBox.Text}`);
				LogControl.instance.addLine(`Could not find user "${inputBox.Text}"`);
			}
		};
		this.parent(new Control(allowListRight.AddItem.ConfirmButton)) //
			.addButtonAction(addItemBlacklist);
		allowListRight.AddItem.TextBox.FocusLost.Connect((isEnter) => {
			if (isEnter) addItemBlacklist();
		});

		this.parent(new ToggleControl(this.parts.PublicExport.Control)) //
			.value.connect(this.publicExportObv);

		if (slotIdx === "current") {
			// Force static as there is no reference to the current build
			this.exportModeObv.set("static");
			this.parts.ExportMode.Visible = false;

			this.parts.ExportSlotTitleLabel.Text = "EXPORT BUILD";
		} else {
			const exportMode = this.parent(
				new ConfigControlSwitch(this.parts.ExportMode, "Export Mode", [
					[
						"reference",
						{
							name: "Reference",
							description: "Gives players read-only access to the slot <b>until it changes</b>.",
						},
					],
					[
						"static",
						{
							name: "Static",
							description:
								"Export as it is now. independent of the save slot. <b>Uses more space as it stores the actual build!!!</b>",
						},
					],
				]),
			);
			exportMode.initToObservable(this.exportModeObv);
			this.exportModeObv.changed.Connect((value) => {
				// Force static when public
				if (this.publicExportObv.get() && value === "reference") {
					this.exportModeObv.set("static");
				}
			});

			// Force static when public
			this.publicExportObv.changed.Connect((enabled) => {
				if (enabled) {
					this.exportModeObv.set("static");
				}
				exportMode.setEnabled(!enabled);
			});
		}

		this.parent(
			new ConfigControlSwitch(this.parts.SlotExpiration, "Expiration", [
				...expirationValues.map((name) => [name, { name, description: expirationList[name] }] as const),
			]),
		).initToObservable(this.expirationObv);

		this.onInject((di) => {
			const blur = di.resolve<BlurController>();
			this.event.subscribeDestroyable(blur.blur.addChildOverlay(12));
		});
	}

	updateItems(items: Set<number>, container: Frame) {
		const frames: Map<number, Frame> = new Map();
		const foundIds: Set<number> = new Set();

		for (const frame of container.GetChildren() as Frame[]) {
			if (frame.Name !== "Item") continue;

			const userid = frame.GetAttribute("userid") as number | undefined;
			if (userid) {
				foundIds.add(userid);
				frames.set(userid, frame);
				if (!items.contains(userid)) frame.Destroy();
			}
		}

		const sortedItems = [...items].sort((a, b) => a < b);
		let i = 1;
		for (const id of sortedItems) {
			if (foundIds.contains(id)) continue;

			const copy = this.allowlistTemplate.Clone();
			copy.SetAttribute("userid", id);
			copy.Name = "Item";
			copy.LayoutOrder = i++;

			copy.TextButton.MouseButton1Click.Once(() => {
				// Remove item and refresh
				if (items.contains(id)) items.delete(id);
				this.updateItems(items, container);
			});

			// As to not be blocking
			const nameFrame = copy.TextButton.Texts;
			task.spawn(() => {
				const profile = getUserProfileFromId(id);
				if (profile !== undefined) {
					nameFrame.TitleLabel.Text = profile.displayname;
					nameFrame.UsernameLabel.Text = `(@${profile.username})`;
				} else {
					nameFrame.TitleLabel.Text = "Unknown User";
					nameFrame.UsernameLabel.Text = `(@${id})`;
				}

				// (renders the text immediately instead of waiting for profile)
				task.wait(0);

				const iconResult = getPlayerIcon(id);
				copy.TextButton.UserIcon.Image = iconResult.success ? iconResult.icon : defaultProfileIcon;
			});
			copy.Visible = true;
			copy.Parent = container;
		}
	}

	showExportOutput(popupController: PopupController) {
		const result = this.doExport({
			mode: this.exportModeObv.get(),
			creatorId: tostring(LocalPlayer.player.UserId),
			slotIndex: this.slotIdx,
			whitelist: this.whitelistIds.map(tostring), // Set<number> -> string[]
			blacklist: this.blacklistIds.map(tostring),
			isPublic: this.publicExportObv.get(),
			expiration: this.expirationObv.get(),
		});
		if (result.success) {
			popupController.showPopup(
				new TextCopyPopup(
					result.data,
					`Share this code to let others import your ${this.slotIdx === "current" ? "build" : "slot"}.`,
				),
			);
		} else {
			const showErr = (msg: string) => {
				$warn(msg);
				popupController.showPopup(new AlertPopup(msg));
			};
			// (this adds auto-complete)
			const msg = result.message as ExportError | (string & {});
			switch (msg) {
				case "Empty":
					showErr("The slot is empty and cannot be exported.");
					break;
				case "Unreachable":
					showErr("Unable to reach database, it may be unavailable at this time.");
					break;
				case "LocalOnly":
					// When the database copy is outdated or doesnt exist (reference mode)
					showErr("This slot is stored locally and cannot be exported.");
					break;
				case "NotExportable":
					showErr("This slot can't be exported.");
					break;
				case "NotSynced":
					showErr("The stored version and cloud are out of date.");
					break;
				case "StillSyncing":
					showErr("This slot is still syncing, try again later.");
					break;
				case "NoVersion":
					showErr("The slot has no version, it might be corrupted.");
					break;
				default:
					showErr(`Error while creating packet: ${result.message}`);
					break;
			}
		}
	}
}
