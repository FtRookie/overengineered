import { ContextActionService, RunService } from "@rbxts/services";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	outputOrder: ["text", "name", "id", "pressed"],
	input: {},
	output: {
		text: {
			displayName: "Key text",
			types: ["string"],
		},
		name: {
			displayName: "Key name",
			types: ["string"],
		},
		id: {
			displayName: "Key id",
			types: ["number"],
		},
		pressed: {
			displayName: "Pressed",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as KeyboardSensorBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		if (!RunService.IsClient()) return;

		const keyToStr = (key: KeyCode) => {
			if (key === "Zero") return "0";
			if (key === "One") return "1";
			if (key === "Two") return "2";
			if (key === "Three") return "3";
			if (key === "Four") return "4";
			if (key === "Five") return "5";
			if (key === "Six") return "6";
			if (key === "Seven") return "7";
			if (key === "Eight") return "8";
			if (key === "Nine") return "9";

			if (key === "KeypadZero") return "0";
			if (key === "KeypadOne") return "1";
			if (key === "KeypadTwo") return "2";
			if (key === "KeypadThree") return "3";
			if (key === "KeypadFour") return "4";
			if (key === "KeypadFive") return "5";
			if (key === "KeypadSix") return "6";
			if (key === "KeypadSeven") return "7";
			if (key === "KeypadEight") return "8";
			if (key === "KeypadNine") return "9";

			return key;
		};

		const actname = "kbl_" + BlockManager.manager.uuid.get(block.instance!);
		ContextActionService.BindActionAtPriority(
			actname,
			(_, state, input) => {
				if (input.UserInputType !== Enum.UserInputType.Keyboard) {
					return;
				}

				let pressed;
				if (state === Enum.UserInputState.Begin) {
					pressed = true;
				} else if (state === Enum.UserInputState.End) {
					pressed = false;
				} else {
					return Enum.ContextActionResult.Pass;
				}

				this.output.pressed.set("bool", pressed);
				this.output.text.set("string", keyToStr(input.KeyCode.Name));
				this.output.id.set("number", input.KeyCode.Value);
				this.output.name.set("string", input.KeyCode.Name);

				return Enum.ContextActionResult.Pass;
			},
			false,
			123456798,
			Enum.UserInputType.Keyboard,
		);

		this.onDisable(() => ContextActionService.UnbindAction(actname));
	}
}

export const KeyboardBlock = {
	...BlockCreation.defaults,
	id: "keyboardsensor",
	displayName: "Keyboard Sensor",
	description: "Returns a pressed (or released) keyboard key",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
