import { Base64 } from "@rbxts/crypto";
import { GuiService, Players } from "@rbxts/services";
import { SoundController } from "client/controller/SoundController";
import { Interface } from "client/gui/Interface";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { JSON } from "engine/shared/fixes/Json";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { ButtonDefinition } from "engine/client/gui/Button";

const processDataForJsonSerializationForSubmit = (data: unknown): unknown => {
	if (typeIs(data, "Instance")) {
		return {
			__type: "Instance",
			instanceType: data.ClassName,
			name: data.Name,
			attributes: data.GetAttributes(),
			tags: data.GetTags(),
		};
	}

	if (typeIs(data, "table")) {
		const toserialize: Partial<Record<string | number | symbol, unknown>> = {};
		for (const [key, value] of pairs(data)) {
			toserialize[key as keyof typeof toserialize] = processDataForJsonSerializationForSubmit(value);
		}

		return toserialize;
	}

	return data;
};

const serialize = (data: unknown): string => {
	const str = JSON.serialize(data);
	return Base64.Encode(str);
};

type ReportSubmitPopupDefinition = GuiObject & {
	readonly Content: Frame & {
		readonly Text: TextLabel;
		readonly TextBox: TextBox;
		readonly Buttons: {
			readonly OkButton: TextButton;
		};
	};
	readonly Heading: {
		readonly CloseButton: ButtonDefinition;
	};
};
export class ReportSubmitPopup extends Control<ReportSubmitPopupDefinition> {
	constructor(data: unknown, text?: string, okFunc?: () => void) {
		const gui = Interface.getInterface<{
			Popups: { Crossplatform: { ReportSubmit: ReportSubmitPopupDefinition } };
		}>().Popups.Crossplatform.ReportSubmit.Clone();
		super(gui);

		const okButton = this.parent(new Control(gui.Content.Buttons.OkButton));
		okButton.addButtonAction(() => {
			okFunc?.();
			this.hide();
		});
		this.event.onPrepareGamepad(() => (GuiService.SelectedObject = okButton.instance));

		this.parent(new ButtonControl(gui.Heading.CloseButton, () => this.hide()));

		this.onEnable(() => SoundController.getUISounds().Warning.Play());

		gui.Content.Text.Text =
			text ??
			"An error has happened.\nPlease copy the text below and submit a bug report in our community server.";

		this.$onInjectAuto((playerDataStorage: PlayerDataStorage) => {
			if (typeIs(data, "table")) {
				data = {
					...data,
					loadedSlotIdx: playerDataStorage.loadedSlot.get(),
					data: playerDataStorage.data.get(),
					// loadedSlot: this.plot.getBlocks(), // too much text
				};
			}

			try {
				gui.Content.TextBox.Text = serialize({
					uid: Players.LocalPlayer.UserId,
					uname: Players.LocalPlayer.Name,
					udname: Players.LocalPlayer.DisplayName,
					text: text ?? "Never gonna give you up",
					env: GameDefinitions.getEnvironmentInfo(),
					trace: debug.traceback(undefined, 1)?.split("\n"),
					data: processDataForJsonSerializationForSubmit(data),
				});
			} catch {
				try {
					gui.Content.TextBox.Text = serialize({
						uid: Players.LocalPlayer.UserId,
						uname: Players.LocalPlayer.Name,
						udname: Players.LocalPlayer.DisplayName,
						env: GameDefinitions.getEnvironmentInfo(),
						data: processDataForJsonSerializationForSubmit(data),
					});
				} catch {
					try {
						gui.Content.TextBox.Text = serialize({
							uid: Players.LocalPlayer.UserId,
							uname: Players.LocalPlayer.Name,
							udname: Players.LocalPlayer.DisplayName,
							trace: debug.traceback(undefined, 1)?.split("\n"),
						});
					} catch {
						gui.Content.TextBox.Text = serialize("[ERRTOOLONG]");
					}
				}
			}
		});
	}
}
