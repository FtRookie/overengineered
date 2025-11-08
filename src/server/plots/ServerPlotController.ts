import { Component } from "engine/shared/component/Component";
import { Element } from "engine/shared/Element";
import { BuildingPlot } from "shared/building/BuildingPlot";
import { AutoPlotWelder } from "shared/building/PlotWelder";
import type { SharedPlot } from "shared/building/SharedPlot";

@injectable
export class ServerPlotController extends Component {
	readonly blocks;

	constructor(
		@inject readonly player: Player,
		@inject readonly plot: SharedPlot,
		@inject di: DIContainer,
	) {
		super();

		plot.ownerId.set(player.UserId);
		plot.blacklistedPlayers.set(undefined);
		plot.isolationMode.set(undefined);
		player.RespawnLocation = plot.instance.WaitForChild("SpawnLocation") as SpawnLocation;

		const initializeBlocksFolder = (plot: SharedPlot): PlotBlocks => {
			plot.instance.FindFirstChild("Blocks")?.Destroy();

			const blocks = Element.create("Folder", { Name: "Blocks" }) as PlotBlocks;
			blocks.Parent = plot.instance;

			return blocks;
		};

		this.blocks = di.resolveForeignClass(BuildingPlot, [
			initializeBlocksFolder(plot),
			plot.getCenter(),
			plot.bounds,
		]);
		this.blocks.initializeTimeBasedDelay();

		if (
			// !game.GetService("RunService").IsStudio() && // uncomment to enable private server behaviour in studio
			game.PrivateServerOwnerId === 0
		) {
			this.blocks.initializeDelay(10, 64, 64);
		} else {
			this.blocks.initializeDelay(50, 100, 100);
		}

		this.parent(di.resolveForeignClass(AutoPlotWelder, [this.blocks]));

		this.onDestroy(() => {
			plot.ownerId.set(undefined);
			plot.blacklistedPlayers.set(undefined);
			plot.isolationMode.set(undefined);

			this.blocks.unparent();
			task.delay(1, () => this.blocks.destroy());
		});
	}
}
