import { castCursor } from "client/CursorService";
import { MaterialColorEditControl } from "client/gui/buildmode/MaterialColorEditControl";
import { ToggleControl } from "client/gui/controls/ToggleControl";
import { MultiBlockSelector } from "client/tools/highlighters/MultiBlockSelector";
import { ToolBase } from "client/tools/ToolBase";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { Component } from "engine/shared/component/Component";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { BlockManager } from "shared/building/BlockManager";
import type { ToggleControlDefinition } from "client/gui/controls/ToggleControl";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { ClientBuilding } from "client/modes/build/ClientBuilding";
import type { Keybinds } from "engine/client/Keybinds";

namespace Scene {
	@injectable
	export class PaintToolScene extends Component {
		readonly tool;

		constructor(@inject tool: PaintTool, @inject mainScreen: MainScreenLayout) {
			super();
			this.tool = tool;

			const enable = () => {
				// to not paint a block
				task.wait();

				this.tool.controller.enable();
			};
			const disable = () => {
				this.tool.controller.disable();
			};

			const newToggle = (name: string, value: ObservableValue<boolean>) => {
				const template = Interface.getInterface<{
					Tools: {
						Shared: {
							Bottom: {
								Toggle: GuiObject & {
									readonly Data: { readonly TitleLabel: TextLabel };
									readonly Toggle: ToggleControlDefinition;
								};
							};
						};
					};
				}>().Tools.Shared.Bottom.Toggle;

				const gui = template.Clone();
				gui.Data.TitleLabel.Text = name.upper();
				gui.Visible = true;

				const control = new Control(gui);
				const toggle = control.parent(new ToggleControl(gui.Toggle));
				value.connect(toggle.value);

				return control;
			};

			const topLayer = this.parentGui(mainScreen.top.push());
			topLayer.parentGui(newToggle("Colors", tool.enableColor));
			topLayer.parentGui(newToggle("Materials", tool.enableMaterial));

			this.parentGui(mainScreen.right.push("PAINT COLORS")) //
				.addButtonAction(() => this.paintEverything(true, false));
			this.parentGui(mainScreen.right.push("PAINT MATERIALS")) //
				.addButtonAction(() => this.paintEverything(false, true));

			const layer = this.parentGui(mainScreen.bottom.push());
			const materialColorEditor = layer.parent(MaterialColorEditControl.autoCreate(true));
			materialColorEditor.autoSubscribe(tool.selectedMaterial, tool.selectedColor);

			materialColorEditor.materialPipette.onStart.Connect(disable);
			materialColorEditor.materialPipette.onEnd.Connect(enable);
			materialColorEditor.colorPipette.onStart.Connect(disable);
			materialColorEditor.colorPipette.onEnd.Connect(enable);
		}

		private paintEverything(enableColor?: boolean, enableMaterial?: boolean) {
			this.tool.paintEverything(enableColor, enableMaterial);
		}
	}
}

class Controller extends Component {
	constructor(tool: PaintTool, keybinds: Keybinds) {
		super();

		const fireSelected = (blocks: readonly BlockModel[]) => {
			if (!blocks || blocks.size() === 0) return;

			tool.paint(blocks);
		};
		const stuff = this.parent(new MultiBlockSelector(tool.mode.targetPlot, undefined, keybinds));
		stuff.submit.Connect(fireSelected);

		this.event.subInput((ih) => {
			const pick = () => {
				if (Interface.isCursorOnVisibleGui()) return;

				const [material, color] = this.pick();
				if (!material || !color) return;

				tool.selectedMaterial.set(material);
				tool.selectedColor.set(color);
			};

			ih.onMouse3Down(pick, false);
			ih.onKeyDown("P", pick);
		});
	}

	private pick() {
		const target = castCursor("world")?.part;
		if (!target) return $tuple();

		const block = BlockManager.getBlockDataByPart(target);
		if (!block) return $tuple();

		return $tuple(block.material, block.color);
	}
}

@injectable
export class PaintTool extends ToolBase {
	readonly selectedMaterial = new ObservableValue<Enum.Material>(Enum.Material.Plastic);
	readonly selectedColor = new ObservableValue<Color4>({ color: Color3.fromRGB(255, 255, 255), alpha: 1 });
	readonly enableMaterial = new ObservableValue(true);
	readonly enableColor = new ObservableValue(true);
	readonly controller;

	constructor(
		@inject mode: BuildingMode,
		@inject keybinds: Keybinds,
		@inject private readonly clientBuilding: ClientBuilding,
		@inject di: DIContainer,
	) {
		super(mode);

		this.parent(di.resolveForeignClass(Scene.PaintToolScene));
		this.controller = this.parent(new Controller(this, keybinds));
	}

	paintEverything(enableColor?: boolean, enableMaterial?: boolean) {
		return this.clientBuilding.paintOperation.execute({
			plot: this.targetPlot.get(),
			blocks: "all",
			material: (enableMaterial ?? this.enableMaterial.get()) ? this.selectedMaterial.get() : undefined,
			color: (enableColor ?? this.enableColor.get()) ? this.selectedColor.get() : undefined,
		});
	}
	paint(
		blocks: readonly BlockModel[],
		original?: ReadonlyMap<BlockModel, { readonly material: Enum.Material; readonly color: Color4 }>,
	) {
		return this.clientBuilding.paintOperation.execute({
			plot: this.targetPlot.get(),
			blocks,
			material: this.enableMaterial.get() ? this.selectedMaterial.get() : undefined,
			color: this.enableColor.get() ? this.selectedColor.get() : undefined,
			original,
		});
	}

	getDisplayName(): string {
		return "Painting";
	}
	getImageID(): string {
		return "http://www.roblox.com/asset/?id=15895846447";
	}
}
