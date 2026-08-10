import { ConfigControlEdit } from "client/gui/configControls/ConfigControlEdit";
import { ExpressionEditorPopup } from "client/gui/popup/ExpressionEditorPopup";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { ConfigControlEditDefinition } from "client/gui/configControls/ConfigControlEdit";
import type { PopupController } from "client/gui/PopupController";

@injectable
export class ConfigControlExpression extends ConfigControlEdit<string> {
	@inject private readonly popupController: PopupController = undefined!;

	constructor(gui: ConfigControlEditDefinition, name: string) {
		super(gui, name, () => {
			const popup = new ExpressionEditorPopup(v.get(), (value) => this.submit(this.multiMap(() => value)));
			this.popupController.showPopup(popup);
		});

		const v = new ObservableValue<string>("");
		this.initFromMultiWithDefault(v, () => "");

		// the row keeps its preview box, unlike code: an expression is one line and reads fine at a glance.
		// Display only — typing into it would look like editing while submitting nothing.
		gui.Buttons.Preview.TextEditable = false;
		this.event.subscribeObservable(v, (value) => (gui.Buttons.Preview.Text = value), true);
	}
}
