import { Workspace } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { ReplicatedAssets } from "shared/ReplicatedAssets";
import type { BlockLogicTickContext, GenericBlockLogic } from "shared/blockLogic/BlockLogic";
import type { BlockLogicRunner } from "shared/blockLogic/BlockLogicRunner";

export class LogicVisualizer extends Component {
	constructor(runner: BlockLogicRunner, blocks: readonly GenericBlockLogic[]) {
		super();

		const parent = new Instance("Folder", Workspace);
		parent.Name = "LogicVisualizer";
		ComponentInstance.init(this, parent);

		type label = BillboardGui & { readonly Label: TextLabel };
		const labelMap = new Map<GenericBlockLogic, label>();

		const labelTemplate = this.asTemplate(ReplicatedAssets.waitForAsset<label>("Wires", "MarkerValue"), false);

		const setLabelsEnabled = (enabled: boolean) => {
			for (const [, label] of labelMap) {
				label.Enabled = enabled;
			}
		};
		this.onEnable(() => setLabelsEnabled(true));
		this.onEnable(() => setLabelsEnabled(false));

		const tick = (ctx: BlockLogicTickContext) => {
			for (const block of blocks) {
				const label = labelMap.getOrSet(block, () => {
					const label = labelTemplate();
					label.AlwaysOnTop = true;
					label.Name = block.instance!.Name;
					label.Adornee = block.instance!;
					label.Parent = parent;

					return label;
				});

				const info = block.getDebugInfo(ctx);
				label.Label.Text = info.join("\n");
			}
		};
		this.event.subscribeRegistration(() => runner.onAfterTick(tick));
		this.onEnable(() => tick(runner.getContext(false)));
	}
}
