import { t } from "engine/shared/t";
import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import { BlockManager } from "shared/building/BlockManager";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { HandleBlockLogic } from "shared/blocks/blocks/HandleBlock";

@injectable
export class HandleBlockServerLogic extends ServerBlockLogic<typeof HandleBlockLogic> {
	constructor(logic: typeof HandleBlockLogic, @inject playModeController: PlayModeController) {
		super(logic, playModeController);

		logic.events.update.invoked.Connect((player, args) => {
			t.typeCheckWithThrow(args, logic.updateType);
			const { block, enabled, shared, dragMode, response, torque } = args;
			if (!this.isValidBlock(block, player)) return;
			const detector = block.Main.DragDetector;
			detector.Enabled = enabled;
			detector.RunLocally = shared; // some weirdness
			detector.DragStyle = logic.enumToDragStyle[dragMode];
			detector.Responsiveness = response;
			if (!shared) {
				detector.PermissionPolicy = Enum.DragDetectorPermissionPolicy.Scriptable;
				detector.SetPermissionPolicyFunction((p: Player) => p === player); // Set only for self
			}
			if (shared) {
				detector.PermissionPolicy = Enum.DragDetectorPermissionPolicy.Everybody;
				detector.SetPermissionPolicyFunction(() => true); // Might be redundant
			}

			const scalev = BlockManager.getBlockDataByBlockModel(block).scale ?? Vector3.one;
			const scale = math.max(1, scalev.X * scalev.Y * scalev.Z);
			detector.MaxTorque = torque * scale;
		});
	}
}
