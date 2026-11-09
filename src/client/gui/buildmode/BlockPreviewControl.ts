import { RunService } from "@rbxts/services";
import { Control } from "engine/client/gui/Control";

const spinning = new Set<BlockPreviewControl>();
let spinConnection: RBXScriptConnection | undefined;

const spinAll = (dt: number) => {
	const rotation = CFrame.fromEulerAnglesXYZ((math.pi / 3) * dt, (math.pi / 2) * dt, 0);
	for (const preview of spinning) preview.spin(rotation);
};

export class BlockPreviewControl extends Control<ViewportFrame> {
	private block?: BlockModel;

	constructor(gui: ViewportFrame, block?: BlockModel) {
		super(gui);
		this.set(block);

		this.onEnable(() => {
			spinning.add(this);
			spinConnection ??= RunService.PostSimulation.Connect(spinAll);
		});
		const stop = () => {
			spinning.delete(this);
			if (spinning.size() !== 0) return;

			spinConnection?.Disconnect();
			spinConnection = undefined;
		};
		this.onDisable(stop);
		this.onDestroy(stop);
	}

	spin(rotation: CFrame) {
		if (this.block) this.block.PivotTo(this.block.GetPivot().mul(rotation));
	}

	set(block: BlockModel | undefined) {
		this.gui.ClearAllChildren();

		if (block) {
			const size = block.GetExtentsSize();
			const pivot = new CFrame(new Vector3(0, 0.2, -2 - size.findMax())).mul(
				this.block?.GetPivot()?.Rotation ?? CFrame.identity,
			);

			this.block = block.Clone();
			this.block.PivotTo(pivot);
			this.block.Parent = this.gui;
		}
	}
}
