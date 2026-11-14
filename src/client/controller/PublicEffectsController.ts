import { Players } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { PublicEffects } from "shared/blocks/PublicEffects";
import { CustomRemotes } from "shared/Remotes";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

@injectable
export class PublicEffectsController extends HostedService {
	constructor(@inject playerData: PlayerDataStorage) {
		super();

		const localId = Players.LocalPlayer.UserId;
		const othersOnly = (block: BlockModel) => PublicEffects.ownerOf(block) !== localId;

		let previous = playerData.config.get().replication;
		this.event.subscribeObservable(playerData.config, ({ replication }) => {
			for (const key of PublicEffects.keys) {
				if (previous[key] && !replication[key]) PublicEffects.stop(key, othersOnly);
			}
			previous = replication;
		});

		this.event.subscribe(CustomRemotes.publicEffectsDisabled.invoked, ({ userId, keys }) => {
			for (const key of keys) {
				PublicEffects.stop(key, (block) => PublicEffects.ownerOf(block) === userId);
			}
		});
	}
}
