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
				instance.Massless = true;
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
			this.event.subscribe(SharedRagdoll.event.sent, () =>
				Players.GetPlayers().forEach((plr) => updateCharacter(plr.Character)),
			);

			// plr.CharacterAdded.Connect(() => {
			// 	task.wait();
			// 	updateCharacter(plr);
			// });
		};

		this.onEnable(() => {
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
