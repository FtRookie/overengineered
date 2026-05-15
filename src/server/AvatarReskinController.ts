import { HttpService, Players } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { PlayerWatcher } from "engine/shared/PlayerWatcher";
import { AvatarUtils } from "server/AvatarUtils";

const replace: Record<number, number> = {
	10897692300: 238427763, // Maks_gaming2 -> FtRookie
	8377191303: 148819022, // samlovedeveloping -> samlovebutter
	8215244948: 2880942160, // rickjealous139 -> 3QAXM
};

export class AvatarReskinController extends HostedService {
	constructor() {
		super();
		this.event.subscribeRegistration(() =>
			PlayerWatcher.onCharacterAdded((character, player) => {
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
	}
}
