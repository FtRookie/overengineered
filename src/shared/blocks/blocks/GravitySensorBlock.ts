import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { Physics } from "shared/Physics";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {
		result: {
			displayName: "Acceleration (stud/s²)",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as GravitySensorBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs, @tryInject playerData?: PlayerDataStorage) {
		super(definition, block);

		this.event.subscribe(RunService.PostSimulation, () => {
			this.output.result.set(
				"number",
				Physics.GetGravityOnHeight(
					Physics.LocalHeight.fromGlobal(this.instance.GetPivot().Y),
					playerData?.config.get().environment.physics.customGravity,
				),
			);
		});
	}
}

export const GravitySensorBlock = {
	...BlockCreation.defaults,
	id: "gravitysensor",
	displayName: "Gravity Sensor",
	description: "Returns the current gravity acceleration in stud/s²",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
