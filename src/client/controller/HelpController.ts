import { TextChatService } from "@rbxts/services";
import { HelpPopup } from "client/gui/HelpPopup";
import { Keybinds } from "engine/client/Keybinds";
import { HostedService } from "engine/shared/di/HostedService";
import type { PopupController } from "client/gui/PopupController";

const helpKeybind = Keybinds.registerDefinition("help", ["Help"], [["F1"]]);

@injectable
export class HelpController extends HostedService {
	private open?: HelpPopup;

	constructor(
		@inject keybinds: Keybinds,
		@inject private readonly popupController: PopupController,
	) {
		super();

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

	toggle() {
		if (this.open && !this.open.isDestroyed()) {
			this.open.destroy();
			this.open = undefined;
			return;
		}

		this.show();
	}
}
