import { Colors } from "engine/shared/Colors";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { CursorService } from "client/CursorService";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		touch_visible: {
			displayName: "Touch Point Visibility",
			types: {
				bool: {
					config: true,
				},
			},
		},
		touch_color: {
			displayName: "Touch Point Color",
			types: {
				color: {
					config: Colors.red,
				},
			},
		},
		// transparency: {
		// 	displayName: "Screen Transparency",
		// 	types: {
		// 		number: {
		// 			clamp: {
		// 				min: 0,
		// 				max: 1,
		// 				showAsSlider: true,
		// 			},
		// 			config: 1,
		// 		},
		// 	},
		// },
	},
	output: {
		position: {
			displayName: "Touch Position",
			tooltip: "Normalized position on the screen",
			types: ["vector3"],
		},

		press: {
			displayName: "Touch",
			tooltip: "Returns true if screen got touched",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type TouchscreenBlockModel = BlockModel & {
	TouchSpot: BasePart;
	Screen: BasePart & {
		TextBack: SurfaceGui;
		TextFront: SurfaceGui;
	};
};

export type { Logic as SizeBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition, TouchscreenBlockModel> {
	constructor(block: InstanceBlockLogicArgs, @inject cursor: CursorService) {
		super(definition, block);

		this.onEnable(() => {
			this.instance.Screen.TextBack.Enabled = false;
			this.instance.Screen.TextFront.Enabled = false;
		});

		this.onk(["touch_visible", "touch_color"], ({ touch_visible, touch_color }) => {
			this.instance.TouchSpot.Transparency = touch_visible ? 0.4 : 0;
			this.instance.TouchSpot.Color = touch_color;
		});

		this.event.subscribe(cursor.clicked, ({ block, part, position }) => {
			if (block !== this.instance) return;
			if (part !== this.instance.Screen) return;
			this.instance.TouchSpot.Position = position;
			this.output.position.set("vector3", part.CFrame.PointToObjectSpace(position).div(part.Size));
		});
	}
}

export const TouchscreenBlock = {
	...BlockCreation.defaults,
	id: "touchscreen",
	displayName: "Touchscreen",
	description: "Registers your presses. Returns normalized position.",
	search: {
		partialAliases: ["touch", "button", "screen"],
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
