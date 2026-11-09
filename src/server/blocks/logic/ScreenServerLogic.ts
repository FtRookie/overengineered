import { filterBlockText } from "server/blocks/BlockTextFilter";
import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import { ScreenBlock } from "shared/blocks/blocks/ScreenBlock";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { ScreenBlockLogic } from "shared/blocks/blocks/ScreenBlock";

@injectable
export class ScreenServerLogic extends ServerBlockLogic<typeof ScreenBlockLogic> {
	constructor(logic: typeof ScreenBlockLogic, @inject playModeController: PlayModeController) {
		super(logic, playModeController);

		ScreenBlock.logic.events.update.addServerMiddleware((player, arg) => {
			const needsTranslating = () => {
				const data = arg.data;
				if (typeIs(data, "string")) return true;
				if (typeIs(data, "table")) return true;

				return false;
			};

			const translate = player && needsTranslating();
			if (player && translate) {
				try {
					const data = filterBlockText(arg.block, logic.dataToString(arg.data), player);
					return { success: true, value: { ...arg, data } };
				} catch (e) {
					$warn("Screen text filter failed:", e);
					return "dontsend";
				}
			}

			return { success: true, value: arg };
		});
	}
}
