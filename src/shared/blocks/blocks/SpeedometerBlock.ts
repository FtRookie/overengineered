import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		unit: {
			displayName: "Unit",
			types: {
				enum: {
					config: "radian",
					elementOrder: ["radian", "degree", "rpm"],
					elements: {
						radian: { displayName: "Radian/s", tooltip: "The default unit of 180°/π per second" },
						degree: { displayName: "Degree/s", tooltip: "Degrees per second" },
						rpm: { displayName: "RPM", tooltip: "Rotations per minute" },
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		linear: {
			displayName: "Linear Velocity",
			types: ["vector3"],
		},
		angular: {
			displayName: "Angular Velocity",
			types: ["vector3"],
		},
		linearAcceleration: {
			displayName: "Linear Acceleration",
			types: ["vector3"],
		},
		angularAcceleration: {
			displayName: "Angular Acceleration",
			types: ["vector3"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as SpeedometerBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const getLocalPos = (pos: Vector3) => this.instance.GetPivot().Rotation.ToObjectSpace(new CFrame(pos)).Position;

		// unit is config-only, so resolve the multiplier once instead of re-reading it every tick
		let unitMul = GameDefinitions.RADIANS_TO.radian;
		this.onkFirstInputs(["unit"], ({ unit }) => (unitMul = GameDefinitions.RADIANS_TO[unit as "radian"]));
		const applyUnit = (v: number) => v * unitMul;

		const localVelocity = {
			linear: Vector3.zero,
			angular: Vector3.zero,
		};

		this.event.subscribe(RunService.PostSimulation, () => {
			const primaryPart = this.instance.PrimaryPart;
			if (!primaryPart) {
				this.disable();
				return;
			}

			const l1 = getLocalPos(primaryPart.AssemblyLinearVelocity);
			const l2 = getLocalPos(primaryPart.AssemblyAngularVelocity);

			this.output.linearAcceleration.set("vector3", l1.sub(localVelocity.linear));
			this.output.angularAcceleration.set("vector3", l2.sub(localVelocity.angular).apply(applyUnit));

			this.output.linear.set("vector3", (localVelocity.linear = l1));
			this.output.angular.set("vector3", (localVelocity.angular = l2.apply(applyUnit)));
		});
	}
}

export const SpeedometerBlock = {
	...BlockCreation.defaults,
	id: "speedometer",
	displayName: "Speedometer",
	description:
		"Returns the current velocity and acceleration. Yes I know, there should've been a separate accelerometer block. It was.",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
