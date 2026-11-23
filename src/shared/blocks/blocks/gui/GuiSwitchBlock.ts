import { RunService } from "@rbxts/services";
import { Colors } from "engine/shared/Colors";
import { Element } from "engine/shared/Element";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: [
		"visible",
		"startState",
		"rounded",
		"position",
		"size",
		"anchor",
		"rotation",
		"thumbColor",
		"thumbTransparency",
		"trackColor",
		"trackTransparency",
		"zIndex",
	],
	input: {
		visible: {
			displayName: "Visible",
			types: {
				bool: { config: true },
			},
		},
		startState: {
			displayName: "Start State",
			tooltip: "Whether the switch is on when the ride starts.",
			types: {
				bool: { config: false },
			},
			connectorHidden: true,
		},
		rounded: {
			displayName: "Rounded",
			types: BlockConfigDefinitions.bool,
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
				vector3: { config: new Vector3(0.08, 0.06) },
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
		thumbColor: {
			displayName: "Thumb Color",
			types: {
				color: { config: Colors.white },
			},
		},
		thumbTransparency: {
			displayName: "Thumb Transparency",
			types: {
				number: { config: 0 },
			},
		},
		trackColor: {
			displayName: "Track Color",
			types: {
				color: { config: Colors.black },
			},
		},
		trackTransparency: {
			displayName: "Track Transparency",
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
		state: {
			displayName: "State",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type SwitchGui = TextButton & { Thumb: Frame & { UICorner: UICorner }; UICorner: UICorner };

const createSwitch = (name: string, Parent: Instance): SwitchGui => {
	const track = Element.create("TextButton", {
		Name: name,
		Text: "",
		AutoButtonColor: false,
		BorderSizePixel: 0,
		Parent,
	});
	const thumb = Element.create("Frame", {
		Name: "Thumb",
		SizeConstraint: Enum.SizeConstraint.RelativeYY,
		Size: new UDim2(1, 0, 1, 0),
		BorderSizePixel: 0,
		Parent: track,
	});
	Element.create("UICorner", { Parent: track });
	Element.create("UICorner", { Parent: thumb });

	return track as SwitchGui;
};
const setSwitchState = (gui: SwitchGui, on: boolean) => {
	gui.Thumb.AnchorPoint = new Vector2(on ? 1 : 0, 0.5);
	gui.Thumb.Position = new UDim2(on ? 1 : 0, 0, 0.5, 0);
};
const setSwitchRounded = (gui: SwitchGui, rounded: boolean) => {
	const radius = new UDim(rounded ? 0.5 : 0, 0);
	gui.UICorner.CornerRadius = radius;
	gui.Thumb.UICorner.CornerRadius = radius;
};
const setSwitchZIndex = (gui: SwitchGui, zIndex: number) => {
	gui.ZIndex = zIndex;
	gui.Thumb.ZIndex = zIndex + 1;
};

export type { Logic as GuiSwitchBlockLogic };
@injectable
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs, @inject screen: MainScreenLayout) {
		super(definition, block);
		if (!RunService.IsClient()) return;

		const track = createSwitch(`BlockSwitch${block.instance?.Name}`, screen.fullScreenScaled8);
		this.onDisable(() => track.Destroy());

		let state = false;
		const apply = (on: boolean) => {
			state = on;
			setSwitchState(track, on);
			this.output.state.set("bool", on);
		};

		this.onkFirstInputs(["startState"], ({ startState }) => apply(startState));
		this.onk(["visible"], ({ visible }) => (track.Visible = visible));
		this.onk(["rounded"], ({ rounded }) => setSwitchRounded(track, rounded));
		this.onk(["position"], ({ position }) => (track.Position = new UDim2(position.X, 0, position.Y, 0)));
		this.onk(["size"], ({ size }) => (track.Size = new UDim2(size.X, 0, size.Y, 0)));
		this.onk(["rotation"], ({ rotation }) => (track.Rotation = rotation));
		this.onk(["anchor"], ({ anchor }) => (track.AnchorPoint = new Vector2(anchor.X, anchor.Y)));
		this.onk(["thumbColor"], ({ thumbColor }) => (track.Thumb.BackgroundColor3 = thumbColor));
		this.onk(
			["thumbTransparency"],
			({ thumbTransparency }) => (track.Thumb.BackgroundTransparency = thumbTransparency),
		);
		this.onk(["trackColor"], ({ trackColor }) => (track.BackgroundColor3 = trackColor));
		this.onk(["trackTransparency"], ({ trackTransparency }) => (track.BackgroundTransparency = trackTransparency));
		this.onk(["zIndex"], ({ zIndex }) => setSwitchZIndex(track, zIndex));

		track.Activated.Connect(() => apply(!state));
	}
}

const preview = BlockCreation.preview(
	definition,
	(parent) => createSwitch("BlockSwitchPreview", parent),
	(gui, config) => {
		const map = <T, V>(value: T, func: (value: T) => V) => func(value);

		setSwitchState(
			gui,
			BlockCreation.defaultIfWiredUnset(config.startState, definition.input.startState.types.bool.config),
		);
		setSwitchRounded(
			gui,
			BlockCreation.defaultIfWiredUnset(config.rounded, definition.input.rounded.types.bool.config),
		);
		gui.Position = map(
			BlockCreation.defaultIfWiredUnset(config.position, definition.input.position.types.vector3.config),
			(position) => new UDim2(position.X, 0, position.Y, 0),
		);
		gui.Size = map(
			BlockCreation.defaultIfWiredUnset(config.size, definition.input.size.types.vector3.config),
			(size) => new UDim2(size.X, 0, size.Y, 0),
		);
		gui.Rotation = BlockCreation.defaultIfWiredUnset(
			config.rotation,
			definition.input.rotation.types.number.config,
		);
		gui.AnchorPoint = map(
			BlockCreation.defaultIfWiredUnset(config.anchor, definition.input.anchor.types.vector3.config),
			(anchor) => new Vector2(anchor.X, anchor.Y),
		);
		gui.Thumb.BackgroundColor3 = BlockCreation.defaultIfWiredUnset(
			config.thumbColor,
			definition.input.thumbColor.types.color.config,
		);
		gui.Thumb.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.thumbTransparency,
			definition.input.thumbTransparency.types.number.config,
		);
		gui.BackgroundColor3 = BlockCreation.defaultIfWiredUnset(
			config.trackColor,
			definition.input.trackColor.types.color.config,
		);
		gui.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.trackTransparency,
			definition.input.trackTransparency.types.number.config,
		);
		setSwitchZIndex(
			gui,
			BlockCreation.defaultIfWiredUnset(config.zIndex, definition.input.zIndex.types.number.config),
		);
	},
);

export const GuiSwitchBlock = {
	...BlockCreation.defaults,
	id: "guiswitch",
	displayName: "GUI Switch",
	description: "Places a switch on your screen",

	logic: { definition, ctor: Logic, preview },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("x4GuiLogicBlockPrefab", "SWITCH"),
		category: () => BlockCreation.Categories.gui,
	},
} as const satisfies BlockBuilder;
