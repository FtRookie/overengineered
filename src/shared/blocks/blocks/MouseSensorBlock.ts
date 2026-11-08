import { RunService, UserInputService, Workspace } from "@rbxts/services";
import { PerFrame } from "engine/shared/PerFrame";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { CursorService } from "client/CursorService";
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

type PointerFrame = {
	readonly relaPos: Vector2;
	readonly angle: number;
	readonly world:
		{ readonly direction: Vector3; readonly angle3d: Vector3; readonly position3d: Vector3 } | undefined;
	readonly left: boolean;
	readonly right: boolean;
	readonly middle: boolean;
};
let pointer: PerFrame<PointerFrame> | undefined;

export type { Logic as MouseSensorBlockLogic };
@injectable
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs, @inject cursor: CursorService) {
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

		// everything but the wheel and the unit is the same for every sensor, so it is read once per frame
		const shared = (pointer ??= new PerFrame(() => {
			const camera = Workspace.CurrentCamera;
			const relaPos = UserInputService.GetMouseLocation().div(camera!.ViewportSize);

			let world: { direction: Vector3; angle3d: Vector3; position3d: Vector3 } | undefined;
			if (camera) {
				const ray = cursor.getRay();
				const [x, y, z] = CFrame.lookAt(Vector3.zero, ray.Direction).ToOrientation();
				world = {
					direction: ray.Direction,
					angle3d: new Vector3(x, y, z),
					position3d: cursor.getPoint().sub(new Vector3(0, GameDefinitions.HEIGHT_OFFSET, 0)),
				};
			}

			return {
				relaPos,
				angle: math.atan2(-(relaPos.Y - 0.5), relaPos.X - 0.5),
				world,
				left: UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton1),
				right: UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton2),
				middle: UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton3),
			};
		}));

		this.event.subscribe(RunService.PostSimulation, () => {
			const frame = shared.get();

			this.output.position.set("vector3", new Vector3(frame.relaPos.X, frame.relaPos.Y, wheel));
			wheel = 0;

			this.output.angle.set("number", frame.angle * unitMul);

			if (frame.world) {
				this.output.direction.set("vector3", frame.world.direction);
				this.output.angle3d.set("vector3", frame.world.angle3d);
				this.output.position3d.set("vector3", frame.world.position3d);
			}
			this.output.leftClick.set("bool", frame.left);
			this.output.rightClick.set("bool", frame.right);
			this.output.middleClick.set("bool", frame.middle);
		});
		this.unsetOutputsOnDisable();
	}
}

export const MouseSensorBlock = {
	...BlockCreation.defaults,
	id: "mousesensor",
	displayName: "Mouse Sensor",
	description: "Returns some data about the mouse cursor",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
