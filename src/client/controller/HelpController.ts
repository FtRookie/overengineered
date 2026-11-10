import { TextChatService } from "@rbxts/services";
import { HelpPopup } from "client/gui/HelpPopup";
import { HelpQuickStartPopup } from "client/gui/HelpQuickStartPopup";
import { Keybinds } from "engine/client/Keybinds";
import { HostedService } from "engine/shared/di/HostedService";
import type { PopupController } from "client/gui/PopupController";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

const helpKeybind = Keybinds.registerDefinition("help", ["Help"], [["F1"]]);

@injectable
export class HelpController extends HostedService {
	private open?: HelpPopup | HelpQuickStartPopup;

	constructor(
		@inject keybinds: Keybinds,
		@inject private readonly popupController: PopupController,
		@inject playerData: PlayerDataStorage,
	) {
		super();

		// shown in place of the tutorial, to a player whose slots are all empty
		this.onEnable(() => {
			if (asMap(playerData.slots.get()).any((_, slot) => slot.blocks !== 0)) return;
			task.delay(0, () => this.showQuickStart());
		});

		this.event.subscribeRegistration(() =>
			keybinds.fromDefinition(helpKeybind).onDown(() => {
				this.toggle();
				return "Sink";
			}),
		);

		const command = new Instance("TextChatCommand");
		command.Name = "Help";
		command.PrimaryAlias = "/help";
		command.Parent = TextChatService;
		this.event.subscribe(command.Triggered, () => this.show());
		this.onDestroy(() => command.Destroy());
	}

	show() {
		if (this.open && !this.open.isDestroyed()) return;

		this.open = new HelpPopup();
		this.popupController.showPopup(this.open);
	}

	showQuickStart() {
		if (this.open && !this.open.isDestroyed()) return;

		this.open = new HelpQuickStartPopup();
		this.popupController.showPopup(this.open);
	}

	close() {
		this.open?.destroy();
		this.open = undefined;
	}

	toggle() {
		if (this.open && !this.open.isDestroyed()) {
			this.open.destroy();
			this.open = undefined;
			return;
		}

		this.show();
	}
}
