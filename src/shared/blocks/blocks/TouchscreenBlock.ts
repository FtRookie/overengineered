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
	},
	output: {
		position: {
			displayName: "Touch Position",
			tooltip: "Position on the screen face, 0 to 1 on each axis",
			types: ["vector3"],
		},

		press: {
			displayName: "Touch",
			tooltip: "True while the screen is touched",
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

const half = new Vector3(0.5, 0.5, 0.5);

export type { Logic as TouchscreenBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition, TouchscreenBlockModel> {
	constructor(block: InstanceBlockLogicArgs, @inject cursor: CursorService) {
		super(definition, block);

		this.onEnable(() => {
			this.instance.Screen.TextBack.Enabled = false;
			this.instance.Screen.TextFront.Enabled = false;
			this.output.press.set("bool", false);
		});

		this.onk(["touch_visible", "touch_color"], ({ touch_visible, touch_color }) => {
			this.instance.TouchSpot.Transparency = touch_visible ? 0.4 : 1;
			this.instance.TouchSpot.Color = touch_color;
		});

		const screen = this.instance.Screen;
		this.event.subscribe(cursor.pressed, ({ part, position }) => {
			if (part !== screen) return;

			this.instance.TouchSpot.Position = position;
			this.output.position.set("vector3", screen.CFrame.PointToObjectSpace(position).div(screen.Size).add(half));
			this.output.press.set("bool", true);
		});

		this.event.subscribe(cursor.released, () => {
			this.output.press.set("bool", false);
		});

		this.unsetOutputsOnDisable();
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
