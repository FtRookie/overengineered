import type { PlayModeBase } from "server/modes/PlayModeBase";
import type { MortalityController } from "server/MortalityController";

@injectable
export class BuildMode implements PlayModeBase {
	constructor(@inject private readonly mortality: MortalityController) {}

	onTransitionFrom(player: Player, prevmode: PlayModes | undefined): Response | undefined {
		if (prevmode === "build") {
			return { success: true };
		}

		if (prevmode === undefined || prevmode === "ride") {
			// Restore limb HP (the source of truth). A direct Humanoid.Health write is overwritten by the
			// mortality health bridge — that mismatch is what flashed the health bar red and reverted the heal.
			this.mortality.restore(player);
			/*if (Players.LocalPlayer.Character && Players.LocalPlayer.Character.GetPivot().Position.Magnitude > 100) {
				Workspace.FindFirstChild("Terrain")?.Destroy();
			}*/

			return { success: true };
		}
	}
	onTransitionTo(player: Player, nextmode: PlayModes | undefined): Response | undefined {
		if (nextmode === "build") {
			return { success: true };
		}

		if (nextmode === undefined || nextmode === "ride") {
			return { success: true };
		}
	}
}
