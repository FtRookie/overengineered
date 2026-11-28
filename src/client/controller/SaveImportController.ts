import { ConfirmPopup } from "client/gui/popup/ConfirmPopup";
import { InvalidBlocksPopup } from "client/gui/popup/InvalidBlocksPopup";
import { LogControl } from "client/gui/static/LogControl";
import { HostedService } from "engine/shared/di/HostedService";
import { Signal } from "engine/shared/event/Signal";
import { Colors } from "shared/Colors";
import type { PopupController } from "client/gui/PopupController";
import type { PlayerDataStorageRemotesSlots } from "shared/remotes/PlayerDataRemotes";

function getKeyCount(obj: object) {
	let i = 0;
	for (const _ of obj as Map<string, unknown>) i++;
	return i;
}

@injectable
export class SaveImportController extends HostedService {
	readonly importPopupClosed = new Signal();

	constructor(
		@inject readonly popupController: PopupController,
		@inject readonly slotRemotes: PlayerDataStorageRemotesSlots,
		@inject readonly blockList: BlockList,
	) {
		super();
	}

	async importSlot(payloadString: string): Promise<PlayerImportSlotExecuteResponse | undefined> {
		// Phase 1: Validate
		const validate = this.slotRemotes.importSlotValidate.send({ payloadString });
		if (!validate.success) {
			LogControl.instance.addLine(`Import validation failed: ${validate.message}`, Colors.red);
			return { success: false, message: validate.message };
		}

		const issues = validate.issues;
		let skipInvalidBlocks = getKeyCount(issues.invalidBlocks) === 0;

		// Phase 2: Show prompts if needed
		if (getKeyCount(issues.invalidBlocks) > 0) {
			skipInvalidBlocks = await this.showInvalidBlocks(issues.invalidBlocks);
			if (!skipInvalidBlocks) {
				return { success: false, message: "Must confirm skipping invalid blocks", errorLevel: "warn" };
			}
		}
		if (skipInvalidBlocks && issues.wouldOverwrite) {
			const confirmOverwrite = await this.showConfirmReplace();
			if (!confirmOverwrite) {
				return { success: false, message: "Must confirm overwrite", errorLevel: "warn" };
			}
		}

		// Phase 3: Execute
		const result = this.slotRemotes.importSlotExecute.send({
			reqId: validate.reqId,
			options: {
				skipInvalidBlocks,
			},
		});

		if (result.success) {
			if (result.wasShifted) LogControl.instance.addLine("Build was shifted to fit in plot", Colors.yellow);
		} else {
			LogControl.instance.addLine("Error: " + result.message, Colors.red);
		}

		return result;
	}

	private showConfirmReplace(): Promise<boolean> {
		return new Promise((resolve) => {
			this.popupController.showPopup(
				new ConfirmPopup(
					"ARE YOU SURE YOU WANT TO DO THIS",
					"THIS WILL REPLACE THE BUILD AND CANNOT BE UNDONE",
					() => resolve(true),
					() => resolve(false),
				),
			);
		});
	}

	private showInvalidBlocks(blocks: Record<string, number>): Promise<boolean> {
		return new Promise((resolve) => {
			this.popupController.showPopup(
				new InvalidBlocksPopup(
					this.blockList,
					blocks,
					() => resolve(false),
					() => resolve(true),
				),
			);
		});
	}
}
