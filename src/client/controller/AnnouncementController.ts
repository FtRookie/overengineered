import { AlertPopup } from "client/gui/popup/AlertPopup";
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
	}
}
