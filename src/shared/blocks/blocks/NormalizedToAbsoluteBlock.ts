import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, BlockCategoryPath, BlockModelSource } from "shared/blocks/Block";

const autoModel = (prefab: BlockCreation.Model.PrefabName, text: string, category: BlockCategoryPath) => {
	return {
		model: BlockCreation.Model.fAutoCreated(prefab, text),
		category: () => category,
	} satisfies BlockModelSource;
};
const definition = {
	input: {
		normalized: {
			displayName: "Normalized Input",
			tooltip: "The normalized value",
			types: {
				vector3: {
					config: new Vector3(),
				},
			},
		},
		offset: {
			displayName: "Normalized Offset",
			tooltip: "Added to the input",
			types: {
				vector3: {
					config: new Vector3(),
				},
			},
		},
		size: {
			displayName: "Size",
			types: {
				vector3: {
					config: Vector3.one,
				},
			},
		},
	},
	outputOrder: ["result", "x", "y", "z"],
	output: {
		result: {
			displayName: "Result Position",
			types: ["vector3"],
		},
		x: {
			displayName: "X component",
			types: ["number"],
		},
		y: {
			displayName: "Y component",
			types: ["number"],
		},
		z: {
			displayName: "Z component",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as PointToScreenSpaceBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		this.onRecalcInputs(({ size, offset, normalized }) => {
			const res = normalized.add(offset).mul(size);
			this.output.result.set("vector3", res);
			this.output.x.set("number", res.X);
			this.output.y.set("number", res.Y);
			this.output.z.set("number", res.Z);
		});
	}
}
export const NormalizedToAbsoluteBlock = {
	...BlockCreation.defaults,
	displayName: "Normalized To Absolute",
	id: "normalizedtoabsolute",
	description: "Converts a given normalized vector into a sized vector with offset. Goes well with a Touchscreen.",
	modelSource: autoModel("DoubleGenericLogicBlockPrefab", "Norm->Abs", BlockCreation.Categories.converterVector),
	search: { aliases: ["crosshair", "ptss"], partialAliases: ["gui"] },
	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
