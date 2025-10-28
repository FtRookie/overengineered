import { BadgeService } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { PlayerWatcher } from "engine/shared/PlayerWatcher";

@injectable
export class BadgeController extends HostedService {
	// Updated for 10/21/2025
	private readonly placeId = 116247414183109;
	private readonly badges = {
		BETA: 4025402536290574,
	} as const;

	constructor() {
		super();

		this.event.subscribeCollectionAdded(PlayerWatcher.players, (player) => {
			player.CharacterAdded.Once(() => {
				try {
					// BETA badge
					if (!BadgeService.UserHasBadgeAsync(player.UserId, this.badges.BETA)) {
						if (game.PlaceId !== this.placeId) {
							$log(`BadgeController is not configured for this place, skipping "BETA" badge award.`);
							return;
						}
						BadgeService.AwardBadge(player.UserId, this.badges.BETA);
					}
				} catch {
					$log(`Failed to give badge to ${player.Name}`);
				}
			});
		});
	}
}
