import { Players } from "@rbxts/services";
import { TooltipsHolder } from "client/gui/static/TooltipsControl";
import { Component } from "engine/shared/component/Component";
import { Objects } from "engine/shared/fixes/Objects";
import type { Tooltip } from "client/gui/static/TooltipsControl";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ComponentEvents } from "engine/shared/component/ComponentEvents";
import type { SharedPlot } from "shared/building/SharedPlot";

/** An abstract class of tools for working with the world */
export abstract class ToolBase extends Component {
	readonly mirrorMode;
	readonly targetPlot;

	protected readonly mouse: Mouse;
	readonly mode: BuildingMode;
	protected readonly tooltipHolder: TooltipsHolder;

	constructor(mode: BuildingMode) {
		super();
		this.mode = mode;
		this.mirrorMode = mode.mirrorMode;
		this.targetPlot = mode.targetPlot.asReadonly();

		this.tooltipHolder = this.parent(TooltipsHolder.createComponent(this.getDisplayName()));
		this.tooltipHolder.set(this.getTooltips());

		this.mouse = Players.LocalPlayer.GetMouse();
	}

	subscribeSomethingToCurrentPlot(
		state: Component & { readonly event: ComponentEvents },
		func: (plot: SharedPlot) => void,
	) {
		state.event.subscribeObservable(
			this.targetPlot,
			(plot) => {
				state.event.eventHandler.subscribe(plot.changed, () => func(plot));
				func(plot);
			},
			true,
		);
	}
	protected subscribeToCurrentPlot(func: (plot: SharedPlot) => void) {
		this.subscribeSomethingToCurrentPlot(this, func);
	}

	supportsMirror() {
		return false;
	}

	/** The name of the tool, for example: `Example Mode` */
	abstract getDisplayName(): string;

	/** Image of the tool*/
	abstract getImageID(): string;

	protected getTooltips(): readonly Tooltip[] {
		return Objects.empty;
	}
}
