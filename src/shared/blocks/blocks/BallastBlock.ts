import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import type { BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		density: {
			displayName: "Density",
			tooltip:
				"Amount of mass per unit volume. The more dense a part is, the more force it takes to accelerate it.",
			unit: "m/V",
			types: {
				number: {
					config: 0,
					clamp: {
						showAsSlider: false,
						min: 0.15,
						max: 10,
					},
					control: {
						config: {
							enabled: true,
							startValue: 0,
							mode: {
								type: "smooth",
								instant: {
									mode: "onRelease",
								},
								smooth: {
									speed: 2,
									mode: "stopOnRelease",
								},
							},
							keys: [
								{ key: "R", value: 10 },
								{ key: "F", value: 0.15 },
							],
						},
					},
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type BallastModel = BlockModel & {
	readonly Part: Part;
};

export type { Logic as BallastBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, BallastModel> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const blockScale = BlockManager.manager.scale.get(this.instance) ?? Vector3.one;
		const scale = blockScale.X * blockScale.Y * blockScale.Z;

		this.on(({ density }) => {
			const currentPhysProp = this.instance.Part.CurrentPhysicalProperties;
			const materialPhysProp = new PhysicalProperties(this.instance.Part.Material);
			const physProp = new PhysicalProperties(
				materialPhysProp.Density + density * scale,
				currentPhysProp.Friction,
				currentPhysProp.Elasticity,
				currentPhysProp.FrictionWeight,
				currentPhysProp.ElasticityWeight,
			);
			this.instance.Part.CustomPhysicalProperties = physProp;
		});
	}
}

export const BallastBlock = {
	...BlockCreation.defaults,
	id: "ballast",
	displayName: "Ballast",
	description: "(Un)managable weight of existence. Now in compact form!",

	logic: { definition, ctor: Logic },
	search: { partialAliases: ["weight"] },
} as const satisfies BlockBuilder;
