import { TextService } from "@rbxts/services";
import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { ButtonBlockLogic } from "shared/blocks/blocks/grouped/ButtonBlocks";

@injectable
export class ButtonServerLogic extends ServerBlockLogic<typeof ButtonBlockLogic> {
	constructor(logic: typeof ButtonBlockLogic, @inject playModeController: PlayModeController) {
		super(logic, playModeController);

		// Covers all button variants — squarebutton shares this events object.
		logic.events.updateText.addServerMiddleware((player, arg) => {
			if (!player || arg.text.size() === 0) return { success: true, value: arg };

			try {
				const text = TextService.FilterStringAsync(
					arg.text,
					player.UserId,
					"PublicChat",
				).GetNonChatStringForUserAsync(player.UserId);

				return { success: true, value: { ...arg, text } };
			} catch (e) {
				$warn("Button text filter failed:", e);
				return "dontsend";
			}
		});
	}
}
