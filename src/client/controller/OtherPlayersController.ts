import { Players } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { PlayerWatcher } from "engine/shared/PlayerWatcher";
import { SharedRagdoll } from "shared/SharedRagdoll";
import { PartUtils } from "shared/utils/PartUtils";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";

class ModifyOtherCharacters extends HostedService {
	constructor() {
		super();

		function updateCharacter(char?: Model) {
			if (!char) return;
			PartUtils.applyToAllDescendantsOfType("BasePart", char, (instance) => {
				// Massless is ignored on an assembly's root anyway, and on this one it would only let a welded block take
				// the root on this client alone. Replication follows the root, so the wearer of a back mount would freeze here.
				if (instance.Name !== "HumanoidRootPart") instance.Massless = true;
				// fixme: per-player collision belongs on the server — client-side no-collide is one-sided
				// instance.CanCollide = false;
				instance.EnableFluidForces = false;
			});
		}

		const preparePlayer = (plr: Player) => {
			if (plr === Players.LocalPlayer) return;
			// if (plr.Character) updateCharacter(plr);
			this.event
				.readonlyObservableFromInstanceParam(plr, "Character") //
				.subscribe((char?: Model) => {
					task.wait(0.1);
					updateCharacter(char);
				}, true);

			// plr.CharacterAdded.Connect(() => {
			// 	task.wait();
			// 	updateCharacter(plr);
			// });
		};

		this.onEnable(() => {
			this.event.subscribe(SharedRagdoll.event.sent, () =>
				Players.GetPlayers().forEach((plr) => updateCharacter(plr.Character)),
			);
			PlayerWatcher.onJoin(preparePlayer);
			Players.GetPlayers().forEach((value) => preparePlayer(value));
		});
	}
}

export namespace OtherPlayersController {
	export function initializeMassless(host: GameHostBuilder): void {
		host.services.registerService(ModifyOtherCharacters);
	}
}
