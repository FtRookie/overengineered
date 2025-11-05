import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	outputOrder: ["up", "front", "right"],
	input: {},
	output: {
		up: {
			displayName: "Up",
			types: ["vector3"],
		},
		front: {
			displayName: "Front",
			types: ["vector3"],
		},
		right: {
			displayName: "Right",
			types: ["vector3"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as RelativeVectorBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		this.onTicc(() => {
			const pivo = block.instance.GetPivot();
			this.output.up.set("vector3", pivo.UpVector);
			this.output.front.set("vector3", Vector3.zero.sub(pivo.RightVector));
			this.output.right.set("vector3", pivo.LookVector);
		});
	}
}

export const RelativeVectorBlock = {
	...BlockCreation.defaults,
	id: "RelativeVectorblock",
	displayName: "Relative Vector",
	description: "Returns the relative rotation vectors in space",
	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("TripleGenericLogicBlockPrefab", "REL-VEC"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
