import { MarketplaceService, Players } from "@rbxts/services";
import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Donations } from "shared/Donations";
import { CustomRemotes } from "shared/Remotes";
import { ReplicatedAssets } from "shared/ReplicatedAssets";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";

// module-level because the settings page is constructed anew every time it is opened
let clicks = 0;

export class PlayerSettingsDonations extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		const amount = new ObservableValue<Donations.Amount>("0");
		const fanfare = [
			ReplicatedAssets.waitForAsset<Sound>("Effects", "Donations", "Yippee"),
			ReplicatedAssets.waitForAsset<Sound>("Effects", "Donations", "Victory"),
		];

		const celebrate = () => {
			for (const sound of fanfare) {
				sound.TimePosition = 0;
				sound.Play();
			}
		};

		this.event.subscribe(CustomRemotes.donated.invoked, celebrate);

		this.addCategory("Donations");
		this.addDropdown<Donations.Amount>(
			"Amount",
			Donations.rungs.map(
				(robux) =>
					[
						`${robux}` as Donations.Amount,
						{ name: robux === 0 ? "I just want to click the button" : `${robux} R$` },
					] as const,
			),
		).initToObservable(amount);

		const donate = this.addButton("Donate", () => {
			clicks++;
			if (clicks === Donations.freeClicks) {
				CustomRemotes.achievements.donateClicks.send();
			}

			const product = Donations.products[amount.get()];
			if (product === 0) {
				celebrate();
				return;
			}

			MarketplaceService.PromptProductPurchase(Players.LocalPlayer, product);
		});

		this.event.subscribeObservable(
			amount,
			(v) => donate.button.setButtonText(v === "0" ? "Click Me!" : `${v} R$`),
			true,
		);
	}
}
