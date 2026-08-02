import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { PropellantBlockLogic } from "shared/blocks/blocks/grouped/PropellantBlocks";

@injectable
export class PropellantBlockServerLogic extends ServerBlockLogic<typeof PropellantBlockLogic> {
	constructor(logic: typeof PropellantBlockLogic, @inject playModeController: PlayModeController) {
		super(logic, playModeController);

		// Middleware rather than the synchronizer's own callback: that one only ever runs on clients, and
		// breaking the weld, handing over the halves and destroying them are all server-authoritative.
		// Block validity and ownership are already covered by the global middleware.
		logic.events.replicate.addServerMiddleware((invoker, arg) => {
			const { block, willDisintegrate } = arg;

			block.FindFirstChild("ColBox")?.FindFirstChild("WeldTop")?.Destroy();

			const top = block.FindFirstChild("Top") as BasePart | undefined;
			const bottom = block.FindFirstChild("Bottom") as BasePart | undefined;

			// before the destroy: an assembly that is never handed over freezes in place instead of replicating
			if (invoker) {
				for (const d of [top, bottom]) {
					if (d && !d.AssemblyRootPart?.Anchored) {
						d.SetNetworkOwner(invoker);
					}
				}
			}

			if (willDisintegrate) {
				top?.Destroy();
				bottom?.Destroy();
			}

			return { success: true, value: arg };
		});
	}
}
