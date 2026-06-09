import { RunService, UserInputService } from "@rbxts/services";

import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";

import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

function applySquareMapping(x: number, y: number): Vector2 {
	if (x === 0 && y === 0) return Vector2.zero;

	const rawInput = new Vector2(x, y);
	const direction = rawInput.Unit;

	const maxAxis = math.max(math.abs(direction.X), math.abs(direction.Y));
	const squareBoundaryVector = direction.div(maxAxis);

	const inputMagnitude = math.min(rawInput.Magnitude, 1);
	const mappedResult = squareBoundaryVector.mul(inputMagnitude);

	return new Vector2(math.clamp(mappedResult.X, -1, 1), math.clamp(mappedResult.Y, -1, 1));
}

const definition = {
	outputOrder: [
		"LeftStick",
		"LeftStickButton",
		"LeftTrigger",
		"RightStick",
		"RightStickButton",
		"RightTrigger",
		"DPadUp",
		"DPadDown",
		"DPadLeft",
		"DPadright",
		"LeftBumper",
		"RightBumper",
		"A",
		"B",
		"X",
		"Y",
	],
	input: {
		squareMode: {
			displayName: "Square Stick Mode",
			tooltip: "Remaps circular thumbstick ranges to square outputs",
			types: {
				bool: {
					config: false,
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		LeftStick: { displayName: "Left Stick", types: ["vector3"] },
		LeftStickButton: { displayName: "Left Stick Button", types: ["bool"] },
		LeftTrigger: { displayName: "Left Trigger", types: ["number"] },

		RightStick: { displayName: "Right Stick", types: ["vector3"] },
		RightStickButton: { displayName: "Right Stick Button", types: ["bool"] },
		RightTrigger: { displayName: "Right Trigger", types: ["number"] },

		DPadUp: { displayName: "D-Pad Up", types: ["bool"] },
		DPadDown: { displayName: "D-Pad Down", types: ["bool"] },
		DPadLeft: { displayName: "D-Pad Left", types: ["bool"] },
		DPadright: { displayName: "D-Pad Right", types: ["bool"] },

		LeftBumper: { displayName: "Left Bumper", types: ["bool"] },
		RightBumper: { displayName: "Right Bumper", types: ["bool"] },

		A: { displayName: "A", types: ["bool"] },
		B: { displayName: "B", types: ["bool"] },
		X: { displayName: "X", types: ["bool"] },
		Y: { displayName: "Y", types: ["bool"] },
	},
} satisfies BlockLogicFullBothDefinitions;

// Gamepad mappings
const buttonOutputs = [
	[Enum.KeyCode.DPadUp, "DPadUp"],
	[Enum.KeyCode.DPadDown, "DPadDown"],
	[Enum.KeyCode.DPadLeft, "DPadLeft"],
	[Enum.KeyCode.DPadRight, "DPadright"],
	[Enum.KeyCode.ButtonL1, "LeftBumper"],
	[Enum.KeyCode.ButtonR1, "RightBumper"],
	[Enum.KeyCode.ButtonL3, "LeftStickButton"],
	[Enum.KeyCode.ButtonR3, "RightStickButton"],
	[Enum.KeyCode.ButtonA, "A"],
	[Enum.KeyCode.ButtonB, "B"],
	[Enum.KeyCode.ButtonX, "X"],
	[Enum.KeyCode.ButtonY, "Y"],
] as const;

export type { Logic as ControllerSensorBlockLogic };

@injectable
class Logic extends BlockLogic<typeof definition> {
	private squareMode = false;

	constructor(block: BlockLogicArgs) {
		super(definition, block);

		this.onk(["squareMode"], ({ squareMode }) => {
			this.squareMode = squareMode;
		});

		this.onTicc(() => {
			if (!RunService.IsClient()) return;
			const gamepadState = UserInputService.GetGamepadState(Enum.UserInputType.Gamepad1);

			let leftStick = Vector3.zero;
			let rightStick = Vector3.zero;
			let leftTrigger = 0;
			let rightTrigger = 0;
			const pressed = new Set<Enum.KeyCode>();

			for (const input of gamepadState) {
				const key = input.KeyCode;
				if (key === Enum.KeyCode.Thumbstick1) {
					let v = new Vector2(input.Position.X, input.Position.Y);
					if (this.squareMode) v = applySquareMapping(v.X, v.Y);
					leftStick = new Vector3(v.X, v.Y, 0);
					continue;
				}

				if (key === Enum.KeyCode.Thumbstick2) {
					let v = new Vector2(input.Position.X, input.Position.Y);
					if (this.squareMode) v = applySquareMapping(v.X, v.Y);
					rightStick = new Vector3(v.X, v.Y, 0);
					continue;
				}

				if (key === Enum.KeyCode.ButtonL2) {
					leftTrigger = input.Position.Z;
					continue;
				}

				if (key === Enum.KeyCode.ButtonR2) {
					rightTrigger = input.Position.Z;
					continue;
				}

				if (
					input.UserInputState === Enum.UserInputState.Begin ||
					input.UserInputState === Enum.UserInputState.Change
				) {
					pressed.add(key);
					continue;
				}
			}

			this.output.LeftStick.set("vector3", leftStick);
			this.output.RightStick.set("vector3", rightStick);
			this.output.LeftTrigger.set("number", leftTrigger);
			this.output.RightTrigger.set("number", rightTrigger);

			for (const [key, out] of buttonOutputs) {
				this.output[out].set("bool", pressed.has(key));
			}
		});
	}
}

export const ControllerSensorBlock = {
	...BlockCreation.defaults,

	id: "controllersensor",
	displayName: "Controller Sensor",
	description: "Tracks comprehensive controller maps with toggleable square joystick normalization constraints",

	logic: {
		definition,
		ctor: Logic,
	},
} as const satisfies BlockBuilder;
