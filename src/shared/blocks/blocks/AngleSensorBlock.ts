import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {
		result: {
			displayName: "Angle",
			unit: "Radians",
			types: ["vector3"],
		},
		normal: {
			displayName: "Normal",
			unit: "Studs",
			types: ["vector3"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as AngleSensorBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const initialRotation = this.instance.GetPivot().Rotation;

		this.event.subscribe(RunService.PostSimulation, () => {
			const objSpace = initialRotation.ToObjectSpace(this.instance.GetPivot().Rotation);
			const [x, y, z] = objSpace.ToEulerAnglesYXZ();
			const normal = objSpace.LookVector;
			this.output.result.set("vector3", new Vector3(x, y, z));
			this.output.normal.set("vector3", normal);
		});
	}
}

export const AngleSensorBlock = {
	...BlockCreation.defaults,
	id: "anglesensor",
	displayName: "Angle Sensor",
	description: "Returns its angle",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
