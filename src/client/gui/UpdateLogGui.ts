import { updateLogs } from "client/UpdateLogs";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { PartialControl } from "engine/client/gui/PartialControl";
import { Strings } from "engine/shared/fixes/String.propmacro";

type ListDefinition = GuiObject & {
	readonly LogTemplate: GuiObject & {
		readonly Content: GuiObject & {
			readonly Top: GuiObject & {
				readonly Date: GuiObject & {
					readonly PrettyDateText: TextLabel;
					readonly DateText: TextLabel;
				};
			};
			readonly Details: TextLabel;
		};
	};
};

const template = Interface.getInterface<{
	Popups: { Crossplatform: { UpdateLogs: GuiObject } };
}>().Popups.Crossplatform.UpdateLogs;
template.Visible = false;

type UpdateLogsPopupParts = {
	readonly CloseButton: TextButton;
	readonly LogList: ListDefinition;
	readonly TitleLabel: TextLabel;
};

export class UpdateLogsPopup extends PartialControl<UpdateLogsPopupParts> {
	constructor() {
		super(template.Clone());

		this.onEnable(() => {
			this.parent(new ButtonControl(this.parts.CloseButton, () => this.destroy()));

			const logTemplate = this.asTemplate(this.parts.LogList.LogTemplate);
			const templates = this.parent(new Control(this.parts.LogList));

			for (const log of updateLogs) {
				const gui = logTemplate();
				templates.add(new Control(gui));

				gui.Content.Top.Date.DateText.Text = `${log.Header}\t${log.Date.split("T")[0]}`;
				gui.Content.Top.Date.PrettyDateText.Text = Strings.prettySecondsAgo(
					DateTime.now().UnixTimestamp - DateTime.fromIsoDate(log.Date)!.UnixTimestamp,
				);

				let addedSize = -gui.Content.Details.AbsoluteSize.Y; // sub 1
				const newLine = this.asTemplate(gui.Content.Details);
				const content = this.parent(new Control(gui.Content));
				for (const line of log.Content) {
					const nextLine = newLine();
					content.add(new Control(nextLine));
					nextLine.Text = line;
					addedSize += nextLine.AbsoluteSize.Y;
				}
				const curr = gui.Size;
				gui.Size = new UDim2(curr.X.Scale, curr.X.Offset, curr.Y.Scale, curr.Y.Offset + addedSize);
			}
		});
	}
}
