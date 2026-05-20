import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { HandleBlockLogic } from "shared/blocks/blocks/HandleBlock";

@injectable
export class HandleBlockServerLogic extends ServerBlockLogic<typeof HandleBlockLogic> {
	constructor(logic: typeof HandleBlockLogic, @inject playModeController: PlayModeController) {
		super(logic, playModeController);

		logic.events.update.invoked.Connect((player, { block, enabled, shared, dragMode, response }) => {
			if (!this.isValidBlock(block, player)) return;
			const detector = block.Main.DragDetector;
			detector.Enabled = enabled;
			detector.RunLocally = shared; // some weirdness
			detector.DragStyle = logic.enumToDragStyle[dragMode];
			detector.Responsiveness = response;
			if (!shared) {
				detector.PermissionPolicy = Enum.DragDetectorPermissionPolicy.Scriptable;
				detector.SetPermissionPolicyFunction((p: Player, part: typeof block.Main) => {
					print(p.Name, player.Name);
					return p === player;
				}); // Set only for self
			}
			if (shared) {
				detector.PermissionPolicy = Enum.DragDetectorPermissionPolicy.Everybody;
				detector.SetPermissionPolicyFunction(() => true);
			}
		});
	}
}
