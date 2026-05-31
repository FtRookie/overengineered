import { HttpService, Players } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { Objects } from "engine/shared/fixes/Objects";
import { PlayerWatcher } from "engine/shared/PlayerWatcher";
import { AvatarUtils } from "server/AvatarUtils";
import { CustomRemotes } from "shared/Remotes";

const replace: Record<number, number> = {
	10897692300: 238427763, // Maks_gaming2 -> FtRookie
	8377191303: 148819022, // samlovedeveloping -> samlovebutter
	8215244948: 2880942160, // rickjealous139 -> 3QAXM
	4285679295: 1881021153, // deunins_ai -> DeunOrDedon
	//00000000: 5243461283, // ???? -> i3ymm
};

export class AvatarReskinController extends HostedService {
	constructor() {
		super();

		const DisableFor = new Set<number>();

		this.event.subscribeRegistration(() =>
			PlayerWatcher.onCharacterAdded((character, player) => {
				if (!Objects.keys(replace).contains(player.UserId)) return;
				if (DisableFor.has(player.UserId)) return;
				const entry = replace[player.UserId];
				if (!entry) return;

				const humanoid = character.FindFirstChildOfClass("Humanoid");
				if (!humanoid) return;

				if (entry === 238427763) {
					// Im not terminated
					const description = Players.GetHumanoidDescriptionFromUserId(entry);
					humanoid.ApplyDescription(description);
					return;
				}

				AvatarUtils.DeserializeAndApplyAvatar(
					humanoid,
					HttpService.RequestAsync({
						Method: "GET",
						Url: `https://avatar.roproxy.com/v1/users/${entry}/avatar`,
					}).Body,
				);
			}),
		);
		this.event.subscribe(CustomRemotes.admin.adminToggleMimic.invoked, (invoker, state) => {
			if (state) {
				DisableFor.delete(invoker.UserId);
			} else {
				DisableFor.add(invoker.UserId);
			}
		});
	}
}
