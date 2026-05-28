import { RunService } from "@rbxts/services";
import { Colors } from "engine/shared/Colors";
import { Component } from "engine/shared/component/Component";
import { Element } from "engine/shared/Element";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { dataToString } from "shared/blocks/blocks/ScreenBlock";
import { BlockManager } from "shared/building/BlockManager";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { BlockConfigPart } from "shared/blockLogic/BlockConfig";
import type {
	BlockLogicArgs,
	BlockLogicBothDefinitions,
	BlockLogicFullBothDefinitions,
} from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: [
		"text",
		"position",
		"size",
		"anchor",
		"rotation",
		"textColor",
		"textTransparency",
		"backgroundColor",
		"backgroundTransparency",
		"zIndex",
	],
	input: {
		text: {
			displayName: "Text",
			types: BlockConfigDefinitions.any,
		},
		position: {
			displayName: "Position",
			unit: "Relative Vector3 (0-1)",
			types: {
				vector3: { config: new Vector3(0.5, 0.5) },
			},
		},
		size: {
			displayName: "Size",
			unit: "Relative Vector3 (0-1)",
			types: {
				vector3: { config: new Vector3(0.1, 0.2) },
			},
		},
		anchor: {
			displayName: "Anchor",
			unit: "Relative Vector3 (0-1)",
			types: {
				vector3: { config: new Vector3(0.5, 0.5) },
			},
		},
		rotation: {
			displayName: "Rotation",
			unit: "degrees",
			types: {
				number: { config: 0 },
			},
		},
		textColor: {
			displayName: "Text Color",
			types: {
				color: { config: Colors.white },
			},
		},
		textTransparency: {
			displayName: "Text Transparency",
			types: {
				number: { config: 0 },
			},
		},
		backgroundColor: {
			displayName: "Background Color",
			types: {
				color: { config: Colors.black },
			},
		},
		backgroundTransparency: {
			displayName: "Background Transparency",
			types: {
				number: { config: 0 },
			},
		},
		zIndex: {
			displayName: "Z Index",
			types: {
				number: { config: 0 },
			},
		},
	},
	output: {
		pressed: {
			displayName: "Pressed",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

const replace = (text: string, str: string, newstr: string) => {
	const idx = text.find(str)[0];
	if (idx) {
		return `${text.sub(1, idx - 1)}${newstr}${text.sub(idx + str.size())}`;
	}

	return text;
};

export type { Logic as GuiButtonBlockLogic };
@injectable
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs, @inject screen: MainScreenLayout) {
		super(definition, block);
		if (!RunService.IsClient()) return;

		const label = Element.create("TextButton", {
			Name: `BlockText${block.instance?.Name}`,
			Font: Enum.Font.Ubuntu,
			TextColor3: Colors.white,
			TextScaled: true,
			BackgroundTransparency: 0,
			Text: "",
			BorderSizePixel: 0,
			Parent: screen.fullScreenScaled8,
		});
		this.onDisable(() => label.Destroy());

		this.onk(["text"], ({ text }) => (label.Text = dataToString(text)));
		this.onk(["position"], ({ position }) => (label.Position = new UDim2(position.X, 0, position.Y, 0)));
		this.onk(["size"], ({ size }) => (label.Size = new UDim2(size.X, 0, size.Y, 0)));
		this.onk(["rotation"], ({ rotation }) => (label.Rotation = rotation));
		this.onk(["anchor"], ({ anchor }) => (label.AnchorPoint = new Vector2(anchor.X, anchor.Y)));
		this.onk(["textColor"], ({ textColor }) => (label.TextColor3 = textColor));
		this.onk(["textTransparency"], ({ textTransparency }) => (label.TextTransparency = textTransparency));
		this.onk(["backgroundColor"], ({ backgroundColor }) => (label.BackgroundColor3 = backgroundColor));
		this.onk(
			["backgroundTransparency"],
			({ backgroundTransparency }) => (label.BackgroundTransparency = backgroundTransparency),
		);
		this.onk(["zIndex"], ({ zIndex }) => (label.ZIndex = zIndex));

		label.MouseButton1Down.Connect(() => this.output.pressed.set("bool", true));
		label.MouseButton1Up.Connect(() => this.output.pressed.set("bool", false));
		label.MouseLeave.Connect(() => this.output.pressed.set("bool", false));

		this.output.pressed.set("bool", false);
	}
}

class PreviewComponent extends Component {
	constructor(block: BlockModel) {
		super();

		this.$onInjectAuto((screen: MainScreenLayout) => {
			type DefinitionToConfig<TDef extends BlockLogicBothDefinitions> = {
				[k in keyof TDef["input"]]?: BlockConfigPart<
					(keyof BlockLogicTypes.Primitives & keyof TDef["input"][k]["types"]) | "unset" | "wire"
				>;
			};

			const map = <T, V>(value: T, func: (value: T) => V) => func(value);

			const label = Element.create("TextButton", {
				Name: `BlockTextPreview`,
				Font: Enum.Font.Ubuntu,
				TextScaled: true,
				BorderSizePixel: 0,
				Parent: screen.fullScreenScaled8,
			});
			this.onDestroy(() => label.Destroy());

			this.event.loop(0.1, () => {
				const config = (BlockManager.manager.config.get(block) ?? {}) as DefinitionToConfig<typeof definition>;

				label.Text = label.Text = dataToString(
					BlockCreation.defaultIfWiredUnset(config.text, definition.input.text.types.string.config),
				);
				label.Position = map(
					BlockCreation.defaultIfWiredUnset(config.position, definition.input.position.types.vector3.config),
					(position) => new UDim2(position.X, 0, position.Y, 0),
				);
				label.Size = map(
					BlockCreation.defaultIfWiredUnset(config.size, definition.input.size.types.vector3.config),
					(size) => new UDim2(size.X, 0, size.Y, 0),
				);
				label.Rotation = BlockCreation.defaultIfWiredUnset(
					config.rotation,
					definition.input.rotation.types.number.config,
				);
				label.AnchorPoint = map(
					BlockCreation.defaultIfWiredUnset(config.anchor, definition.input.anchor.types.vector3.config),
					(anchor) => new Vector2(anchor.X, anchor.Y),
				);
				label.TextColor3 = BlockCreation.defaultIfWiredUnset(
					config.textColor,
					definition.input.textColor.types.color.config,
				);
				label.TextTransparency = BlockCreation.defaultIfWiredUnset(
					config.textTransparency,
					definition.input.textTransparency.types.number.config,
				);
				label.BackgroundColor3 = BlockCreation.defaultIfWiredUnset(
					config.backgroundColor,
					definition.input.backgroundColor.types.color.config,
				);
				label.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
					config.backgroundTransparency,
					definition.input.backgroundTransparency.types.number.config,
				);
				label.ZIndex = BlockCreation.defaultIfWiredUnset(
					config.zIndex,
					definition.input.zIndex.types.number.config,
				);
			});
		});
	}
}

export const GuiButtonBlock = {
	...BlockCreation.defaults,
	id: "guibutton",
	displayName: "GUI Button",
	description: "Places a button on your screen",

	logic: { definition, ctor: Logic, preview: PreviewComponent },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("x4GuiLogicBlockPrefab", "BUTTON"),
		category: () => BlockCreation.Categories.gui,
	},
} as const satisfies BlockBuilder;
