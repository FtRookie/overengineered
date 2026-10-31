import { RunService, Workspace } from "@rbxts/services";
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
		const spawn = plot.instance.WaitForChild("SpawnLocation") as SpawnLocation;
		player.RespawnLocation = spawn;

		// a disabled spawn is ignored as RespawnLocation, and an enabled one also takes plotless players' spawns
		const openOnDeath = (character: Model) =>
			character.FindFirstChildOfClass("Humanoid")?.Died.Once(() => (spawn.Enabled = true));
		// measured in Studio: parented at the default 0,18,22.5, moved to the spawn by the next Heartbeat
		const closeOnceSpawned = (character: Model) => {
			const close = () =>
				RunService.Heartbeat.Once(() => {
					// died again within the frame; that death reopened it
					if ((character.FindFirstChildOfClass("Humanoid")?.Health ?? 0) <= 0) return;
					spawn.Enabled = false;
				});
			if (character.IsDescendantOf(Workspace)) {
				close();
				return;
			}

			const connection = character.AncestryChanged.Connect(() => {
				if (!character.IsDescendantOf(Workspace)) return;

				connection.Disconnect();
				close();
			});
		};

		if (player.Character) openOnDeath(player.Character);
		this.event.subscribe(player.CharacterAdded, (character) => {
			openOnDeath(character);
			closeOnceSpawned(character);
		});

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
			spawn.Enabled = false;
			plot.ownerId.set(undefined);
			plot.blacklistedPlayers.set(undefined);
			plot.isolationMode.set(undefined);

			this.blocks.unparent();
			task.delay(1, () => this.blocks.destroy());
		});
	}
}
