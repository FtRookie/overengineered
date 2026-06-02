import { RunService } from "@rbxts/services";
import { BSOD } from "client/gui/BSOD";
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

			const latest = DateTime.fromIsoDate(updateLogs[0].Date);
			if (!latest) {
				BSOD.showWithDefaultText(
					`Invalid ISO date "${updateLogs[0].Date}" in the most recent update log entry`,
					"The game has failed to load.",
				);
				return;
			}
			if (lastJoin < latest.UnixTimestamp && !RunService.IsStudio()) {
				popupController.showPopup(new UpdateLogsPopup());
			}
		});
	}
}
