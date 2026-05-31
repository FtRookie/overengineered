import { RunService } from "@rbxts/services";
import { Control } from "engine/client/gui/Control";

export class BlockPreviewControl extends Control<ViewportFrame> {
	private block?: BlockModel;

	constructor(gui: ViewportFrame, block?: BlockModel) {
		super(gui);
		this.set(block);

		this.event.subscribe(RunService.PostSimulation, (dt) => {
			if (this.block)
				this.block.PivotTo(
					this.block.GetPivot().mul(CFrame.fromEulerAnglesXYZ((math.pi / 3) * dt, (math.pi / 2) * dt, 0)),
				);
		});
	}

	set(block: BlockModel | undefined) {
		this.gui.ClearAllChildren();

		if (block) {
			const size = block.GetExtentsSize();
			const pivot = new CFrame(new Vector3(0, 0.2, -2 - math.max(size.X, size.Y, size.Z))).mul(
				this.block?.GetPivot()?.Rotation ?? CFrame.identity,
			);

			this.block = block.Clone();
			this.block.PivotTo(pivot);
			this.block.Parent = this.gui;
		}
	}
}
