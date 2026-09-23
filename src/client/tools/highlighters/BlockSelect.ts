import { castCursor, isCursorUsable } from "client/CursorService";
import { InputController } from "engine/client/InputController";
import type { ObservableCollectionSet } from "engine/shared/event/ObservableCollection";

export namespace BlockSelect {
	export function getTargetedPart(): BasePart | undefined {
		if (!isCursorUsable()) return;
		return castCursor("plot")?.part;
	}
	export function getTargetedBlock(): BlockModel | undefined {
		if (!isCursorUsable()) return;
		return castCursor("plot")?.block;
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
