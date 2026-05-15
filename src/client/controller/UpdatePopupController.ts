import { UpdateLogsPopup } from "client/gui/UpdateLogGui";
import { updateLogs } from "client/UpdateLogs";
import { HostedService } from "engine/shared/di/HostedService";
import type { PopupController } from "client/gui/PopupController";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

@injectable
export class UpdatePopupController extends HostedService {
	constructor(@inject playerDataStorage: PlayerDataStorage, @inject popupController: PopupController) {
		super();

		this.onEnable(() => {
			const data = playerDataStorage.data.get();
			const lastJoin = data.data.lastJoin;

			playerDataStorage.sendPlayerDataValue("lastJoin", DateTime.now().UnixTimestamp);
			if (!lastJoin) return;

			if (lastJoin < DateTime.fromIsoDate(updateLogs[0].Date)!.UnixTimestamp) {
				popupController.showPopup(new UpdateLogsPopup());
			}
		});
	}
}
