import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { PropellantBlockLogic } from "shared/blocks/blocks/grouped/PropellantBlocks";

@injectable
export class PropellantBlockServerLogic extends ServerBlockLogic<typeof PropellantBlockLogic> {
	constructor(logic: typeof PropellantBlockLogic, @inject playModeController: PlayModeController) {
		super(logic, playModeController);

		logic.events.replicate.invoked.Connect((player, { block }) => {
			block.ColBox.WeldTop.Destroy();

			for (const decal of block.ColBox.GetChildren()) {
				if (decal.IsA("Decal")) decal.Transparency = 1;
			}

			for (const d of [block.Bottom, block.Top]) {
				if (!d.AssemblyRootPart?.Anchored) {
					d.SetNetworkOwner(player);
				}
			}
		});
	}
}
