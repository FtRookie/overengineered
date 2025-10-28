import { Players, UserInputService } from "@rbxts/services";
import { HoveredPartHighlighter } from "client/tools/highlighters/HoveredPartHighlighter";
import { ButtonControl } from "engine/client/gui/Button";
import { Interface } from "engine/client/gui/Interface";
import { Element } from "engine/shared/Element";
import { EventHandler } from "engine/shared/event/EventHandler";
import { SlimFilter } from "engine/shared/event/SlimFilter";
import { SlimSignal } from "engine/shared/event/SlimSignal";
import { PlayerRank } from "engine/shared/PlayerRank";
import { BlockManager } from "shared/building/BlockManager";
import { BuildingManager } from "shared/building/BuildingManager";
import { Colors } from "shared/Colors";
import type { ButtonDefinition } from "engine/client/gui/Button";

export class BlockPipetteButton extends ButtonControl {
	readonly onStart = new SlimSignal();
	readonly onEnd = new SlimSignal();
	readonly onSelect = new SlimSignal<(part: BasePart | BlockModel) => void>();
	readonly filter = new SlimFilter<(part: BasePart | BlockModel) => boolean>();

	constructor(gui: ButtonDefinition) {
		super(gui);

		let stop: (() => void) | undefined;

		const g = (part: BasePart): BasePart | BlockModel | undefined => {
			if (!this.filter.Fire(part)) return;
			return BlockManager.tryGetBlockModelByPart(part) ?? part;
		};

		this.onDisable(() => stop?.());
		this.activated.Connect(() => {
			if (stop) {
				stop?.();
				return;
			}

			const visualFrame = Element.create(
				"Frame",
				{
					Size: new UDim2(1, 0, 1, 0),
					BackgroundColor3: Colors.accentLight,
					Parent: gui,
				},
				{ corner: Element.create("UICorner", { CornerRadius: new UDim(0, 8) }) },
			);

			this.onStart.Fire();

			const visualizer = new HoveredPartHighlighter(g);
			visualizer.enable();

			const eh = new EventHandler();
			stop = () => {
				visualFrame.Destroy();

				visualizer.destroy();
				eh.unsubscribeAll();
				this.onEnd.Fire();
				stop = undefined;
			};

			eh.subscribe(UserInputService.InputEnded, (input, gameProcessed) => {
				if (gameProcessed) return;
				if (Interface.isCursorOnVisibleGui()) return;
				if (input.UserInputType !== Enum.UserInputType.MouseButton1) return;

				const selected = visualizer.highlightedPart.get();
				if (!selected) return stop?.();

				this.onSelect.Fire(selected);
				stop?.();
			});
			eh.subscribe(UserInputService.TouchTap, (positions, gameProcessed) => {
				if (gameProcessed) return;
				if (Interface.isCursorOnVisibleGui()) return;

				let selected: BasePart | BlockModel | undefined = Players.LocalPlayer.GetMouse().Target;
				selected = selected && g(selected);
				if (!selected) return stop?.();

				this.onSelect.Fire(selected);
				stop?.();
			});
		});
	}

	static forMaterial(gui: ButtonDefinition, clicked: (material: Enum.Material) => void) {
		const pipette = new BlockPipetteButton(gui);

		const getMaterial = (part: BasePart | BlockModel) => {
			if (part.IsA("BasePart")) {
				return part.Material;
			}

			return BlockManager.manager.material.get(part);
		};
		pipette.onSelect.Connect((part) => clicked(getMaterial(part)));
		if (!PlayerRank.isAdmin(Players.LocalPlayer)) {
			pipette.filter.add((part) => BuildingManager.AllowedMaterials.includes(getMaterial(part)));
		}

		return pipette;
	}
	static forColor(gui: ButtonDefinition, clicked: (color: Color4) => void) {
		const pipette = new BlockPipetteButton(gui);
		pipette.onSelect.Connect((part) => {
			if (part.IsA("BasePart")) {
				clicked({ color: part.Color, alpha: 1 });
			} else {
				const data = BlockManager.manager.color.get(part);
				clicked(data);
			}
		});

		return pipette;
	}
	static forBlockId(gui: ButtonDefinition, clicked: (id: BlockId) => void) {
		const pipette = new BlockPipetteButton(gui);
		pipette.onSelect.Connect((part) => {
			if (part.IsA("BasePart")) {
				throw "What.";
			}

			const data = BlockManager.manager.id.get(part);
			clicked(data);
		});
		pipette.filter.add((part) => BlockManager.isBlockPart(part));

		return pipette;
	}
}
