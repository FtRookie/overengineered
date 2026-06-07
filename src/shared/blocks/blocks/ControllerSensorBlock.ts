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

export type { Logic as ControllerSensorBlockLogic };

@injectable
class Logic extends BlockLogic<typeof definition> {
	private squareMode = false;

	constructor(block: BlockLogicArgs) {
		super(definition, block);

		let leftStick = Vector3.zero;
		let rightStick = Vector3.zero;

		let leftTrigger = 0;
		let rightTrigger = 0;

		let leftStickButton = false;
		let rightStickButton = false;

		let dPadUp = false;
		let dPadDown = false;
		let dPadLeft = false;
		let dPadRight = false;

		let leftBumper = false;
		let rightBumper = false;

		let buttonA = false;
		let buttonB = false;
		let buttonX = false;
		let buttonY = false;

		this.onk(["squareMode"], ({ squareMode }) => {
			this.squareMode = squareMode;
		});

		if (RunService.IsClient()) {
			UserInputService.InputChanged.Connect((input, gameProcessed) => {
				if (gameProcessed) return;
				if (input.UserInputType !== Enum.UserInputType.Gamepad1) return;

				if (input.KeyCode === Enum.KeyCode.Thumbstick1) {
					let v = new Vector2(input.Position.X, input.Position.Y);
					if (this.squareMode) v = applySquareMapping(v.X, v.Y);
					leftStick = new Vector3(v.X, v.Y, 0);
				} else if (input.KeyCode === Enum.KeyCode.Thumbstick2) {
					let v = new Vector2(input.Position.X, input.Position.Y);
					if (this.squareMode) v = applySquareMapping(v.X, v.Y);
					rightStick = new Vector3(v.X, v.Y, 0);
				}

				if (input.KeyCode === Enum.KeyCode.ButtonL2) {
					leftTrigger = input.Position.Z;
				}

				if (input.KeyCode === Enum.KeyCode.ButtonR2) {
					rightTrigger = input.Position.Z;
				}
			});
		}

		this.onTicc(() => {
			if (RunService.IsClient()) {
				const gamepadState = UserInputService.GetGamepadState(Enum.UserInputType.Gamepad1);

				leftStickButton = false;
				rightStickButton = false;

				dPadUp = false;
				dPadDown = false;
				dPadLeft = false;
				dPadRight = false;

				leftBumper = false;
				rightBumper = false;

				buttonA = false;
				buttonB = false;
				buttonX = false;
				buttonY = false;

				for (const input of gamepadState) {
					if (input.KeyCode === Enum.KeyCode.Thumbstick1) {
						let v = new Vector2(input.Position.X, input.Position.Y);
						if (this.squareMode) v = applySquareMapping(v.X, v.Y);
						leftStick = new Vector3(v.X, v.Y, 0);
					} else if (input.KeyCode === Enum.KeyCode.Thumbstick2) {
						let v = new Vector2(input.Position.X, input.Position.Y);
						if (this.squareMode) v = applySquareMapping(v.X, v.Y);
						rightStick = new Vector3(v.X, v.Y, 0);
					} else if (input.KeyCode === Enum.KeyCode.ButtonL2) {
						leftTrigger = input.Position.Z;
					} else if (input.KeyCode === Enum.KeyCode.ButtonR2) {
						rightTrigger = input.Position.Z;
					} else if (input.KeyCode === Enum.KeyCode.ButtonL3) {
						if (
							input.UserInputState === Enum.UserInputState.Begin ||
							input.UserInputState === Enum.UserInputState.Change
						) {
							leftStickButton = true;
						}
					} else if (input.KeyCode === Enum.KeyCode.ButtonR3) {
						if (
							input.UserInputState === Enum.UserInputState.Begin ||
							input.UserInputState === Enum.UserInputState.Change
						) {
							rightStickButton = true;
						}
					} else if (
						input.UserInputState === Enum.UserInputState.Begin ||
						input.UserInputState === Enum.UserInputState.Change
					) {
						if (input.KeyCode === Enum.KeyCode.DPadUp) dPadUp = true;
						else if (input.KeyCode === Enum.KeyCode.DPadDown) dPadDown = true;
						else if (input.KeyCode === Enum.KeyCode.DPadLeft) dPadLeft = true;
						else if (input.KeyCode === Enum.KeyCode.DPadRight) dPadRight = true;
						else if (input.KeyCode === Enum.KeyCode.ButtonL1) leftBumper = true;
						else if (input.KeyCode === Enum.KeyCode.ButtonR1) rightBumper = true;
						else if (input.KeyCode === Enum.KeyCode.ButtonA) buttonA = true;
						else if (input.KeyCode === Enum.KeyCode.ButtonB) buttonB = true;
						else if (input.KeyCode === Enum.KeyCode.ButtonX) buttonX = true;
						else if (input.KeyCode === Enum.KeyCode.ButtonY) buttonY = true;
					}
				}
			}

			this.output["LeftStick"].set("vector3", leftStick);
			this.output["LeftStickButton"].set("bool", leftStickButton);
			this.output["LeftTrigger"].set("number", leftTrigger);

			this.output["RightStick"].set("vector3", rightStick);
			this.output["RightStickButton"].set("bool", rightStickButton);
			this.output["RightTrigger"].set("number", rightTrigger);

			this.output["DPadUp"].set("bool", dPadUp);
			this.output["DPadDown"].set("bool", dPadDown);
			this.output["DPadLeft"].set("bool", dPadLeft);
			this.output["DPadright"].set("bool", dPadRight);

			this.output["LeftBumper"].set("bool", leftBumper);
			this.output["RightBumper"].set("bool", rightBumper);

			this.output["A"].set("bool", buttonA);
			this.output["B"].set("bool", buttonB);
			this.output["X"].set("bool", buttonX);
			this.output["Y"].set("bool", buttonY);
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
