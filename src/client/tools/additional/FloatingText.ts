import { Workspace } from "@rbxts/services";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { Element } from "engine/shared/Element";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Colors } from "shared/Colors";

type FloatingTextDefinition = BillboardGui & {
	readonly text: TextLabel;
	readonly subtext?: TextLabel;
};
export class FloatingText extends InstanceComponent<FloatingTextDefinition> {
	static create(adornee: PVInstance | Attachment, includeSub: boolean = false): FloatingText {
		const textConfig = {
			Size: new UDim2(1, 0, 1, 0),
			AutoLocalize: false,
			BackgroundTransparency: 1,
			FontFace: Element.newFont(Enum.Font.Ubuntu, Enum.FontWeight.Bold),
			TextColor3: Colors.black,
			TextStrokeColor3: Colors.white,
			TextStrokeTransparency: 0,
		};
		const children: Partial<Record<string, Instance>> = {
			text: Element.create("TextLabel", {
				...textConfig,
				TextSize: 20,
			}),
			subtext: undefined,
		};

		if (includeSub) {
			children.subtext = Element.create("TextLabel", {
				...textConfig,
				Position: new UDim2(0, 0, 0.3, 0),
				TextSize: 10,
				TextStrokeColor3: Colors.accentLight,
			});
		}

		const instance = Element.create(
			"BillboardGui",
			{
				Name: `FloatingText_${adornee.Name}`,
				Size: new UDim2(0, 200, 0, 50),
				AlwaysOnTop: true,
				Adornee: adornee,
				Parent: Workspace,
			},
			children as Record<string, Instance>,
		) as unknown as FloatingTextDefinition;

		return new FloatingText(instance, includeSub);
	}

	readonly text = new ObservableValue<string>("");
	readonly subtext?: ObservableValue<string>;

	constructor(instance: FloatingTextDefinition, includeSub: boolean = false) {
		super(instance);
		this.text.subscribe((text) => (instance.text.Text = text), true);
		if (includeSub) {
			this.subtext = new ObservableValue<string>("");
			this.subtext.subscribe((text) => (instance.subtext!.Text = text), true);
		}
	}
}
