import { RunService } from "@rbxts/services";
import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { RemoteEvents } from "shared/RemoteEvents";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["rotationSpeed", "clutch_release", "max_torque", "cframe"],
	input: {
		rotationSpeed: {
			displayName: "Angular Speed",
			unit: "radians/second",
			types: {
				number: {
					config: 0,
					clamp: {
						showAsSlider: false,
						min: -250,
						max: 250,
					},
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
									speed: 60,
									mode: "stopOnRelease",
								},
							},
							keys: [
								{ key: "R", value: 15 },
								{ key: "F", value: -15 },
							],
						},
					},
				},
			},
		},
		clutch_release: {
			displayName: "Clutch release",
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
		max_torque: {
			displayName: "Max Torque",
			tooltip:
				"The maximum torque that Motor can apply when trying to reach its desired Angular Speed. Does not affect the operation of infinite torque version.",
			unit: "RMU stud²/s²",
			types: {
				number: {
					config: 200,
					clamp: {
						max: 600,
						min: 0,
						step: 0.001,
						showAsSlider: true,
					},
				},
			},
		},
		cframe: {
			displayName: "Infinite torque",
			tooltip: "May break something, use with caution.",
			types: {
				bool: {
					config: false,
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		result: {
			displayName: "Encoder",
			unit: "Radians",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type MotorBlock = BlockModel & {
	readonly Base: Part & {
		readonly HingeConstraint: HingeConstraint;
		readonly Weld: Weld;
	};
	readonly Attach: Part;
};

const updateEventType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<MotorBlock>(),
	rotationSpeed: t.number,
	currentCFrame: t.cframe,
});
type CFrameUpdateData = t.Infer<typeof updateEventType>;

const cframe_update_signals: Map<Weld, RBXScriptConnection> = new Map(); // TODO: possibly fix this shit somehow
const cframe_update = ({ block, rotationSpeed, currentCFrame }: CFrameUpdateData) => {
	if (!block.Base.Weld.Enabled) {
		block.Base.Weld.Enabled = true;

		const blockScale = BlockManager.manager.scale.get(block) ?? Vector3.one;
		const rotationWeld = block.Base.Weld;

		rotationWeld.Enabled = true;
		block.Base.HingeConstraint.Enabled = false;

		rotationWeld.C1 = new CFrame(
			new Vector3(-(block.Base.CFrame.ToObjectSpace(block.Attach.CFrame).Position.X * blockScale.Y), 0, 0),
		);
	}

	const weld = block.Base.Weld;
	weld.C0 = currentCFrame;
	cframe_update_signals.get(weld)?.Disconnect();
	cframe_update_signals.delete(weld);

	if (rotationSpeed !== 0) {
		cframe_update_signals.set(
			weld,
			RunService.PostSimulation.Connect((deltaTime) => {
				if (!weld) {
					cframe_update_signals.get(weld)?.Disconnect();
					cframe_update_signals.delete(weld);
				}

				weld.C0 = weld.C0.mul(CFrame.Angles(-rotationSpeed * deltaTime, 0, 0));
			}),
		);
	}
};

const events = {
	cframe_update: new BlockSynchronizer("motor_cframe_update", updateEventType, cframe_update),
} as const;

export type { Logic as MotorBlockLogic };
export class Logic extends InstanceBlockLogic<typeof definition, MotorBlock> {
	private readonly hingeConstraint;
	private readonly rotationWeld;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		this.hingeConstraint = this.instance.Base.HingeConstraint;
		this.rotationWeld = this.instance.Base.Weld;

		const blockScale = BlockManager.manager.scale.get(this.instance) ?? Vector3.one;
		const scale = blockScale.X * blockScale.Y * blockScale.Z;

		this.onk(["rotationSpeed"], ({ rotationSpeed }) => {
			if (this.rotationWeld.Enabled) {
				events.cframe_update.send({
					rotationSpeed,
					currentCFrame: this.rotationWeld.C0,
					block: this.instance,
				} as CFrameUpdateData);
			} else {
				this.hingeConstraint.AngularVelocity = rotationSpeed;
			}
		});

		this.onk(["max_torque"], ({ max_torque }) => {
			if (this.rotationWeld.Enabled) {
				return;
			}

			this.hingeConstraint.MotorMaxTorque = max_torque * 1_000_000 * math.max(1, scale);
		});

		let infiniteTorque = false;

		// the weld carries the commanded rotation outright, so read it back; the hinge is physics-driven
		// and can stall or lag, so it has to be measured
		this.onTicc(() => {
			this.output.result.set(
				"number",
				infiniteTorque
					? -this.rotationWeld.C0.ToEulerAnglesXYZ()[0]
					: math.rad(this.hingeConstraint.CurrentAngle),
			);
		});

		this.onk(["cframe"], ({ cframe }) => {
			infiniteTorque = cframe;

			if (cframe) {
				events.cframe_update.send({
					rotationSpeed: 0,
					currentCFrame: this.rotationWeld.C0,
					block: this.instance,
				} as CFrameUpdateData);
			}

			// Security check to prevent issues
			if (!cframe) {
				const base = this.instance.FindFirstChild("Base") as BasePart | undefined;
				const attach = this.instance.FindFirstChild("Attach") as BasePart | undefined;
				this.onTicc(() => {
					if (!attach || !base || attach.Parent === undefined || base.Parent === undefined) {
						this.disableAndBurn();
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

			this.hingeConstraint.ActuatorType = Enum.ActuatorType[clutch_release ? "None" : "Motor"];
		});

		this.onDisable(() => {
			if (this.instance.FindFirstChild("Base")?.FindFirstChild("HingeConstraint")) {
				this.hingeConstraint.AngularVelocity = 0;
			}
		});
	}
}

export const MotorBlock = {
	...BlockCreation.defaults,
	id: "motorblock",
	displayName: "Motor",
	description: "Rotates attached blocks. For unpowered rotation, use the Hinge block.",

	logic: { definition, ctor: Logic, events },
} as const satisfies BlockBuilder;
