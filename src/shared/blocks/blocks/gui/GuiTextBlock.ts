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
		"visible",
		"text",
		"fontSize",
		"position",
		"anchor",
		"rotation",
		"textColor",
		"textTransparency",
		"backgroundColor",
		"backgroundTransparency",
		"format",
		"zIndex",
	],
	input: {
		visible: {
			displayName: "Visible",
			types: {
				bool: { config: true },
			},
		},
		text: {
			displayName: "Text",
			types: BlockConfigDefinitions.any,
		},
		fontSize: {
			displayName: "Font Size",
			unit: "pt",
			types: {
				number: { config: 14 },
			},
		},
		position: {
			displayName: "Position",
			unit: "Relative Vector3 (0-1)",
			types: {
				vector3: { config: new Vector3(0.5, 0.5) },
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
				number: { config: 1 },
			},
		},
		format: {
			displayName: "Format",
			types: {
				string: { config: "{}" },
			},
		},
		zIndex: {
			displayName: "Z Index",
			types: {
				number: { config: 0 },
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

const replace = (text: string, str: string, newstr: string) => {
	const idx = text.find(str)[0];
	if (idx) {
		return `${text.sub(1, idx - 1)}${newstr}${text.sub(idx + str.size())}`;
	}

	return text;
};

export type { Logic as GuiTextBlockLogic };
@injectable
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs, @inject screen: MainScreenLayout) {
		super(definition, block);
		if (!RunService.IsClient()) return;

		const label = Element.create("TextLabel", {
			Name: `BlockText${block.instance?.Name}`,
			Font: Enum.Font.Ubuntu,
			TextColor3: Colors.white,
			AutomaticSize: Enum.AutomaticSize.XY,
			BackgroundTransparency: 1,
			Text: "",
			BorderSizePixel: 0,
			Parent: screen.fullScreenScaled8,
		});
		this.onDisable(() => label.Destroy());

		const format = this.initializeInputCache("format");
		this.onk(["visible"], ({ visible }) => (label.Visible = visible));
		this.onk(["text"], ({ text }) => (label.Text = replace(format.tryGet() ?? "{}", "{}", dataToString(text))));
		this.onk(["fontSize"], ({ fontSize }) => (label.TextSize = fontSize));
		this.onk(["position"], ({ position }) => (label.Position = new UDim2(position.X, 0, position.Y, 0)));
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

			const label = Element.create("TextLabel", {
				Name: `BlockTextPreview`,
				Font: Enum.Font.Ubuntu,
				AutomaticSize: Enum.AutomaticSize.XY,
				BorderSizePixel: 0,
				Parent: screen.fullScreenScaled8,
			});
			this.onDestroy(() => label.Destroy());

			this.event.loop(0.1, () => {
				const config = (BlockManager.manager.config.get(block) ?? {}) as DefinitionToConfig<typeof definition>;

				label.Text = replace(
					BlockCreation.defaultIfWiredUnset(config.format, definition.input.format.types.string.config),
					"{}",
					dataToString(
						BlockCreation.defaultIfWiredUnset(config.text, definition.input.text.types.string.config),
					),
				);
				label.TextSize = BlockCreation.defaultIfWiredUnset(
					config.fontSize,
					definition.input.fontSize.types.number.config,
				);
				label.Position = map(
					BlockCreation.defaultIfWiredUnset(config.position, definition.input.position.types.vector3.config),
					(position) => new UDim2(position.X, 0, position.Y, 0),
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

export const GuiTextBlock = {
	...BlockCreation.defaults,
	id: "guitext",
	displayName: "GUI Text",
	description: "Writes text on your screen",

	logic: { definition, ctor: Logic, preview: PreviewComponent },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("x4GuiLogicBlockPrefab", "TEXT"),
		category: () => BlockCreation.Categories.gui,
	},
} as const satisfies BlockBuilder;
