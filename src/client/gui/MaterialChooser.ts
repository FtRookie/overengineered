import { MarketplaceService, Players } from "@rbxts/services";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Colors } from "engine/shared/Colors";
import { Materials } from "engine/shared/data/Materials";
import { SubmittableValue } from "engine/shared/event/SubmittableValue";
import { Marketplace } from "engine/shared/Marketplace";
import { BuildingManager } from "shared/building/BuildingManager";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

class MaterialButton extends ButtonControl {
	constructor(gui: GuiButton, set: () => void, gamePass?: number) {
		super(gui);

		let bought = gamePass === undefined;
		this.event.subscribe(this.activated, () => {
			if (!bought) return;
			set();
		});

		if (gamePass !== undefined) {
			const lockFrame = gui.FindFirstChild("Lock") as Frame;
			const priceLabel = lockFrame.FindFirstChild("TextLabel") as TextLabel;

			if (Marketplace.Gamepass.has(Players.LocalPlayer, gamePass)) {
				bought = true;
				lockFrame.Visible = false;
			} else {
				priceLabel.Text = Marketplace.Gamepass.getPrice(gamePass);
				lockFrame.Visible = true;

				MarketplaceService.PromptGamePassPurchaseFinished.Connect((player, gamePassId, wasPurchased) => {
					if (!wasPurchased) return;
					if (gamePassId !== gamePass) return;

					bought = true;
					lockFrame.Visible = false;
					set();
				});

				this.event.subscribe(this.activated, () => {
					if (bought) return;
					MarketplaceService.PromptGamePassPurchase(Players.LocalPlayer, gamePass);
				});
			}
		}
	}
}

export type MaterialChooserDefinition = GuiObject & {
	readonly Left: GuiObject & {
		readonly Preview: ImageLabel;
	};
	readonly Right: GuiObject & {
		readonly ScrollingFrame: ScrollingFrame & {
			readonly MaterialTemplate: ImageButton & {
				readonly TextLabel: TextLabel;
			};
		};
	};
};
/** Material chooser part */
export class MaterialChooser extends Control<MaterialChooserDefinition> {
	static setColorOfPreview(color: Color4, child: ImageLabel | ImageButton) {
		child.BackgroundColor3 = color.color;
		child.ImageColor3 = color.color;
	}

	readonly value;

	constructor(
		gui: MaterialChooserDefinition,
		value?: SubmittableValue<Enum.Material>,
		color?: ReadonlyObservableValue<Color4>,
		search?: ReadonlyObservableValue<string>,
	) {
		super(gui);

		value ??= SubmittableValue.from<Enum.Material>(Enum.Material.Plastic);
		this.value = value.asHalfReadonly();

		this.event.subscribeObservable(
			value.value,
			(material) => {
				gui.Left.Preview.Image = Materials.getMaterialTextureAssetId(material);
				if (color) {
					MaterialChooser.setColorOfPreview(color.get(), gui.Left.Preview);
				}
			},
			true,
		);

		if (color) {
			this.event.subscribeObservable(
				color,
				(c) => {
					MaterialChooser.setColorOfPreview(c, gui.Left.Preview);

					for (const child of gui.Right.ScrollingFrame.GetChildren()) {
						if (!child.IsA("ImageButton")) continue;
						MaterialChooser.setColorOfPreview(c, child);
					}
				},
				true,
			);
		}

		const items: (ImageButton & { readonly TextLabel: TextLabel })[] = [];
		const template = this.asTemplate(gui.Right.ScrollingFrame.MaterialTemplate, true);
		for (const [i, material] of ipairs(
			BuildingManager.AllowedMaterials.clone().sort((r, l) => r.Value < l.Value),
		)) {
			const instance = template();
			instance.LayoutOrder = i;
			instance.Parent = gui.Right.ScrollingFrame;

			instance.TextLabel.Text = Materials.getMaterialDisplayName(material).upper();
			instance.BackgroundColor3 = Colors.white;
			instance.Image = Materials.getMaterialTextureAssetId(material);
			items.push(instance);

			// gamepasses disabled as this is uploaded as another game
			// const gamepassid = instance.Name === "Neon" ? GameDefinitions.GAMEPASSES.NeonMaterial : undefined;
			const gamepassid = undefined;
			this.parent(new MaterialButton(instance, () => value.submit(material), gamepassid));
		}

		search!.subscribe((str) => {
			for (const item of items) {
				item.Visible =
					str === undefined ||
					str.size() === 0 ||
					item.TextLabel.Text.lower().find(str.lower())[0] !== undefined;
			}
		});
	}
}
