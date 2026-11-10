import { HelpBuilding } from "client/gui/help/HelpBuilding";
import { HelpEditing } from "client/gui/help/HelpEditing";
import { HelpGettingStarted } from "client/gui/help/HelpGettingStarted";
import { HelpRiding } from "client/gui/help/HelpRiding";
import { HelpSaving } from "client/gui/help/HelpSaving";
import { HelpPages } from "client/gui/HelpPopup";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import type { HelpController } from "client/controller/HelpController";
import type { HelpPopupDefinition } from "client/gui/HelpPopup";

const template = Interface.getInterface<{
	Popups: { Crossplatform: { Help: HelpPopupDefinition } };
}>().Popups.Crossplatform.Help;
template.Visible = false;

/** The basics read straight through with no index, for a player who has not built anything yet */
export class HelpQuickStartPopup extends Control<HelpPopupDefinition> {
	constructor() {
		const gui = template.Clone();
		super(gui);

		gui.Heading.TitleLabel.Text = "QUICK START";
		gui.Content.Sidebar.Visible = false;
		gui.Content.Page.Size = UDim2.fromScale(1, 1);

		this.$onInjectAuto((help: HelpController) => {
			const pages = this.parent(new HelpPages(gui.Content.Page, gui.Footer));

			pages.addSection(HelpGettingStarted);
			pages.addSection(HelpBuilding);
			pages.addSection(HelpEditing);
			pages.addSection(HelpRiding);
			pages.addSection(HelpSaving);

			pages.setFinish("ALL HELP →", () => {
				this.destroy();
				help.show();
			});

			this.parent(new ButtonControl(gui.Heading.CloseButton, () => this.destroy()));
			pages.open(0, 0);
		});
	}
}
