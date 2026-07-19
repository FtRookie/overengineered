import { Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import type { RadialUnit } from "shared/data/GameDefinitions";

const definition = {
	outputOrder: ["position", "angle", "direction", "angle3d", "position3d", "leftClick", "rightClick", "middleClick"],
	input: {
		unit: {
			displayName: "Unit",
			types: {
				enum: {
					config: "radian",
					elementOrder: ["radian", "degree"],
					elements: {
						radian: { displayName: "Radians", tooltip: "The default unit of 180°/π" },
						degree: { displayName: "Degrees", tooltip: "Degrees" },
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		position: {
			displayName: "Position",
			unit: "Vector2 0-1",
			types: ["vector3"],
		},
		angle: {
			displayName: "Angle around the center",
			unit: "Degrees",
			types: ["number"],
		},
		direction: {
			displayName: "3D Direction",
			unit: "Vector3 unit",
			types: ["vector3"],
		},
		angle3d: {
			displayName: "3D Angle of direction",
			unit: "Radians",
			types: ["vector3"],
		},
		position3d: {
			displayName: "3D Position",
			unit: "Vector3 Global position",
			types: ["vector3"],
		},
		leftClick: {
			displayName: "Left Click",
			types: ["bool"],
		},
		rightClick: {
			displayName: "Right Click",
			types: ["bool"],
		},
		middleClick: {
			displayName: "Middle Click",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as MouseSensorBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		// unit is config-only, so resolve the multiplier once instead of re-reading it every tick
		let unitMul = GameDefinitions.RADIANS_TO.radian;
		this.onkFirstInputs(["unit"], ({ unit }) => (unitMul = GameDefinitions.RADIANS_TO[unit as RadialUnit]));
		let wheel = 0;

		if (RunService.IsClient()) {
			this.event.subscribe(UserInputService.InputChanged, (input) => {
				if (input.UserInputType === Enum.UserInputType.MouseWheel) {
					wheel = input.Position.Z;
				}
			});
		}

		this.event.subscribe(RunService.PostSimulation, () => {
			const camera = Workspace.CurrentCamera;
			const mousePos = UserInputService.GetMouseLocation();
			const relaPos = mousePos.div(camera!.ViewportSize);

			this.output.position.set("vector3", new Vector3(relaPos.X, relaPos.Y, wheel));
			wheel = 0;

			const angle = math.atan2(-(relaPos.Y - 0.5), relaPos.X - 0.5);
			this.output.angle.set("number", angle * unitMul);

			if (camera) {
				const ray = camera.ViewportPointToRay(mousePos.X, mousePos.Y);
				const [x, y, z] = CFrame.lookAt(Vector3.zero, ray.Direction).ToOrientation();

				this.output.direction.set("vector3", ray.Direction);
				this.output.angle3d.set("vector3", new Vector3(x, y, z));
				this.output.position3d.set(
					"vector3",
					Players.LocalPlayer.GetMouse()!.Hit.Position.sub(new Vector3(0, GameDefinitions.HEIGHT_OFFSET, 0)),
				);
			}
			this.output.leftClick.set("bool", UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton1));
			this.output.rightClick.set("bool", UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton2));
			this.output.middleClick.set("bool", UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton3));
		});
	}
}

export const MouseSensorBlock = {
	...BlockCreation.defaults,
	id: "mousesensor",
	displayName: "Mouse Sensor",
	description: "Returns some data about the mouse cursor",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
