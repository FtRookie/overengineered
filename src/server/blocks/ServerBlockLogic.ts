import { Workspace } from "@rbxts/services";
import { SharedPlots } from "shared/building/SharedPlots";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { GenericBlockLogicCtor } from "shared/blockLogic/BlockLogic";

export abstract class ServerBlockLogic<T extends GenericBlockLogicCtor> {
	readonly logic;

	constructor(
		logic: T,
		private readonly playModeController: PlayModeController,
	) {
		this.logic = logic;
	}

	static staticIsValidBlockNamed(
		block: BasePart | undefined,
		player: Player | undefined,
		playModeController: PlayModeController,
		checkOwnership: boolean = true,
		checkRideMode: boolean = true,
	): string | undefined {
		if (!block) return "No block";
		if (!block.IsDescendantOf(Workspace)) return "Block not in workspace";

		if (player) {
			if (checkRideMode && playModeController.getPlayerMode(player) !== "ride") {
				return "Invalid mode";
			}

			if (checkOwnership) {
				const plot = SharedPlots.staticTryGetPlotByOwnerID(player.UserId);
				if (!plot) return "No plot";
				// An anchored block cannot have physics ownership
				if (
					block.IsDescendantOf(plot) || //
					block.Anchored ||
					block.AssemblyRootPart?.Anchored
				)
					return;
				return "Block not on plot and not anchored";
			}
		}
	}
	static staticIsValidBlock(
		block: BasePart | undefined,
		player: Player | undefined,
		playModeController: PlayModeController,
		checkOwnership: boolean = true,
		checkRideMode: boolean = true,
	): boolean {
		return (
			this.staticIsValidBlockNamed(block, player, playModeController, checkOwnership, checkRideMode) === undefined
		);
	}
	protected isValidBlock(
		block: BlockModel | undefined,
		player: Player | undefined,
		checkOwnership: boolean = true,
		checkRideMode: boolean = true,
	): boolean {
		if (!block?.PrimaryPart) return false;
		return ServerBlockLogic.staticIsValidBlock(
			block.PrimaryPart,
			player,
			this.playModeController,
			checkOwnership,
			checkRideMode,
		);
	}
}
