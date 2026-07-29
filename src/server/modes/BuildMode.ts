import { SpreadingFireController } from "server/SpreadingFireController";
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
			// Build mode is safe: limbs stop being damageable and the character is made whole. A direct
			// Humanoid.Health write would be overwritten by the mortality health bridge — that mismatch is
			// what flashed the health bar red and reverted the heal.
			this.mortality.disarm(player);
			SpreadingFireController.instance?.extinguishPlayer(player);
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
