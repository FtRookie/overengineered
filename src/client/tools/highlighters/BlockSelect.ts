import { GuiService, Players, Workspace } from "@rbxts/services";
import { Interface } from "engine/client/gui/Interface";
import { InputController } from "engine/client/InputController";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { PlayerUtils } from "engine/shared/utils/PlayerUtils";
import { BlockManager } from "shared/building/BlockManager";
import type { ObservableCollectionSet } from "engine/shared/event/ObservableCollection";

export namespace BlockSelect {
	export const blockRaycastParams = new RaycastParams();
	blockRaycastParams.FilterType = Enum.RaycastFilterType.Include;
	blockRaycastParams.CollisionGroup = "BlockRaycast";

	export function getTargetedPart(): BasePart | undefined {
		if (GuiService.MenuIsOpen || !PlayerUtils.isAlive(Players.LocalPlayer) || Interface.isCursorOnVisibleGui()) {
			return;
		}

		const mouseRay = LocalPlayer.mouse.UnitRay;
		return Workspace.Raycast(mouseRay.Origin, mouseRay.Direction.mul(1000), blockRaycastParams)?.Instance;
	}
	export function getTargetedBlock(): BlockModel | undefined {
		return BlockManager.tryGetBlockModelByPart(getTargetedPart());
	}

	export function selectBlocksByClick(
		selected: ObservableCollectionSet<BlockModel>,
		blocks: readonly BlockModel[],
		add: boolean,
	): void {
		const pc = InputController.inputType.get() === "Desktop";

		if (pc && !add) {
			selected.clear();
		}

		if (blocks.size() === 0) {
			return;
		}

		const allBlocksAlreadySelected = blocks.all((b) => selected.has(b));
		if (!allBlocksAlreadySelected) {
			selected.add(...blocks);
		} else {
			for (const block of blocks) {
				const existing = selected.has(block);
				if (existing) {
					selected.remove(block);

					continue;
				}

				selected.add(block);
			}
		}
	}
}
