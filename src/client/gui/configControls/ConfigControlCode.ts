import { ConfigControlEdit } from "client/gui/configControls/ConfigControlEdit";
import { IDEPopup } from "client/gui/popup/IDEPopup";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { ConfigControlEditDefinition } from "client/gui/configControls/ConfigControlEdit";
import type { PopupController } from "client/gui/PopupController";

@injectable
export class ConfigControlCode extends ConfigControlEdit<string> {
	@inject private readonly popupController: PopupController = undefined!;

	constructor(gui: ConfigControlEditDefinition, name: string, lengthLimit: number) {
		super(gui, name, () => {
			const c = new IDEPopup(lengthLimit, v.get(), (v) => this.submit(this.multiMap(() => v)));
			this.popupController.showPopup(c);
		});

		gui.Buttons.Preview.Visible = false;

		const v = new ObservableValue<string>("");

		this.initFromMultiWithDefault(v, () => "");
	}
}
