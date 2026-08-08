import { ConfigControlEdit } from "client/gui/configControls/ConfigControlEdit";
import { MemoryEditorPopup } from "client/gui/popup/MemoryEditorPopup";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { ConfigControlEditDefinition } from "client/gui/configControls/ConfigControlEdit";
import type { PopupController } from "client/gui/PopupController";

/** Preview cells before the row is elided. */
const PREVIEW_LENGTH = 8;

@injectable
export class ConfigControlByteArray extends ConfigControlEdit<readonly number[]> {
	@inject private readonly popupController: PopupController = undefined!;

	constructor(gui: ConfigControlEditDefinition, name: string, lengthLimit: number, valueLimit: number) {
		super(gui, name, () => {
			const c = new MemoryEditorPopup(
				lengthLimit,
				[...v.get()],
				(v) => this.submit(this.multiMap(() => v)),
				digits,
			);
			this.popupController.showPopup(c);
		});

		// two hex digits per byte, so the cell width follows the largest value the definition allows
		const digits = string.format("%X", valueLimit).size();
		const format = `%0${digits}X`;

		const v = new ObservableValue<readonly number[]>([]);
		v.subscribe((v) => {
			gui.Buttons.Preview.Text = v
				.filter((_, i) => i < PREVIEW_LENGTH)
				.map((b) => string.format(format, b))
				.join(" ");
		});

		this.initFromMultiWithDefault(v, () => []);
	}
}
