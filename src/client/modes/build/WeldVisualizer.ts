import { ReplicatedStorage, Workspace } from "@rbxts/services";
import { Interface } from "engine/client/gui/Interface";
import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { ComponentStateContainer } from "engine/shared/component/ComponentStateContainer";
import { Transforms } from "engine/shared/component/Transforms";
import { Element } from "engine/shared/Element";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { BlockManager } from "shared/building/BlockManager";
import { SharedPlot } from "shared/building/SharedPlot";
import { Colors } from "shared/Colors";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { ActionController } from "client/modes/build/ActionController";
import type { PlayerDataStorageRemotes } from "shared/remotes/PlayerDataRemotes";

@injectable
export class WeldVisualizer extends Component {
	private readonly viewportFrame: ViewportFrame;

	private readonly free: Part[] = [];
	private readonly rendered: Part[] = [];
	private machineCOM: Model | undefined;

	constructor(
		parent: Instance,
		@inject actionController: ActionController,
		@inject playerRemotes: PlayerDataStorageRemotes,
	) {
		super();

		const prefab = Element.create("Part", {
			Anchored: true,
			CanCollide: false,
			CanQuery: false,
			CanTouch: false,
			CastShadow: false,

			Material: Enum.Material.Neon,
			Transparency: 0.2,
			Shape: Enum.PartType.Cylinder,
			Color: Colors.red,
		});

		this.viewportFrame = Element.create("ViewportFrame", {
			Name: "Welds",
			Size: UDim2.fromScale(1, 1),
			CurrentCamera: Workspace.CurrentCamera,
			Transparency: 1,
			Ambient: Colors.white,
			LightColor: Colors.white,
			ZIndex: -1000,
			Parent: Interface.getInterface(),
		});
		ComponentInstance.init(this, this.viewportFrame);

		const startFrame = () => {
			for (const item of this.rendered) {
				this.free.push(item);
				item.Parent = undefined;
			}

			this.rendered.clear();
		};
		const nextWeldInstance = (): Part => {
			const item = this.free.pop() ?? prefab.Clone();

			this.rendered.push(item);
			item.Parent = this.viewportFrame;
			return item;
		};

		const update = () => {
			if (!this.machineCOM) {
				this.machineCOM = ReplicatedStorage.Assets.Helpers.CenterOfMassMachine.Clone();
				this.machineCOM.Parent = this.viewportFrame;
			}

			startFrame();

			const blocks = parent.GetChildren() as BlockModel[];
			for (const block of blocks) {
				for (const weld of block.GetDescendants().filter((c) => c.IsA("WeldConstraint"))) {
					const block1 = BlockManager.tryGetBlockModelByPart(weld.Part0);
					const block2 = BlockManager.tryGetBlockModelByPart(weld.Part1);
					if (!block1 || !block2 || block1 === block2) {
						continue;
					}

					const pos1 = block1.GetPivot().Position;
					const pos2 = block2.GetPivot().Position;

					const cloned = nextWeldInstance();
					cloned.Parent = this.viewportFrame;

					const distance = pos1.sub(pos2).Magnitude;
					cloned.Size = new Vector3(distance - 0.4, 0.07, 0.07);
					cloned.CFrame = new CFrame(pos2, pos1)
						.mul(new CFrame(0, 0, -distance / 2))
						.mul(CFrame.Angles(0, math.rad(90), 0));
				}
			}
		};

		const clear = () => {
			for (const b of this.rendered) {
				b.Destroy();
			}

			this.rendered.clear();
		};

		this.event.subscribe(actionController.onRedo, update);
		this.event.subscribe(actionController.onUndo, update);
		this.event.subscribe(playerRemotes.slots.load.sent, clear);
		this.event.subscribe(playerRemotes.slots.load.completed, (v) => (v.success ? update() : undefined));
		this.event.subscribe(SharedPlot.anyChanged, update);

		this.onEnabledStateChange((enabled) => {
			if (enabled) update();
			else clear();
		});
	}
}

@injectable
export class WeldVisualizerController extends Component {
	constructor(
		@inject mainScreen: MainScreenLayout,
		@inject plot: SharedPlot,
		@inject actionController: ActionController,
		@inject playerRemotes: PlayerDataStorageRemotes,
	) {
		super();

		const visualizerState = ComponentStateContainer.create(
			this,
			new WeldVisualizer(plot.instance.WaitForChild("Blocks"), actionController, playerRemotes),
		);

		const enabledByButton = new ObservableValue(false);
		visualizerState.subscribeAndFrom({ enabledByButton });
		const button = this.parentGui(mainScreen.addTopRightButton("CenterOfMass", 84532983912875)) //
			.addButtonAction(() => enabledByButton.set(!enabledByButton.get()));

		this.event.subscribeObservable(
			visualizerState,
			(enabled) =>
				Transforms.create()
					.transform(button.instance, "Transparency", enabled ? 0 : 0.5, Transforms.commonProps.quadOut02)
					.run(button.instance),
			true,
		);
	}
}
