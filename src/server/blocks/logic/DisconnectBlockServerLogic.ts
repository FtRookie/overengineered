import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { DisconnectBlockLogic } from "shared/blocks/blocks/DisconnectBlock";

@injectable
export class DisconnectBlockServerLogic extends ServerBlockLogic<typeof DisconnectBlockLogic> {
	constructor(logic: typeof DisconnectBlockLogic, @inject playModeController: PlayModeController) {
		super(logic, playModeController);

		// Middleware rather than the synchronizer's own callback: that one only ever runs on clients, and
		// destroying the ejector and handing over the halves are both server-authoritative. Block validity
		// and ownership are already covered by the global middleware.
		logic.events.disconnect.addServerMiddleware((invoker, arg) => {
			const { block } = arg;
			block.FindFirstChild("Ejector")?.Destroy();

			if (!invoker) return { success: true, value: arg };

			for (const name of ["BottomPart", "TopPart"] as const) {
				const d = block.FindFirstChild(name) as BasePart | undefined;
				// the engine's own answer, not an anchored check: it rejects parts welded to an anchored part
				// too, so an assembly root read here also rejects a half that breaking the ejector frees
				if (d?.CanSetNetworkOwnership()[0]) {
					d.SetNetworkOwner(invoker);
				}
			}

			// the sender's local "deleted" markers only come down once the split above has happened
			logic.disconnect2c.send(invoker, { block });
			return { success: true, value: arg };
		});
	}
}
