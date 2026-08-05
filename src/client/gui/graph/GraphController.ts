import { LoadingController } from "client/controller/LoadingController";
import { GraphManagerWindow } from "client/gui/graph/GraphManagerWindow";
import { GraphOutputPicker } from "client/gui/graph/GraphOutputPicker";
import { GraphSampler } from "client/gui/graph/GraphSampler";
import { GraphSessionStore } from "client/gui/graph/GraphSessionStore";
import { GraphWindow } from "client/gui/graph/GraphWindow";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { HostedService } from "engine/shared/di/HostedService";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { CustomRemotes } from "shared/Remotes";
import type { GraphGroup } from "client/gui/graph/GraphSessionStore";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { PlayModeController } from "client/modes/PlayModeController";
import type { RideMode } from "client/modes/ride/RideMode";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { SharedPlot } from "shared/building/SharedPlot";

const BUTTON_ICON = 86496861118770;

/**
 * Owns the graphing tool for the whole session.
 *
 * A root service rather than a mode child on purpose: every other floating window dies with its mode, but the
 * captured samples have to outlive the machine that produced them so a graph stays readable back in build mode.
 * The sampler is the only part tied to a ride, and it writes into buffers the store owns.
 */
@injectable
export class GraphController extends HostedService {
	readonly store = new GraphSessionStore();
	readonly visible = new ObservableValue(false);

	private readonly sampler = this.parent(new ComponentChild<GraphSampler>(true));

	constructor(
		@inject mainScreen: MainScreenLayout,
		@inject playMode: PlayModeController,
		@inject rideMode: RideMode,
		@inject plot: SharedPlot,
		@inject playerData: PlayerDataStorage,
		@inject di: DIContainer,
	) {
		super();

		// One picker for every graph: arming a second while one is live would leave orphan markers on screen.
		const picker = this.parent(di.resolveForeignClass(GraphOutputPicker));

		this.parent(mainScreen.addTopRightButton("Graphs", BUTTON_ICON)) //
			.addButtonAction(() => this.visible.toggle())
			.subscribeVisibilityFrom({ isntLoading: LoadingController.isNotLoading });

		this.parent(new GraphManagerWindow(this.store, this.visible));

		// The sampler only re-checks bindings at ride start, so a block deleted in build mode would otherwise leave
		// its series looking live. Not run eagerly: tryGetBlock waits on the Blocks folder, and there is nothing
		// bound at service construction anyway.
		// Deferred: the plot reports a change before a restored block is necessarily parented under Blocks, and
		// tryGetBlock resolves by name, so an undo checked inline reads as though the block were still missing —
		// and nothing re-checks afterwards.
		const refreshBindings = () =>
			task.defer(() => this.store.refreshBindings((uuid) => plot.tryGetBlock(uuid) !== undefined));

		this.event.subscribe(plot.changed, refreshBindings);
		// A block broken mid-ride never edits the plot, so the damage system is the only signal that it is gone.
		// Without it X goes on reading an output that will never produce again, and has no row to be cleared from.
		this.event.subscribe(CustomRemotes.damageSystem.broken.invoked, refreshBindings);

		// One window per group, added and removed individually rather than rebuilt wholesale: a full rebuild would
		// destroy and recreate every other window, throwing away the position and size they had been dragged to.
		const windows = this.parent(new ComponentChildren<GraphWindow>());
		const byGroup = new Map<GraphGroup, GraphWindow>();

		this.event.subscribeCollection(this.store.groups, (change) => {
			if (change.kind === "add") {
				for (const group of change.added) {
					byGroup.set(group, windows.add(new GraphWindow(this.store, group, picker, this.visible)));
				}

				return;
			}

			if (change.kind === "remove") {
				for (const group of change.removed) {
					const window = byGroup.get(group);
					if (!window) continue;

					byGroup.delete(group);
					windows.remove(window);
				}

				return;
			}

			byGroup.clear();
			windows.clear();
		});

		this.event.subscribeObservable(
			playMode.playmode,
			(mode) => {
				if (mode !== "ride") {
					// Leaving a ride ends recording but keeps every sample: build mode is where they get read.
					this.sampler.clear();
					return;
				}

				const machine = rideMode.getCurrentMachine();
				if (!machine) return;

				// Read per tick rather than captured: toggling the setting mid-ride takes effect immediately.
				this.sampler.set(
					new GraphSampler(
						this.store,
						machine,
						() => playerData.config.get().interface.graphing.sampleHidden,
					),
				);
			},
			true,
		);
	}
}
