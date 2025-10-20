import { TweenService } from "@rbxts/services";
import { t } from "engine/shared/t";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { RemoteEvents } from "shared/RemoteEvents";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults } from "shared/blocks/Block";

const servoDefinition = {
	inputOrder: ["speed", "angle", "stiffness", "clutch_release", "max_torque", "cframe"],
	input: {
		speed: {
			displayName: "Angular Speed",
			tooltip:
				"Specifies the speed of the servo motor in radians per second. It feels different when working with the infinite torque version.",
			unit: "radians/second",
			types: {
				number: {
					config: 15,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 50,
						step: 0.01,
					},
				},
			},
		},
		angle: {
			displayName: "Target Angle",
			unit: "Degrees",
			types: {
				number: {
					config: 0,
					// clamp: {
					// 	showAsSlider: false,
					// 	min: -180,
					// 	max: 180,
					// },
					control: {
						config: {
							enabled: true,
							startValue: 0,
							mode: {
								type: "instant",
								instant: {
									mode: "onRelease",
								},
								smooth: {
									speed: 72,
									mode: "stopOnRelease",
								},
							},
							keys: [
								{ key: "R", value: 45 },
								{ key: "F", value: -45 },
							],
						},
					},
				},
			},
		},
		clutch_release: {
			displayName: "Clutch release",
			tooltip: "Allows you to disable the speed controller. Not compatible with infinite torque version.",
			types: {
				bool: {
					config: false,
					control: {
						config: {
							enabled: false,
							key: "Y",
							switch: false,
							reversed: false,
						},
						canBeSwitch: true,
						canBeReversed: true,
					},
				},
			},
		},
		cframe: {
			displayName: "Infinite torque",
			tooltip: "Not compatible with aircraft control surfaces when using realistic aerodynamics.",
			types: {
				bool: {
					config: false,
				},
			},
			connectorHidden: true,
		},
		stiffness: {
			displayName: "Responsiveness",
			tooltip:
				"Specifies the sharpness of the servo motor in reaching the Target Angle. Does not affect the operation of infinite torque version.",
			types: {
				number: {
					config: 45,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 100,
						step: 0.01,
					},
				},
			},
			connectorHidden: true,
		},
		max_torque: {
			displayName: "Max Torque",
			tooltip:
				"Specifies the maximum torque of the servo motor. Does not affect the operation of infinite torque version.",
			types: {
				number: {
					config: 200,
					clamp: {
						showAsSlider: true,
						max: 600,
						min: 0,
						step: 0.1,
					},
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;
const sidewaysServoDefinition = {
	...servoDefinition,
	input: {
		...servoDefinition.input,
		angle: {
			...servoDefinition.input.angle,
			types: {
				...servoDefinition.input.angle.types,
				number: {
					...servoDefinition.input.angle.types.number,
					// clamp: {
					// 	...servoDefinition.input.angle.types.number.clamp,
					// 	min: -90,
					// 	max: 90,
					// },
				},
			},
		},
	},
} as const satisfies BlockLogicFullBothDefinitions;

type ServoMotorModel = BlockModel & {
	readonly Base: Part & {
		readonly HingeConstraint: HingeConstraint;
		readonly Weld: Weld;
	};
	readonly Attach: Part;
};

const updateEventType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<ServoMotorModel>(),
	angle: t.number,
	currentCFrame: t.cframe,
	speed: t.number,
});
type CFrameUpdateData = t.Infer<typeof updateEventType>;

const cframe_update = ({ block, angle, currentCFrame, speed }: CFrameUpdateData) => {
	if (!block.Base.Weld.Enabled) {
		block.Base.Weld.Enabled = true;

		const blockScale = BlockManager.manager.scale.get(block) ?? Vector3.one;
		const rotationWeld = block.Base.Weld;

		rotationWeld.Enabled = true;
		block.Base.HingeConstraint.Enabled = false;

		rotationWeld.C1 = new CFrame(
			new Vector3(
				0,
				-(block.Base.CFrame.ToObjectSpace(block.Attach.CFrame).Position.Y * blockScale.Y),
				rotationWeld.C1.Z * blockScale.X, // Fix for sideways servo
			),
		);
	}

	// Fix angle for sideways servo
	const isSidewaysServo = block.Base.Weld.C1.Z !== 0;
	angle = isSidewaysServo ? -angle : angle;

	// Get current angle from C0 (Y rotation component)
	const [, currentAngleRad] = currentCFrame.ToEulerAnglesYXZ();
	const currentAngle = -math.deg(currentAngleRad);

	// Calculate shortest angular distance
	let angleDiff = angle - currentAngle;
	if (angleDiff > 180) angleDiff -= 360;
	if (angleDiff < -180) angleDiff += 360;

	const absAngleDiff = math.abs(angleDiff);

	// Calculate tween duration based on angular speed
	const angularSpeedDegrees = math.deg(math.clamp(speed, 0, 20));
	const duration = angularSpeedDegrees > 0 ? absAngleDiff / angularSpeedDegrees : 0;

	if (duration > 0.01 && absAngleDiff > 0.1) {
		// Only tween for significant changes
		const targetCFrame = CFrame.Angles(0, -math.rad(angle), 0);
		const tweenInfo = new TweenInfo(duration, Enum.EasingStyle.Linear);

		TweenService.Create(block.Base.Weld, tweenInfo, {
			C0: targetCFrame,
		}).Play();
	} else {
		block.Base.Weld.C0 = CFrame.Angles(0, -math.rad(angle), 0);
	}
};

const events = {
	cframe_update: new BlockSynchronizer("servo_cframe_update", updateEventType, cframe_update),
} as const;

export type { Logic as ServoMotorLogic };
class Logic extends InstanceBlockLogic<typeof servoDefinition, ServoMotorModel> {
	private readonly rotationWeld;
	private readonly hingeConstraint;

	constructor(definition: typeof servoDefinition, block: InstanceBlockLogicArgs) {
		super(definition, block);

		const blockScale = BlockManager.manager.scale.get(this.instance) ?? Vector3.one;
		const scale = blockScale.X * blockScale.Y * blockScale.Z;

		this.hingeConstraint = this.instance.Base.HingeConstraint;
		this.rotationWeld = this.instance.Base.Weld;

		this.instance.GetDescendants().forEach((desc) => {
			if (!desc.IsA("BasePart")) return;

			const materialPhysProp = new PhysicalProperties(desc.Material);
			const newPhysProp = new PhysicalProperties(materialPhysProp.Density, materialPhysProp.Friction, 0);
			desc.CustomPhysicalProperties = newPhysProp;
		});

		this.onk(["cframe"], ({ cframe }) => {
			if (cframe) {
				events.cframe_update.send({
					angle: 0,
					currentCFrame: this.rotationWeld.C0,
					speed: this.hingeConstraint.AngularSpeed,
					block: this.instance,
				} as CFrameUpdateData);
			}

			// Security check to prevent issues
			if (!cframe) {
				this.onTicc(() => {
					const base = this.instance.FindFirstChild("Base") as BasePart | undefined;
					const attach = this.instance.FindFirstChild("Attach") as BasePart | undefined;
					if (!attach || !base) {
						this.disable();
						return;
					}

					if (attach.Position.sub(base.Position).Magnitude > 3 * blockScale.Y) {
						RemoteEvents.ImpactBreak.send([base]);
						this.disable();
					}
				});
			}
		});

		this.onk(["clutch_release"], ({ clutch_release }) => {
			if (this.rotationWeld.Enabled && clutch_release) {
				this.disableAndBurn();
			}

			this.hingeConstraint.ActuatorType = Enum.ActuatorType[clutch_release ? "None" : "Servo"];
		});

		this.onk(["angle"], ({ angle }) => {
			if (this.rotationWeld.Enabled) {
				events.cframe_update.send({
					angle,
					currentCFrame: this.rotationWeld.C0,
					speed: this.hingeConstraint.AngularSpeed,
					block: this.instance,
				} as CFrameUpdateData);
			} else {
				this.hingeConstraint.TargetAngle = angle;
			}
		});

		this.onk(["speed"], ({ speed }) => {
			this.hingeConstraint.AngularSpeed = speed;
		});
		this.onk(["stiffness"], ({ stiffness }) => {
			this.hingeConstraint.AngularResponsiveness = stiffness;
		}); // Unused when using CFrame weld
		this.onk(["max_torque"], ({ max_torque }) => {
			this.hingeConstraint.ServoMaxTorque = max_torque * 1_000_000 * math.max(1, scale);
		}); // Unused when using CFrame weld
	}
}

const list: BlockBuildersWithoutIdAndDefaults = {
	servomotorblock: {
		displayName: "Servo",
		description: "Turns to the configured angle",
		logic: {
			definition: servoDefinition,
			ctor: class extends Logic {
				constructor(block: InstanceBlockLogicArgs) {
					super(servoDefinition, block);
				}
			},
			events,
		},
	},
	sidewaysservo: {
		displayName: "Sideways servo",
		description: "Servo but sideways and with some degree of freedom",
		logic: {
			definition: sidewaysServoDefinition,
			ctor: class extends Logic {
				constructor(block: InstanceBlockLogicArgs) {
					super(sidewaysServoDefinition, block);
				}
			},
		},
	},
};
export const ServoMotorBlocks = BlockCreation.arrayFromObject(list);
