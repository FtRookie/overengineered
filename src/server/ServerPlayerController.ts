import { Component } from "engine/shared/component/Component";
import { ServerBuildingRequestController } from "server/building/ServerBuildingRequestController";
import { ServerSlotRequestController } from "server/building/ServerSlotRequestController";
import { asPlayerId } from "server/PlayerId";
import { ServerPlotController } from "server/plots/ServerPlotController";
import { ServerPlayerDataRemotesController } from "server/ServerPlayerDataRemotesController";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import { CustomRemotes } from "shared/Remotes";
import { PlayerDataRemotes } from "shared/remotes/PlayerDataRemotes";
import { SlotsMeta } from "shared/SlotsMeta";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { SlotDatabase } from "server/database/SlotDatabase";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { BuildingPlot } from "shared/building/BuildingPlot";
import type { SharedPlot } from "shared/building/SharedPlot";
import type { PlayerDataStorageRemotes } from "shared/remotes/PlayerDataRemotes";

@injectable
export class ServerPlayerController extends Component {
	readonly remotesFolder: Instance;
	readonly remotes: PlayerDataStorageRemotes;

	readonly plotController;

	constructor(
		@inject readonly player: Player,
		@inject readonly plot: SharedPlot,
		@inject playModeController: PlayModeController,
		@inject slots: SlotDatabase,
		@inject playerData: PlayerDatabase,
		@inject di: DIContainer,
	) {
		super();

		const playerId = player.UserId;
		$log(`Creating server player controller for ${playerId} ${player.Name}`);
		this.onDestroy(() => $log(`Destroying server player controller for ${playerId} ${player.Name}`));

		const dataController = this.parent(ServerPlayerDataRemotesController.create(di, playerId));
		this.remotesFolder = dataController.remotesFolder;
		const buildingRemotes = PlayerDataRemotes.createBuilding(this.remotesFolder);
		this.cacheDI(buildingRemotes);

		this.remotes = {
			slots: dataController.slotRemotes,
			player: dataController.playerRemotes,
			building: buildingRemotes,
		};

		di = di.beginScope((builder) => {
			builder.registerSingletonValue(asPlayerId(playerId));

			builder.registerSingletonValue(dataController.slotRemotes);
			builder.registerSingletonValue(dataController.playerRemotes);
			builder.registerSingletonValue(buildingRemotes);
			builder.registerSingletonValue(this.remotes);

			builder.registerSingletonClass(ServerPlotController);

			builder.registerSingletonClass(ServerBuildingRequestController);

			builder.registerSingletonClass(ServerSlotRequestController);
			builder.registerSingletonValue(plot);
			builder.registerSingletonFunc((ctx) => ctx.resolve<ServerPlotController>().blocks);
		});

		this.plotController = this.parent(di.resolve<ServerPlotController>());
		this.parent(di.resolve<ServerSlotRequestController>());
		this.parent(di.resolve<ServerBuildingRequestController>());

		const blocks = di.resolve<BuildingPlot>();

		// quit / autosave go to the external db like any other slot: the datastore dies with the experience.
		const savePlot = () => {
			const save = playModeController.getPlayerModeById(playerId) === "build" && blocks.getBlocks().size() !== 0;

			if (save) {
				slots.setBlocks(playerId, SlotsMeta.quitSlotIndex, BlocksSerializer.serializeToObject(blocks));
			} else {
				slots.setBlocksFromAnotherSlot(playerId, SlotsMeta.quitSlotIndex, SlotsMeta.lastRunSlotIndex);
			}
		};
		this.onDestroy(savePlot);

		this.event.loop(5 * 60, () => {
			$log(`Saving ${player.Name} plot to autosave...`);

			const save = playModeController.getPlayerModeById(playerId) === "build" && blocks.getBlocks().size() !== 0;

			if (save) {
				slots.setBlocks(playerId, SlotsMeta.autosaveSlotIndex, BlocksSerializer.serializeToObject(blocks));
			} else {
				slots.setBlocksFromAnotherSlot(playerId, SlotsMeta.autosaveSlotIndex, SlotsMeta.lastRunSlotIndex);
			}

			CustomRemotes.updateSaves.send(player, playerData.get(player.UserId).slots ?? []);
		});
	}
}
