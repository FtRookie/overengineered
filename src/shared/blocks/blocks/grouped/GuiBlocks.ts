import { RunService, UserInputService } from "@rbxts/services";
import { Colors } from "engine/shared/Colors";
import { Element } from "engine/shared/Element";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { inferEnumLogicType } from "shared/blockLogic/BlockLogicTypes";
import { ConfigSequences } from "shared/blockLogic/ConfigSequences";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { dataToString } from "shared/blocks/blocks/ScreenBlock";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { BlockConfigPart } from "shared/blockLogic/BlockConfig";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockBuilder } from "shared/blocks/Block";

const definitionText = {
	inputOrder: [
		"visible",
		"rounding",
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
		rounding: {
			displayName: "Rounding",
			tooltip: "How round the corners are; 0.5 is fully round.",
			types: {
				number: { config: 0, clamp: { showAsSlider: true, min: 0, max: 0.5, step: 0.01 } },
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

const definitionImage = {
	inputOrder: [
		"visible",
		"rounding",
		"image",
		"position",
		"size",
		"anchor",
		"rotation",
		"backgroundColor",
		"backgroundTransparency",
		"zIndex",
	],
	input: {
		visible: {
			displayName: "Visible",
			types: {
				bool: { config: true },
			},
		},
		rounding: {
			displayName: "Rounding",
			tooltip: "How round the corners are; 0.5 is fully round.",
			types: {
				number: { config: 0, clamp: { showAsSlider: true, min: 0, max: 0.5, step: 0.01 } },
			},
		},
		image: {
			displayName: "Image ID",
			types: {
				string: { config: "17407819496" },
			},
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
		zIndex: {
			displayName: "Z Index",
			types: {
				number: { config: 0 },
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

const definitionButton = {
	inputOrder: [
		"visible",
		"rounding",
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
		visible: {
			displayName: "Visible",
			types: {
				bool: { config: true },
			},
		},
		rounding: {
			displayName: "Rounding",
			tooltip: "How round the corners are; 0.5 is fully round.",
			types: {
				number: { config: 0, clamp: { showAsSlider: true, min: 0, max: 0.5, step: 0.01 } },
			},
		},
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

const definitionSwitch = {
	inputOrder: [
		"visible",
		"startState",
		"rounding",
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
		rounding: {
			displayName: "Rounding",
			tooltip: "How round the corners are; 0.5 is fully round.",
			types: {
				number: { config: 0, clamp: { showAsSlider: true, min: 0, max: 0.5, step: 0.01 } },
			},
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
			tooltip: "Add a second color to tell the states apart: the one @ 0 is off, the one @ 1 is on.",
			types: {
				color: { config: Colors.white, sequence: "range" },
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
			tooltip: "Add a second color to tell the states apart: the one @ 0 is off, the one @ 1 is on.",
			types: {
				color: { config: Colors.black, sequence: "range" },
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

const definitionBar = {
	inputOrder: [
		"visible",
		"value",
		"min",
		"max",
		"direction",
		"rounding",
		"position",
		"size",
		"anchor",
		"rotation",
		"fillColor",
		"fillTransparency",
		"backgroundColor",
		"backgroundTransparency",
		"zIndex",
	],
	input: {
		visible: {
			displayName: "Visible",
			types: {
				bool: { config: true },
			},
		},
		value: {
			displayName: "Value",
			types: BlockConfigDefinitions.number,
		},
		min: {
			displayName: "Min",
			types: {
				number: { config: 0 },
			},
		},
		max: {
			displayName: "Max",
			types: {
				number: { config: 1 },
			},
		},
		direction: {
			displayName: "Direction",
			types: {
				enum: inferEnumLogicType({
					config: "right",
					elementOrder: ["right", "left", "up", "down"],
					elements: {
						right: { displayName: "Right", tooltip: "Fills from the left edge" },
						left: { displayName: "Left", tooltip: "Fills from the right edge" },
						up: { displayName: "Up", tooltip: "Fills from the bottom edge" },
						down: { displayName: "Down", tooltip: "Fills from the top edge" },
					},
				}),
			},
			connectorHidden: true,
		},
		rounding: {
			displayName: "Rounding",
			tooltip: "How round the corners are; 0.5 is fully round.",
			types: {
				number: { config: 0, clamp: { showAsSlider: true, min: 0, max: 0.5, step: 0.01 } },
			},
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
				vector3: { config: new Vector3(0.1, 0.02) },
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
		fillColor: {
			displayName: "Fill Color",
			types: {
				color: { config: Colors.white },
			},
		},
		fillTransparency: {
			displayName: "Fill Transparency",
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
	output: {},
} satisfies BlockLogicFullBothDefinitions;

const definitionSlider = {
	inputOrder: [
		"visible",
		"min",
		"max",
		"step",
		"startValue",
		"springBack",
		"vertical",
		"rounding",
		"position",
		"size",
		"anchor",
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
		min: {
			displayName: "Min",
			types: {
				number: { config: 0 },
			},
		},
		max: {
			displayName: "Max",
			types: {
				number: { config: 1 },
			},
		},
		step: {
			displayName: "Step",
			tooltip: "Snaps the value to multiples of this; 0 slides freely.",
			types: {
				number: { config: 0 },
			},
		},
		startValue: {
			displayName: "Start Value",
			tooltip: "The value when the ride starts, and the one it springs back to.",
			types: {
				number: { config: 0 },
			},
			connectorHidden: true,
		},
		springBack: {
			displayName: "Spring Back",
			tooltip: "Returns to the start value when released.",
			types: BlockConfigDefinitions.bool,
			connectorHidden: true,
		},
		vertical: {
			displayName: "Vertical",
			tooltip: "Slides up and down instead, with the minimum at the bottom.",
			types: BlockConfigDefinitions.bool,
			connectorHidden: true,
		},
		rounding: {
			displayName: "Rounding",
			tooltip: "How round the corners are; 0.5 is fully round.",
			types: {
				number: { config: 0, clamp: { showAsSlider: true, min: 0, max: 0.5, step: 0.01 } },
			},
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
				vector3: { config: new Vector3(0.15, 0.03) },
			},
		},
		anchor: {
			displayName: "Anchor",
			unit: "Relative Vector3 (0-1)",
			types: {
				vector3: { config: new Vector3(0.5, 0.5) },
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
		value: {
			displayName: "Value",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

const definitionJoystick = {
	inputOrder: [
		"visible",
		"position",
		"size",
		"anchor",
		"knobColor",
		"knobTransparency",
		"baseColor",
		"baseTransparency",
		"zIndex",
	],
	input: {
		visible: {
			displayName: "Visible",
			types: {
				bool: { config: true },
			},
		},
		position: {
			displayName: "Position",
			unit: "Relative Vector3 (0-1)",
			types: {
				vector3: { config: new Vector3(0.15, 0.75) },
			},
		},
		size: {
			displayName: "Size",
			unit: "relative to screen height",
			types: {
				number: { config: 0.24 },
			},
		},
		anchor: {
			displayName: "Anchor",
			unit: "Relative Vector3 (0-1)",
			types: {
				vector3: { config: new Vector3(0.5, 0.5) },
			},
		},
		knobColor: {
			displayName: "Knob Color",
			types: {
				color: { config: Colors.white },
			},
		},
		knobTransparency: {
			displayName: "Knob Transparency",
			types: {
				number: { config: 0 },
			},
		},
		baseColor: {
			displayName: "Base Color",
			types: {
				color: { config: Colors.black },
			},
		},
		baseTransparency: {
			displayName: "Base Transparency",
			types: {
				number: { config: 0.5 },
			},
		},
		zIndex: {
			displayName: "Z Index",
			types: {
				number: { config: 0 },
			},
		},
	},
	outputOrder: ["x", "y", "angle"],
	output: {
		x: {
			displayName: "X",
			types: ["number"],
		},
		y: {
			displayName: "Y",
			types: ["number"],
		},
		angle: {
			displayName: "Angle around Center",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

const definitionPanel = {
	inputOrder: ["visible", "rounding", "position", "size", "anchor", "rotation", "color", "transparency", "zIndex"],
	input: {
		visible: {
			displayName: "Visible",
			types: {
				bool: { config: true },
			},
		},
		rounding: {
			displayName: "Rounding",
			tooltip: "How round the corners are; 0.5 is fully round.",
			types: {
				number: { config: 0, clamp: { showAsSlider: true, min: 0, max: 0.5, step: 0.01 } },
			},
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
				vector3: { config: new Vector3(0.1, 0.1) },
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
		color: {
			displayName: "Color",
			types: {
				color: { config: Colors.black },
			},
		},
		transparency: {
			displayName: "Transparency",
			types: {
				number: { config: 0.5 },
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

const definitionLine = {
	inputOrder: ["visible", "startPoint", "endPoint", "thickness", "color", "transparency", "zIndex"],
	input: {
		visible: {
			displayName: "Visible",
			types: {
				bool: { config: true },
			},
		},
		startPoint: {
			displayName: "Start",
			unit: "Relative Vector3 (0-1)",
			types: {
				vector3: { config: new Vector3(0.4, 0.5) },
			},
		},
		endPoint: {
			displayName: "End",
			unit: "Relative Vector3 (0-1)",
			types: {
				vector3: { config: new Vector3(0.6, 0.5) },
			},
		},
		thickness: {
			displayName: "Thickness",
			unit: "relative to screen height",
			tooltip: "Add more values to taper it: the one @ 0 is at the start, the one @ 1 at the end.",
			types: {
				number: { config: 0.005, sequence: "curve" },
			},
		},
		color: {
			displayName: "Color",
			tooltip: "Add more colors to blend it from the start (@ 0) to the end (@ 1).",
			types: {
				color: { config: Colors.white, sequence: "curve" },
			},
		},
		transparency: {
			displayName: "Transparency",
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
	output: {},
} satisfies BlockLogicFullBothDefinitions;

//

/** Every UICorner in the block's GUI, so a thumb or fill rounds with its track */
const setRounding = (gui: GuiObject, rounding: number) => {
	for (const corner of gui.GetDescendants()) {
		if (corner.IsA("UICorner")) corner.CornerRadius = new UDim(rounding, 0);
	}
};
/** Parts inside the block's GUI (a thumb, a fill, a knob) draw one level above it */
const setZIndex = (gui: GuiObject, zIndex: number) => {
	gui.ZIndex = zIndex;
	for (const part of gui.GetDescendants()) {
		if (part.IsA("GuiObject")) part.ZIndex = zIndex + 1;
	}
};
const relative = (v: Vector3) => new UDim2(v.X, 0, v.Y, 0);

/**
 * The inputs most GUI blocks share, applied to the block's root: Visible, Position, Anchor and Z Index always, and
 * Size (a Vector3 one), Rotation and Rounding where the definition has them. Returns a setter per input it handled.
 */
const sharedSetters = (gui: GuiObject, definition: BlockLogicFullBothDefinitions) => {
	const all: { readonly [k in string]: (value: unknown) => void } = {
		visible: (v) => (gui.Visible = v as boolean),
		position: (v) => (gui.Position = relative(v as Vector3)),
		anchor: (v) => (gui.AnchorPoint = new Vector2((v as Vector3).X, (v as Vector3).Y)),
		zIndex: (v) => setZIndex(gui, v as number),
		rotation: (v) => (gui.Rotation = v as number),
		rounding: (v) => setRounding(gui, v as number),
		size: (v) => (gui.Size = relative(v as Vector3)),
	};

	const setters = new Map<string, (value: unknown) => void>();
	for (const [key, set] of pairs(all)) {
		const def = definition.input[key];
		if (!def) continue;
		// the Joystick's size is a single number it applies itself
		if (key === "size" && !def.types.vector3) continue;

		setters.set(key, set);
	}
	return setters;
};

/**
 * Draws a block's GUI on the screen and keeps its shared inputs applied. A subclass adds the inputs and outputs of
 * its own; `gui` is only created on the client, which is the only side that draws, so it reads `gui` past the same
 * `RunService.IsClient()` return.
 */
abstract class GuiLogic<T extends BlockLogicFullBothDefinitions, TGui extends GuiObject> extends BlockLogic<T> {
	protected readonly gui!: TGui;

	constructor(
		definition: T,
		block: BlockLogicArgs,
		screen: MainScreenLayout,
		create: (name: string, parent: Instance) => TGui,
	) {
		super(definition, block);
		if (!RunService.IsClient()) return;

		const gui = create(`BlockGui${block.instance?.Name}`, screen.fullScreenScaled8);
		this.gui = gui;
		this.onDisable(() => gui.Destroy());

		// the definition is generic here, so each value arrives untyped and its setter knows what it is
		for (const [key, set] of sharedSetters(gui, definition)) {
			this.onk([key as keyof T["input"]], (inputs) =>
				set((inputs as unknown as { [k in string]: unknown })[key]),
			);
		}
	}
}

/** The shared inputs of a preview, read with the same fallbacks the config panel shows */
const previewShared = <TDef extends BlockLogicFullBothDefinitions>(
	gui: GuiObject,
	config: BlockCreation.DefinitionToConfig<TDef>,
	definition: TDef,
) => {
	const parts = config as unknown as { readonly [k in string]?: BlockConfigPart<keyof BlockLogicTypes.Primitives> };
	for (const [key, set] of sharedSetters(gui, definition)) {
		const types = definition.input[key].types as { readonly [k in string]?: { readonly config: unknown } };
		set(BlockCreation.defaultIfWiredUnset(parts[key] as never, types[firstKey(types)!]!.config as never));
	}
};

/** Calls `moved` with the pointer from a press on `gui` until its release, then `released`; returns a disconnect */
const bindDrag = (gui: GuiObject, moved: (position: Vector2) => void, released: () => void) => {
	const isPress = (input: InputObject) =>
		input.UserInputType === Enum.UserInputType.MouseButton1 || input.UserInputType === Enum.UserInputType.Touch;

	// the move and release listeners exist only while a drag is in progress
	let drag: RBXScriptConnection[] | undefined;
	const stop = () => {
		if (!drag) return;

		for (const c of drag) c.Disconnect();
		drag = undefined;
		released();
	};

	const began = gui.InputBegan.Connect((press) => {
		if (drag || !isPress(press)) return;

		const isTouch = press.UserInputType === Enum.UserInputType.Touch;
		moved(new Vector2(press.Position.X, press.Position.Y));
		drag = [
			UserInputService.InputChanged.Connect((input) => {
				// a touch keeps its own InputObject for the whole gesture; a mouse reports movement separately
				const follows = isTouch ? input === press : input.UserInputType === Enum.UserInputType.MouseMovement;
				if (!follows) return;

				moved(new Vector2(input.Position.X, input.Position.Y));
			}),
			UserInputService.InputEnded.Connect((input) => {
				const ends = isTouch ? input === press : input.UserInputType === Enum.UserInputType.MouseButton1;
				if (ends) stop();
			}),
		];
	});

	return () => {
		began.Disconnect();
		stop();
	};
};

const fractionOf = (value: number, min: number, max: number) => (max === min ? 0 : (value - min) / (max - min));

//

const replace = (text: string, str: string, newstr: string) => {
	const idx = text.find(str)[0];
	if (idx) {
		return `${text.sub(1, idx - 1)}${newstr}${text.sub(idx + str.size())}`;
	}

	return text;
};

const createText = (Name: string, Parent: Instance) => {
	const label = Element.create("TextLabel", {
		Name,
		Font: Enum.Font.Ubuntu,
		TextColor3: Colors.white,
		AutomaticSize: Enum.AutomaticSize.XY,
		BackgroundTransparency: 1,
		Text: "",
		BorderSizePixel: 0,
		Parent,
	});
	Element.create("UICorner", { CornerRadius: new UDim(0, 0), Parent: label });
	return label;
};
@injectable
class GuiTextLogic extends GuiLogic<typeof definitionText, TextLabel> {
	constructor(block: BlockLogicArgs, @inject screen: MainScreenLayout) {
		super(definitionText, block, screen, createText);
		if (!RunService.IsClient()) return;

		const label = this.gui;
		const format = this.initializeInputCache("format");
		this.onk(["text"], ({ text }) => (label.Text = replace(format.tryGet() ?? "{}", "{}", dataToString(text))));
		this.onk(["fontSize"], ({ fontSize }) => (label.TextSize = fontSize));
		this.onk(["textColor"], ({ textColor }) => (label.TextColor3 = textColor));
		this.onk(["textTransparency"], ({ textTransparency }) => (label.TextTransparency = textTransparency));
		this.onk(["backgroundColor"], ({ backgroundColor }) => (label.BackgroundColor3 = backgroundColor));
		this.onk(
			["backgroundTransparency"],
			({ backgroundTransparency }) => (label.BackgroundTransparency = backgroundTransparency),
		);
	}
}
const previewText = BlockCreation.preview(
	definitionText,
	(parent) => createText("BlockGuiPreview", parent),
	(label, config) => {
		const def = definitionText.input;
		previewShared(label, config, definitionText);
		label.Text = replace(
			BlockCreation.defaultIfWiredUnset(config.format, def.format.types.string.config),
			"{}",
			dataToString(BlockCreation.defaultIfWiredUnset(config.text, def.text.types.string.config)),
		);
		label.TextSize = BlockCreation.defaultIfWiredUnset(config.fontSize, def.fontSize.types.number.config);
		label.TextColor3 = BlockCreation.defaultIfWiredUnset(config.textColor, def.textColor.types.color.config);
		label.TextTransparency = BlockCreation.defaultIfWiredUnset(
			config.textTransparency,
			def.textTransparency.types.number.config,
		);
		label.BackgroundColor3 = BlockCreation.defaultIfWiredUnset(
			config.backgroundColor,
			def.backgroundColor.types.color.config,
		);
		label.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.backgroundTransparency,
			def.backgroundTransparency.types.number.config,
		);
	},
);

//

const createImage = (Name: string, Parent: Instance) => {
	const label = Element.create("ImageLabel", { Name, BackgroundTransparency: 1, BorderSizePixel: 0, Parent });
	Element.create("UICorner", { CornerRadius: new UDim(0, 0), Parent: label });
	return label;
};
@injectable
class GuiImageLogic extends GuiLogic<typeof definitionImage, ImageLabel> {
	constructor(block: BlockLogicArgs, @inject screen: MainScreenLayout) {
		super(definitionImage, block, screen, createImage);
		if (!RunService.IsClient()) return;

		const label = this.gui;
		this.onk(["image"], ({ image }) => (label.Image = `rbxassetid://${image}`));
		this.onk(["backgroundColor"], ({ backgroundColor }) => (label.BackgroundColor3 = backgroundColor));
		this.onk(
			["backgroundTransparency"],
			({ backgroundTransparency }) => (label.BackgroundTransparency = backgroundTransparency),
		);
	}
}
const previewImage = BlockCreation.preview(
	definitionImage,
	(parent) => createImage("BlockGuiPreview", parent),
	(label, config) => {
		const def = definitionImage.input;
		previewShared(label, config, definitionImage);
		label.Image = `rbxassetid://${BlockCreation.defaultIfWiredUnset(config.image, def.image.types.string.config)}`;
		label.BackgroundColor3 = BlockCreation.defaultIfWiredUnset(
			config.backgroundColor,
			def.backgroundColor.types.color.config,
		);
		label.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.backgroundTransparency,
			def.backgroundTransparency.types.number.config,
		);
	},
);

//

const createButton = (Name: string, Parent: Instance) => {
	const button = Element.create("TextButton", {
		Name,
		Font: Enum.Font.Ubuntu,
		TextColor3: Colors.white,
		TextScaled: true,
		BackgroundTransparency: 0,
		Text: "",
		BorderSizePixel: 0,
		Parent,
	});
	Element.create("UICorner", { CornerRadius: new UDim(0, 0), Parent: button });
	return button;
};
@injectable
class GuiButtonLogic extends GuiLogic<typeof definitionButton, TextButton> {
	constructor(block: BlockLogicArgs, @inject screen: MainScreenLayout) {
		super(definitionButton, block, screen, createButton);
		if (!RunService.IsClient()) return;

		const button = this.gui;
		this.onk(["text"], ({ text }) => (button.Text = dataToString(text)));
		this.onk(["textColor"], ({ textColor }) => (button.TextColor3 = textColor));
		this.onk(["textTransparency"], ({ textTransparency }) => (button.TextTransparency = textTransparency));
		this.onk(["backgroundColor"], ({ backgroundColor }) => (button.BackgroundColor3 = backgroundColor));
		this.onk(
			["backgroundTransparency"],
			({ backgroundTransparency }) => (button.BackgroundTransparency = backgroundTransparency),
		);

		button.MouseButton1Down.Connect(() => this.output.pressed.set("bool", true));
		button.MouseButton1Up.Connect(() => this.output.pressed.set("bool", false));
		button.MouseLeave.Connect(() => this.output.pressed.set("bool", false));

		this.output.pressed.set("bool", false);
	}
}
const previewButton = BlockCreation.preview(
	definitionButton,
	(parent) => createButton("BlockGuiPreview", parent),
	(button, config) => {
		const def = definitionButton.input;
		previewShared(button, config, definitionButton);
		button.Text = dataToString(BlockCreation.defaultIfWiredUnset(config.text, def.text.types.string.config));
		button.TextColor3 = BlockCreation.defaultIfWiredUnset(config.textColor, def.textColor.types.color.config);
		button.TextTransparency = BlockCreation.defaultIfWiredUnset(
			config.textTransparency,
			def.textTransparency.types.number.config,
		);
		button.BackgroundColor3 = BlockCreation.defaultIfWiredUnset(
			config.backgroundColor,
			def.backgroundColor.types.color.config,
		);
		button.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.backgroundTransparency,
			def.backgroundTransparency.types.number.config,
		);
	},
);

//

type SwitchGui = TextButton & { Thumb: Frame };

const createSwitch = (Name: string, Parent: Instance): SwitchGui => {
	const track = Element.create("TextButton", { Name, Text: "", AutoButtonColor: false, BorderSizePixel: 0, Parent });
	const thumb = Element.create("Frame", {
		Name: "Thumb",
		SizeConstraint: Enum.SizeConstraint.RelativeYY,
		Size: new UDim2(1, 0, 1, 0),
		BorderSizePixel: 0,
		Parent: track,
	});
	Element.create("UICorner", { CornerRadius: new UDim(0, 0), Parent: track });
	Element.create("UICorner", { CornerRadius: new UDim(0, 0), Parent: thumb });

	return track as SwitchGui;
};
/** Each color is a config range whose color @ 0 shows off and @ 1 shows on; a single color shows both */
const setSwitchState = (
	gui: SwitchGui,
	on: boolean,
	thumbColor: ConfigSequences.ColorValue,
	trackColor: ConfigSequences.ColorValue,
) => {
	const pick = on ? ConfigSequences.lastColor : ConfigSequences.firstColor;
	gui.Thumb.AnchorPoint = new Vector2(on ? 1 : 0, 0.5);
	gui.Thumb.Position = new UDim2(on ? 1 : 0, 0, 0.5, 0);
	gui.Thumb.BackgroundColor3 = pick(thumbColor);
	gui.BackgroundColor3 = pick(trackColor);
};
@injectable
class GuiSwitchLogic extends GuiLogic<typeof definitionSwitch, SwitchGui> {
	constructor(block: BlockLogicArgs, @inject screen: MainScreenLayout) {
		super(definitionSwitch, block, screen, createSwitch);
		if (!RunService.IsClient()) return;

		const track = this.gui;
		let state = false;
		let thumbColor: ConfigSequences.ColorValue = definitionSwitch.input.thumbColor.types.color.config;
		let trackColor: ConfigSequences.ColorValue = definitionSwitch.input.trackColor.types.color.config;
		const apply = (on: boolean) => {
			state = on;
			setSwitchState(track, on, thumbColor, trackColor);
			this.output.state.set("bool", on);
		};

		// registered before the start state so its first paint uses the configured colors
		this.onk(["thumbColor", "trackColor"], (inputs) => {
			thumbColor = inputs.thumbColor;
			trackColor = inputs.trackColor;
			setSwitchState(track, state, thumbColor, trackColor);
		});
		this.onkFirstInputs(["startState"], ({ startState }) => apply(startState));
		this.onk(
			["thumbTransparency"],
			({ thumbTransparency }) => (track.Thumb.BackgroundTransparency = thumbTransparency),
		);
		this.onk(["trackTransparency"], ({ trackTransparency }) => (track.BackgroundTransparency = trackTransparency));

		track.Activated.Connect(() => apply(!state));
	}
}
const previewSwitch = BlockCreation.preview(
	definitionSwitch,
	(parent) => createSwitch("BlockGuiPreview", parent),
	(gui, config) => {
		const def = definitionSwitch.input;
		previewShared(gui, config, definitionSwitch);
		setSwitchState(
			gui,
			BlockCreation.defaultIfWiredUnset(config.startState, def.startState.types.bool.config),
			BlockCreation.defaultIfWiredUnset(config.thumbColor, def.thumbColor.types.color.config),
			BlockCreation.defaultIfWiredUnset(config.trackColor, def.trackColor.types.color.config),
		);
		gui.Thumb.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.thumbTransparency,
			def.thumbTransparency.types.number.config,
		);
		gui.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.trackTransparency,
			def.trackTransparency.types.number.config,
		);
	},
);

//

type BarDirection = (typeof definitionBar.input.direction.types.enum.elementOrder)[number];
type BarGui = Frame & { Fill: Frame };

const createBar = (Name: string, Parent: Instance): BarGui => {
	const background = Element.create("Frame", { Name, BorderSizePixel: 0, Parent });
	const fill = Element.create("Frame", { Name: "Fill", BorderSizePixel: 0, Parent: background });
	Element.create("UICorner", { CornerRadius: new UDim(0, 0), Parent: background });
	Element.create("UICorner", { CornerRadius: new UDim(0, 0), Parent: fill });

	return background as BarGui;
};
/** `fraction` is clamped to 0-1; the fill grows away from the edge `direction` names as its start */
const setBarFill = (gui: BarGui, fraction: number, direction: BarDirection) => {
	const f = math.clamp(fraction, 0, 1);
	const horizontal = direction === "right" || direction === "left";
	const fromEnd = direction === "left" || direction === "up";

	gui.Fill.AnchorPoint = horizontal ? new Vector2(fromEnd ? 1 : 0, 0) : new Vector2(0, fromEnd ? 1 : 0);
	gui.Fill.Position = horizontal ? new UDim2(fromEnd ? 1 : 0, 0, 0, 0) : new UDim2(0, 0, fromEnd ? 1 : 0, 0);
	gui.Fill.Size = horizontal ? new UDim2(f, 0, 1, 0) : new UDim2(1, 0, f, 0);
};
@injectable
class GuiBarLogic extends GuiLogic<typeof definitionBar, BarGui> {
	constructor(block: BlockLogicArgs, @inject screen: MainScreenLayout) {
		super(definitionBar, block, screen, createBar);
		if (!RunService.IsClient()) return;

		const bar = this.gui;
		this.onk(["value", "min", "max", "direction"], ({ value, min, max, direction }) =>
			setBarFill(bar, fractionOf(value, min, max), direction),
		);
		this.onk(["fillColor"], ({ fillColor }) => (bar.Fill.BackgroundColor3 = fillColor));
		this.onk(["fillTransparency"], ({ fillTransparency }) => (bar.Fill.BackgroundTransparency = fillTransparency));
		this.onk(["backgroundColor"], ({ backgroundColor }) => (bar.BackgroundColor3 = backgroundColor));
		this.onk(
			["backgroundTransparency"],
			({ backgroundTransparency }) => (bar.BackgroundTransparency = backgroundTransparency),
		);
	}
}
const previewBar = BlockCreation.preview(
	definitionBar,
	(parent) => createBar("BlockGuiPreview", parent),
	(bar, config) => {
		const def = definitionBar.input;
		previewShared(bar, config, definitionBar);

		// a wired value has nothing to show before the ride, so the preview draws the bar half full
		const min = BlockCreation.defaultIfWiredUnset(config.min, def.min.types.number.config);
		const max = BlockCreation.defaultIfWiredUnset(config.max, def.max.types.number.config);
		const value =
			config.value?.type === "wire"
				? (min + max) / 2
				: BlockCreation.defaultIfWiredUnset(config.value, def.value.types.number.config);
		setBarFill(
			bar,
			fractionOf(value, min, max),
			BlockCreation.defaultIfWiredUnset(config.direction, def.direction.types.enum.config) as BarDirection,
		);
		bar.Fill.BackgroundColor3 = BlockCreation.defaultIfWiredUnset(
			config.fillColor,
			def.fillColor.types.color.config,
		);
		bar.Fill.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.fillTransparency,
			def.fillTransparency.types.number.config,
		);
		bar.BackgroundColor3 = BlockCreation.defaultIfWiredUnset(
			config.backgroundColor,
			def.backgroundColor.types.color.config,
		);
		bar.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.backgroundTransparency,
			def.backgroundTransparency.types.number.config,
		);
	},
);

//

type SliderGui = Frame & { Thumb: Frame };

const createSlider = (Name: string, Parent: Instance): SliderGui => {
	const track = Element.create("Frame", { Name, Active: true, BorderSizePixel: 0, Parent });
	const thumb = Element.create("Frame", { Name: "Thumb", BorderSizePixel: 0, Parent: track });
	Element.create("UICorner", { CornerRadius: new UDim(0, 0), Parent: track });
	Element.create("UICorner", { CornerRadius: new UDim(0, 0), Parent: thumb });

	return track as SliderGui;
};
/** `fraction` 0-1 along the track; the thumb is a square as wide as the track is thick */
const setSliderThumb = (gui: SliderGui, fraction: number, vertical: boolean) => {
	const f = math.clamp(fraction, 0, 1);
	gui.Thumb.SizeConstraint = vertical ? Enum.SizeConstraint.RelativeXX : Enum.SizeConstraint.RelativeYY;
	gui.Thumb.Size = new UDim2(1, 0, 1, 0);
	gui.Thumb.AnchorPoint = new Vector2(0.5, 0.5);
	gui.Thumb.Position = vertical ? new UDim2(0.5, 0, 1 - f, 0) : new UDim2(f, 0, 0.5, 0);
};
@injectable
class GuiSliderLogic extends GuiLogic<typeof definitionSlider, SliderGui> {
	constructor(block: BlockLogicArgs, @inject screen: MainScreenLayout) {
		super(definitionSlider, block, screen, createSlider);
		if (!RunService.IsClient()) return;

		const track = this.gui;
		let min = definitionSlider.input.min.types.number.config;
		let max = definitionSlider.input.max.types.number.config;
		let step = definitionSlider.input.step.types.number.config;
		let startValue = definitionSlider.input.startValue.types.number.config;
		let springBack = false;
		let vertical = false;
		let value = startValue;

		const set = (v: number) => {
			const low = math.min(min, max);
			const high = math.max(min, max);
			let snapped = math.clamp(v, low, high);
			if (step > 0) snapped = math.clamp(min + math.round((snapped - min) / step) * step, low, high);

			value = snapped;
			setSliderThumb(track, fractionOf(value, min, max), vertical);
			this.output.value.set("number", value);
		};

		this.onkFirstInputs(["startValue", "springBack", "vertical"], (inputs) => {
			startValue = inputs.startValue;
			springBack = inputs.springBack;
			vertical = inputs.vertical;
			set(startValue);
		});
		this.onk(["min", "max", "step"], (inputs) => {
			min = inputs.min;
			max = inputs.max;
			step = inputs.step;
			set(value);
		});
		this.onk(["thumbColor"], ({ thumbColor }) => (track.Thumb.BackgroundColor3 = thumbColor));
		this.onk(
			["thumbTransparency"],
			({ thumbTransparency }) => (track.Thumb.BackgroundTransparency = thumbTransparency),
		);
		this.onk(["trackColor"], ({ trackColor }) => (track.BackgroundColor3 = trackColor));
		this.onk(["trackTransparency"], ({ trackTransparency }) => (track.BackgroundTransparency = trackTransparency));

		const unbind = bindDrag(
			track,
			(pointer) => {
				const origin = track.AbsolutePosition;
				const size = track.AbsoluteSize;
				const fraction = vertical ? 1 - (pointer.Y - origin.Y) / size.Y : (pointer.X - origin.X) / size.X;
				set(min + math.clamp(fraction, 0, 1) * (max - min));
			},
			() => {
				if (springBack) set(startValue);
			},
		);
		this.onDisable(unbind);
	}
}
const previewSlider = BlockCreation.preview(
	definitionSlider,
	(parent) => createSlider("BlockGuiPreview", parent),
	(gui, config) => {
		const def = definitionSlider.input;
		previewShared(gui, config, definitionSlider);
		setSliderThumb(
			gui,
			fractionOf(
				BlockCreation.defaultIfWiredUnset(config.startValue, def.startValue.types.number.config),
				BlockCreation.defaultIfWiredUnset(config.min, def.min.types.number.config),
				BlockCreation.defaultIfWiredUnset(config.max, def.max.types.number.config),
			),
			BlockCreation.defaultIfWiredUnset(config.vertical, def.vertical.types.bool.config),
		);
		gui.Thumb.BackgroundColor3 = BlockCreation.defaultIfWiredUnset(
			config.thumbColor,
			def.thumbColor.types.color.config,
		);
		gui.Thumb.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.thumbTransparency,
			def.thumbTransparency.types.number.config,
		);
		gui.BackgroundColor3 = BlockCreation.defaultIfWiredUnset(config.trackColor, def.trackColor.types.color.config);
		gui.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.trackTransparency,
			def.trackTransparency.types.number.config,
		);
	},
);

//

type JoystickGui = Frame & { Knob: Frame };

/** The knob's diameter as a share of the base's */
const knobShare = 0.45;

/** `direction` within the unit circle, Y up; the knob travels until its edge meets the base's */
const setJoystickKnob = (gui: JoystickGui, direction: Vector2) => {
	const reach = (1 - knobShare) / 2;
	gui.Knob.Position = new UDim2(0.5 + direction.X * reach, 0, 0.5 - direction.Y * reach, 0);
};
const createJoystick = (Name: string, Parent: Instance): JoystickGui => {
	const base = Element.create("Frame", {
		Name,
		Active: true,
		SizeConstraint: Enum.SizeConstraint.RelativeYY,
		BorderSizePixel: 0,
		Parent,
	});
	const knob = Element.create("Frame", {
		Name: "Knob",
		AnchorPoint: new Vector2(0.5, 0.5),
		Size: new UDim2(knobShare, 0, knobShare, 0),
		BorderSizePixel: 0,
		Parent: base,
	});
	Element.create("UICorner", { CornerRadius: new UDim(0.5, 0), Parent: base });
	Element.create("UICorner", { CornerRadius: new UDim(0.5, 0), Parent: knob });
	setJoystickKnob(base as JoystickGui, Vector2.zero);

	return base as JoystickGui;
};
/** Measured in Studio: the screen's UIScale multiplies a RelativeYY size, so it is divided back out */
const setJoystickSize = (gui: JoystickGui, size: number) => {
	const scale = gui.FindFirstAncestorWhichIsA("LayerCollector")?.FindFirstChildOfClass("UIScale")?.Scale ?? 1;
	gui.Size = new UDim2(size / scale, 0, size / scale, 0);
};
@injectable
class GuiJoystickLogic extends GuiLogic<typeof definitionJoystick, JoystickGui> {
	constructor(block: BlockLogicArgs, @inject screen: MainScreenLayout) {
		super(definitionJoystick, block, screen, createJoystick);
		if (!RunService.IsClient()) return;

		const base = this.gui;
		const set = (direction: Vector2) => {
			setJoystickKnob(base, direction);
			// same outputs as the Joystick Sensor: angle 0 is up and grows clockwise
			this.output.x.set("number", direction.X);
			this.output.y.set("number", direction.Y);
			this.output.angle.set(
				"number",
				direction.Magnitude > 0 ? math.deg(math.atan2(direction.X, direction.Y)) : 0,
			);
		};
		set(Vector2.zero);

		this.onk(["size"], ({ size }) => setJoystickSize(base, size));
		this.onk(["knobColor"], ({ knobColor }) => (base.Knob.BackgroundColor3 = knobColor));
		this.onk(["knobTransparency"], ({ knobTransparency }) => (base.Knob.BackgroundTransparency = knobTransparency));
		this.onk(["baseColor"], ({ baseColor }) => (base.BackgroundColor3 = baseColor));
		this.onk(["baseTransparency"], ({ baseTransparency }) => (base.BackgroundTransparency = baseTransparency));

		const unbind = bindDrag(
			base,
			(pointer) => {
				const radius = base.AbsoluteSize.X / 2;
				if (radius <= 0) return;

				const center = base.AbsolutePosition.add(base.AbsoluteSize.div(2));
				const offset = pointer.sub(center).div(radius);
				const flipped = new Vector2(offset.X, -offset.Y);
				set(flipped.Magnitude > 1 ? flipped.Unit : flipped);
			},
			() => set(Vector2.zero),
		);
		this.onDisable(unbind);
	}
}
const previewJoystick = BlockCreation.preview(
	definitionJoystick,
	(parent) => createJoystick("BlockGuiPreview", parent),
	(gui, config) => {
		const def = definitionJoystick.input;
		previewShared(gui, config, definitionJoystick);
		setJoystickSize(gui, BlockCreation.defaultIfWiredUnset(config.size, def.size.types.number.config));
		gui.Knob.BackgroundColor3 = BlockCreation.defaultIfWiredUnset(
			config.knobColor,
			def.knobColor.types.color.config,
		);
		gui.Knob.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.knobTransparency,
			def.knobTransparency.types.number.config,
		);
		gui.BackgroundColor3 = BlockCreation.defaultIfWiredUnset(config.baseColor, def.baseColor.types.color.config);
		gui.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.baseTransparency,
			def.baseTransparency.types.number.config,
		);
	},
);

//

const createPanel = (Name: string, Parent: Instance) => {
	const panel = Element.create("Frame", { Name, BorderSizePixel: 0, Parent });
	Element.create("UICorner", { CornerRadius: new UDim(0, 0), Parent: panel });
	return panel;
};
@injectable
class GuiPanelLogic extends GuiLogic<typeof definitionPanel, Frame> {
	constructor(block: BlockLogicArgs, @inject screen: MainScreenLayout) {
		super(definitionPanel, block, screen, createPanel);
		if (!RunService.IsClient()) return;

		const panel = this.gui;
		this.onk(["color"], ({ color }) => (panel.BackgroundColor3 = color));
		this.onk(["transparency"], ({ transparency }) => (panel.BackgroundTransparency = transparency));
	}
}
const previewPanel = BlockCreation.preview(
	definitionPanel,
	(parent) => createPanel("BlockGuiPreview", parent),
	(panel, config) => {
		const def = definitionPanel.input;
		previewShared(panel, config, definitionPanel);
		panel.BackgroundColor3 = BlockCreation.defaultIfWiredUnset(config.color, def.color.types.color.config);
		panel.BackgroundTransparency = BlockCreation.defaultIfWiredUnset(
			config.transparency,
			def.transparency.types.number.config,
		);
	},
);

//

type LineState = {
	visible: boolean;
	startPoint: Vector3;
	endPoint: Vector3;
	thickness: ConfigSequences.NumberValue;
	color: ConfigSequences.ColorValue;
	transparency: number;
	zIndex: number;
};

/** Segments drawn for a tapering or blending line; a plain line is a single frame */
const sequenceSegments = 16;

/**
 * Draws `state` into `folder` as rotated frames, reusing the frames already there. Lengths and thickness are worked
 * out in pixels and set back as Scale: the screen's UIScale multiplies Offset sizes, and Offset is a whole pixel,
 * which rounded a thin line away entirely.
 */
const drawLine = (folder: Folder, state: LineState) => {
	const screen = folder.FindFirstAncestorWhichIsA("LayerCollector");
	if (!screen) return;

	const viewport = screen.AbsoluteSize;
	if (viewport.X <= 0 || viewport.Y <= 0) return;

	const tapered = !typeIs(state.thickness, "number") || !typeIs(state.color, "Color3");
	const count = tapered ? sequenceSegments : 1;

	const delta = new Vector2(
		(state.endPoint.X - state.startPoint.X) * viewport.X,
		(state.endPoint.Y - state.startPoint.Y) * viewport.Y,
	);
	const rotation = math.deg(math.atan2(delta.Y, delta.X));
	// a pixel of overlap hides the seams between segments of a turning thickness
	const segmentLength = delta.Magnitude / count + (count > 1 ? 1 : 0);

	const frames = folder.GetChildren() as Frame[];
	for (let i = 0; i < count; i++) {
		const middle = (i + 0.5) / count;
		const frame =
			frames[i] ??
			Element.create("Frame", { AnchorPoint: new Vector2(0.5, 0.5), BorderSizePixel: 0, Parent: folder });

		frame.Visible = state.visible;
		frame.Position = new UDim2(
			state.startPoint.X + (state.endPoint.X - state.startPoint.X) * middle,
			0,
			state.startPoint.Y + (state.endPoint.Y - state.startPoint.Y) * middle,
			0,
		);
		frame.Size = UDim2.fromScale(segmentLength / viewport.X, ConfigSequences.numberAt(state.thickness, middle));
		frame.Rotation = rotation;
		frame.BackgroundColor3 = ConfigSequences.colorAt(state.color, middle);
		frame.BackgroundTransparency = state.transparency;
		frame.ZIndex = state.zIndex;
	}
	for (let i = count; i < frames.size(); i++) frames[i].Destroy();
};

/** Not a {@link GuiLogic}: a line has endpoints rather than a position and size, and draws into a Folder */
@injectable
class GuiLineLogic extends BlockLogic<typeof definitionLine> {
	constructor(block: BlockLogicArgs, @inject screen: MainScreenLayout) {
		super(definitionLine, block);
		if (!RunService.IsClient()) return;

		const folder = Element.create("Folder", {
			Name: `BlockLine${block.instance?.Name}`,
			Parent: screen.fullScreenScaled8,
		});
		this.onDisable(() => folder.Destroy());

		const def = definitionLine.input;
		const state: LineState = {
			visible: def.visible.types.bool.config,
			startPoint: def.startPoint.types.vector3.config,
			endPoint: def.endPoint.types.vector3.config,
			thickness: def.thickness.types.number.config,
			color: def.color.types.color.config,
			transparency: def.transparency.types.number.config,
			zIndex: def.zIndex.types.number.config,
		};
		this.onk(
			["visible", "startPoint", "endPoint", "thickness", "color", "transparency", "zIndex"],
			({ visible, startPoint, endPoint, thickness, color, transparency, zIndex }) => {
				state.visible = visible;
				state.startPoint = startPoint;
				state.endPoint = endPoint;
				state.thickness = thickness;
				state.color = color;
				state.transparency = transparency;
				state.zIndex = zIndex;
				drawLine(folder, state);
			},
		);
		this.event.subscribe(screen.fullScreenScaled8.GetPropertyChangedSignal("AbsoluteSize"), () =>
			drawLine(folder, state),
		);
	}
}
const previewLine = BlockCreation.preview(
	definitionLine,
	(Parent) => Element.create("Folder", { Name: "BlockGuiPreview", Parent }),
	(folder, config) => {
		const def = definitionLine.input;
		drawLine(folder, {
			visible: true,
			startPoint: BlockCreation.defaultIfWiredUnset(config.startPoint, def.startPoint.types.vector3.config),
			endPoint: BlockCreation.defaultIfWiredUnset(config.endPoint, def.endPoint.types.vector3.config),
			thickness: BlockCreation.defaultIfWiredUnset(config.thickness, def.thickness.types.number.config),
			color: BlockCreation.defaultIfWiredUnset(config.color, def.color.types.color.config),
			transparency: BlockCreation.defaultIfWiredUnset(config.transparency, def.transparency.types.number.config),
			zIndex: BlockCreation.defaultIfWiredUnset(config.zIndex, def.zIndex.types.number.config),
		});
	},
);

//

const model = (label: string) => ({
	model: BlockCreation.Model.fAutoCreated("x4GuiLogicBlockPrefab", label),
	category: () => BlockCreation.Categories.gui,
});

export const GuiBlocks = [
	{
		...BlockCreation.defaults,
		id: "guitext",
		logicPriority: BlockCreation.priority.Output,
		displayName: "GUI Text",
		description: "Writes text on your screen",
		logic: { definition: definitionText, ctor: GuiTextLogic, preview: previewText },
		modelSource: model("TEXT"),
	},
	{
		...BlockCreation.defaults,
		id: "guiimage",
		logicPriority: BlockCreation.priority.Output,
		displayName: "GUI Image",
		description: "Draws an image on your screen",
		logic: { definition: definitionImage, ctor: GuiImageLogic, preview: previewImage },
		modelSource: model("IMAGE"),
	},
	{
		...BlockCreation.defaults,
		id: "guibutton",
		displayName: "GUI Button",
		description: "Places a button on your screen",
		logic: { definition: definitionButton, ctor: GuiButtonLogic, preview: previewButton },
		modelSource: model("BUTTON"),
	},
	{
		...BlockCreation.defaults,
		id: "guiswitch",
		displayName: "GUI Switch",
		description: "Places a switch on your screen",
		logic: { definition: definitionSwitch, ctor: GuiSwitchLogic, preview: previewSwitch },
		modelSource: model("SWITCH"),
	},
	{
		...BlockCreation.defaults,
		id: "guibar",
		logicPriority: BlockCreation.priority.Output,
		displayName: "GUI Bar",
		description: "Places a bar on your screen that fills with a value",
		logic: { definition: definitionBar, ctor: GuiBarLogic, preview: previewBar },
		modelSource: model("BAR"),
	},
	{
		...BlockCreation.defaults,
		id: "guislider",
		displayName: "GUI Slider",
		description: "Places a slider on your screen that outputs a number",
		logic: { definition: definitionSlider, ctor: GuiSliderLogic, preview: previewSlider },
		modelSource: model("SLIDER"),
	},
	{
		...BlockCreation.defaults,
		id: "guijoystick",
		displayName: "GUI Joystick",
		description: "Places a joystick on your screen that outputs a direction",
		logic: { definition: definitionJoystick, ctor: GuiJoystickLogic, preview: previewJoystick },
		modelSource: model("STICK"),
	},
	{
		...BlockCreation.defaults,
		id: "guipanel",
		logicPriority: BlockCreation.priority.Output,
		displayName: "GUI Panel",
		description: "Places a plain frame on your screen",
		logic: { definition: definitionPanel, ctor: GuiPanelLogic, preview: previewPanel },
		modelSource: model("PANEL"),
	},
	{
		...BlockCreation.defaults,
		id: "guiline",
		logicPriority: BlockCreation.priority.Output,
		displayName: "GUI Line",
		description: "Draws a line between two points on your screen",
		logic: { definition: definitionLine, ctor: GuiLineLogic, preview: previewLine },
		modelSource: model("LINE"),
	},
] as const satisfies BlockBuilder[];
