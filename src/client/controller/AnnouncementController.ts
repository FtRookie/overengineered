import { AlertPopup } from "client/gui/popup/AlertPopup";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { HostedService } from "engine/shared/di/HostedService";
import { CustomRemotes } from "shared/Remotes";
import type { PopupController } from "client/gui/PopupController";

@injectable
export class AnnouncementController extends HostedService {
	constructor(@inject popupController: PopupController) {
		super();

		this.event.subscribe(CustomRemotes.chat.announcePopup.invoked, (payload) => {
			popupController.showPopup(new AlertPopup(payload.text));
		});
		this.event.subscribe(CustomRemotes.chat.privateMessage.invoked, (payload) => {
			popupController.showPopup(new AlertPopup(payload.text, undefined, 10));
		});
		this.event.subscribe(CustomRemotes.chat.flung.invoked, ({ velocity, spin }) => {
			const root = LocalPlayer.rootPart.get();
			if (!root) return;

			root.AssemblyLinearVelocity = velocity;
			root.AssemblyAngularVelocity = spin;
		});
	}
}
