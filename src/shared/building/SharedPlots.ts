import { Workspace } from "@rbxts/services";
import { SharedPlot } from "shared/building/SharedPlot";

const plotsFolder = Workspace.WaitForChild("Plots");

const count = plotsFolder.GetAttribute("count") as number | undefined;
if (plotsFolder.GetChildren().size() !== count) {
	$warn(
		`[plots] Target plot count ${count} is not equal to loaded plot count ${plotsFolder.GetChildren().size()}, waiting...`,
	);
}
while (plotsFolder.GetChildren().size() !== count) {
	task.wait();
}
for (const plot of plotsFolder.GetChildren()) {
	plot.WaitForChild("BuildingArea");
}

/** Reading the plots data */
export class SharedPlots {
	static instance: SharedPlots;

	static initialize() {
		const plots: readonly SharedPlot[] = (plotsFolder.GetChildren() as unknown as PlotModel[])
			.map((p) => new SharedPlot(p).with((c) => c.enable()))
			.sort((left, right) => left.instance.Name < right.instance.Name);
		const plotComponents: ReadonlyMap<PlotModel, SharedPlot> = new Map(plots.map((p) => [p.instance, p]));

		return (this.instance = new SharedPlots(plots, plotComponents));
	}

	constructor(
		readonly plots: readonly SharedPlot[],
		private readonly plotComponents: ReadonlyMap<PlotModel, SharedPlot>,
	) {}

	waitForPlot(userid: number) {
		while (!this.tryGetPlotByOwnerID(userid)) {
			task.wait(0.2);
		}

		return this.getPlotComponentByOwnerID(userid);
	}

	/** Checks if player is allowed to build on the prodived plot */
	isBuildingAllowed(plot: PlotModel, playerId: number): boolean {
		return this.plotComponents.get(plot)!.isBuildingAllowed(playerId);
	}

	/** Returns the player owned plot, if exists */
	tryGetPlotByOwnerID(ownerID: number): SharedPlot | undefined {
		for (const plot of this.plots) {
			if (plot.ownerId.get() === ownerID) {
				return plot;
			}
		}

		return undefined;
	}
	/** Returns the player owned plot, if exists */
	static staticTryGetPlotByOwnerID(ownerID: number): PlotModel | undefined {
		for (const plot of plotsFolder.GetChildren() as unknown as PlotModel[]) {
			if ((plot.GetAttribute("ownerid") as number) === ownerID) {
				return plot;
			}
		}

		return undefined;
	}

	/** Returns the plot component by the plot model */
	getPlotComponent(plot: PlotModel): SharedPlot {
		return this.plotComponents.get(plot)!;
	}

	/** Returns the player owned plot */
	getPlotComponentByOwnerID(ownerID: number): SharedPlot {
		const plot = this.tryGetPlotByOwnerID(ownerID);
		if (!plot) throw `Player ${ownerID} does not have a plot`;

		return plot;
	}

	/** Returns the player owned plot */
	getPlotByOwnerID(ownerID: number): PlotModel {
		return this.getPlotComponentByOwnerID(ownerID).instance;
	}
}
