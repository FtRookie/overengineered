import { HttpService, Players } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { Objects } from "engine/shared/fixes/Objects";
import { PlayerWatcher } from "engine/shared/PlayerWatcher";
import { AvatarUtils } from "server/AvatarUtils";
import { CustomRemotes } from "shared/Remotes";

const replace: Record<number, number> = {
	10897692300: 238427763, // Maks_gaming2 -> FtRookie
	//8377191303: 148819022, // samlovedeveloping -> samlovebutter (temporarily disabled, see itemReplace)
	8215244948: 2880942160, // rickjealous139 -> 3QAXM
	4285679295: 1881021153, // deunins_ai -> DeunOrDedon
	//00000000: 5243461283, // ???? -> i3ymm
};

// replaces only the listed items on top of the player's own avatar instead of a full reskin
const itemReplace: Record<number, { readonly head?: number; readonly pants?: number }> = {
	// samlovedeveloping: Mogger Face V2 Light Blue (dynamic head asset inside bundle 186688870622374) + Heart Boxers
	8377191303: { head: 112841165846748, pants: 10546832797 },
};

export class AvatarReskinController extends HostedService {
	constructor() {
		super();

		const DisableFor = new Set<number>();

		this.event.subscribeRegistration(() =>
			PlayerWatcher.onCharacterAdded((character, player) => {
				if (DisableFor.has(player.UserId)) return;

				const items = itemReplace[player.UserId];
				if (items) {
					const humanoid = character.FindFirstChildOfClass("Humanoid");
					if (!humanoid) return;

					const description = Players.GetHumanoidDescriptionFromUserId(player.UserId);
					if (items.head !== undefined) description.Head = items.head;
					if (items.pants !== undefined) description.Pants = items.pants;
					humanoid.ApplyDescription(description);
					return;
				}

				if (!Objects.keys(replace).contains(player.UserId)) return;
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
