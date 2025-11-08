import { Players } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { Element } from "engine/shared/Element";
import { PlayerDataController } from "server/PlayerDataController";
import { PlayerDataRemotes } from "shared/remotes/PlayerDataRemotes";

@injectable
export class ServerPlayerDataRemotesController extends Component {
	/**
	 * @param playerId ID of the player to get the data for
	 * @param player Player that the remotes folder is parented to
	 */
	static create(di: DIContainer, playerId: number, player?: Player): ServerPlayerDataRemotesController {
		player ??= Players.GetPlayerByUserId(playerId);
		if (!player) throw `Player ${playerId} is not online`;

		const remotesFolder = Element.create("ScreenGui", { Parent: player.WaitForChild("PlayerGui") });
		remotesFolder.ResetOnSpawn = false;
		remotesFolder.Name = "Remotes";

		return di.resolveForeignClass(ServerPlayerDataRemotesController, [playerId, remotesFolder]);
	}

	readonly slotRemotes;
	readonly playerRemotes;

	constructor(
		readonly playerId: number,
		readonly remotesFolder: Instance,
		@inject di: DIContainer,
	) {
		super();
		ComponentInstance.init(this, remotesFolder);

		this.slotRemotes = PlayerDataRemotes.createSlots(remotesFolder);
		this.playerRemotes = PlayerDataRemotes.createPlayer(remotesFolder);

		this.parent(di.resolveForeignClass(PlayerDataController, [playerId, this.playerRemotes]));
	}
}
