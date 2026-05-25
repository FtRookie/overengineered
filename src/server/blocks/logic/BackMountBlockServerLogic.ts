import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { BackMountBlockLogic, BackMountModel } from "shared/blocks/blocks/BackMountBlock";

@injectable
export class BackMountBlockServerLogic extends ServerBlockLogic<typeof BackMountBlockLogic> {
	constructor(logic: typeof BackMountBlockLogic, @inject playModeController: PlayModeController) {
		super(logic, playModeController);

		const getPlayerTorso = (p: Player, connectToRootPart: boolean) => {
			const humanoid = p.Character?.FindFirstChild("Humanoid") as Humanoid | undefined;
			if (!humanoid) return;

			if (connectToRootPart) {
				return humanoid.RootPart;
			}

			switch (humanoid.RigType) {
				case Enum.HumanoidRigType.R6:
					return humanoid.Parent?.FindFirstChild("Torso") as BasePart;
				case Enum.HumanoidRigType.R15:
					return humanoid.Parent?.FindFirstChild("UpperTorso") as BasePart;
			}

			return;
		};

		// Transfers ownership of the whole connected assembly (block + welded structure)
		// to `owner`. Walks GetConnectedParts(true) so we catch every neighbour, not just
		// the block's own descendants.
		const transferAssemblyOwner = (block: BackMountModel, owner: Player | undefined) => {
			const root = block.PrimaryPart ?? block.FindFirstChild("mainPart");
			if (!root || !root.IsA("BasePart")) return;
			const parts = [root, ...root.GetConnectedParts(true)];
			for (const p of parts) {
				if (!p.CanSetNetworkOwnership()[0]) continue;
				p.SetNetworkOwner(owner);
			}
		};

		const isAlreadyWelded = (w: WeldConstraint) => w.Part1 !== undefined;

		logic.events.weldMountUpdate.invoked.Connect((player, data) => {
			if (!player) return;
			const isWeldRequest = data.weldedState && !isAlreadyWelded(data.block.PlayerWeldConstraint);

			//weld if unwelded
			if (isWeldRequest) {
				const torso = getPlayerTorso(player, data.connectToRootPart ?? false);
				if (!torso) return;

				const mainPart = data.block.FindFirstChild("mainPart") as BasePart | undefined;
				if (!mainPart) return;

				// Take server-side authority of the structure BEFORE positioning, so the
				// placer's client can't overwrite our CFrame change on the next tick.
				transferAssemblyOwner(data.block, undefined);

				// Position the block relative to torso. WeldConstraint freezes the current
				// relative offset, so we set CFrame first.
				mainPart.CFrame = torso.CFrame.mul(new CFrame(0, 0, torso.Size.Z));

				data.block.PlayerWeldConstraint.Part0 = mainPart;
				data.block.PlayerWeldConstraint.Part1 = torso;

				// Hand the now-welded assembly to the wearer so physics is consistent
				transferAssemblyOwner(data.block, player);

				task.delay(0.5, () => {
					const root = data.block.PrimaryPart ?? data.block.FindFirstChild("mainPart");
					if (!root || !root.IsA("BasePart")) return;
					print("[backmount] 500ms later, owner:", root.GetNetworkOwner()?.Name ?? "server");
				});

				logic.events.updateLogic.send("everyone", {
					block: data.block,
					weldedTo: player,
				});
				return;
			}

			//unweld otherwise
			data.block.PlayerWeldConstraint.Part1 = undefined;
			// After unweld, structure is its own assembly again — give it back to the placer
			transferAssemblyOwner(data.block, data.owner);

			logic.events.updateLogic.send("everyone", {
				block: data.block,
				weldedTo: undefined,
			});
		});
	}
}
