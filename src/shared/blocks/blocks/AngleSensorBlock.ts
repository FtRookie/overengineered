import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import type { RadialUnit } from "shared/data/GameDefinitions";

const definition = {
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
		const unitCache = this.initializeInputCache("unit");

		this.event.subscribe(RunService.PostSimulation, () => {
			const unit = unitCache.get() as RadialUnit;
			if (!unit) return;
			const objSpace = initialRotation.ToObjectSpace(this.instance.GetPivot().Rotation);
			const [x, y, z] = objSpace.ToEulerAnglesYXZ();
			const normal = this.instance.GetPivot().LookVector.mul(-1);
			const result = new Vector3(x, y, z);
			this.output.result.set(
				"vector3",
				result.apply((v) => v * GameDefinitions.RADIANS_TO[unit as "rpm"]),
			);
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
