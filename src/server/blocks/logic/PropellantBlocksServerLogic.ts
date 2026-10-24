import { Instances } from "engine/shared/fixes/Instances";
import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import { BlockManager } from "shared/building/BlockManager";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { PropellantBlockLogic } from "shared/blocks/blocks/grouped/PropellantBlocks";

const isOwnable = (part: BasePart) => {
	const [ownable] = part.CanSetNetworkOwnership();
	return ownable;
};

// a half the break just freed is the server's until the handoff, so only a push from here moves it
const pushFreed = (part: BasePart | undefined, amount: number): boolean => {
	if (!part || !isOwnable(part)) return false;
	// NaN fails both comparisons
	if (!(amount >= 0 && amount < math.huge)) return false;

	part.SetNetworkOwner(undefined); // undefined = server
	part.ApplyImpulse(part.CFrame.UpVector.mul(amount));
	return true;
};

@injectable
export class PropellantBlockServerLogic extends ServerBlockLogic<typeof PropellantBlockLogic> {
	constructor(logic: typeof PropellantBlockLogic, @inject playModeController: PlayModeController) {
		super(logic, playModeController);

		// Middleware rather than the synchronizer's own callback: that one only ever runs on clients, and
		// breaking the weld, handing over the halves and destroying them are all server-authoritative.
		// Block validity and ownership are already covered by the global middleware.
		logic.events.replicate.addServerMiddleware((invoker, arg) => {
			const { block, willDisintegrate, force, symmetric } = arg;

			const top = block.FindFirstChild("Top") as BasePart | undefined;
			const bottom = block.FindFirstChild("Bottom") as BasePart | undefined;

			// read before the weld goes: an anchored assembly is the server's, so the sender's push on it did nothing
			const topWasAnchored = top !== undefined && !isOwnable(top);
			const bottomWasAnchored = bottom !== undefined && !isOwnable(bottom);

			Instances.findChild(block, "ColBox", "WeldTop")?.Destroy();

			const scale = BlockManager.manager.scale.get(block) ?? Vector3.one;
			const impulse = math.max(1, scale.X * scale.Y * scale.Z) * force;
			const share = symmetric ? impulse / 2 : impulse;
			const pushedTop = topWasAnchored && pushFreed(top, share);
			const pushedBottom = symmetric && bottomWasAnchored && pushFreed(bottom, share);

			const finish = () => {
				// before the destroy: an assembly that is never handed over freezes in place instead of replicating
				if (invoker && invoker.Parent) {
					for (const d of [top, bottom]) {
						if (!d) continue;

						// the engine's own answer, not an anchored check: it rejects parts welded to an anchored
						// part too, so an assembly root read here also rejects a half that the weld break frees.
						// Destructured straight off the call — packing a LuaTuple first would make the guard constant.
						const [canOwn] = d.CanSetNetworkOwnership();
						if (!canOwn) continue;

						d.SetNetworkOwner(invoker);
					}

					// the sender's local velocity pins only come down once ownership is theirs
					logic.propel2c.send(invoker, { block });
				}

				if (willDisintegrate) {
					top?.Destroy();
					bottom?.Destroy();
				}
			};

			// fixme: is one frame enough for the server's push to reach the owner it is handed to?
			if (pushedTop || pushedBottom) {
				task.spawn(() => {
					task.wait();
					finish();
				});
			} else {
				finish();
			}

			return { success: true, value: arg };
		});
	}
}
