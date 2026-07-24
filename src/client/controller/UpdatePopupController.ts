import { RunService } from "@rbxts/services";
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
			const latest = updateLogs[0];
			if (latest === undefined) return;

			const data = playerDataStorage.data.get();
			const seen = data.data.lastSeenLog;
			playerDataStorage.sendPlayerDataValue("lastJoin", DateTime.now().UnixTimestamp);

			// The header identifies the entry, where the old timestamp check missed a log posted later the
			// same day it was last seen. Nothing to do if it is already the newest they've been shown.
			if (seen === latest.Header) return;

			playerDataStorage.sendPlayerDataValue("lastSeenLog", latest.Header);

			// `seen === undefined` is a first join (or a player from before this field existed): mark them
			// caught up silently rather than opening a changelog for updates that predate them.
			if (seen !== undefined && !RunService.IsStudio()) {
				popupController.showPopup(new UpdateLogsPopup());
			}
		});
	}
}
