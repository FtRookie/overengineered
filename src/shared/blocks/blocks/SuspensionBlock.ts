import { Instances } from "engine/shared/fixes/Instances";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["damping", "stiffness", "free_length", "max_force", "constraint"],
	input: {
		damping: {
			displayName: "Damping",
			types: {
				number: {
					config: 250,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 100_000,
						step: 0.01,
					},
				},
			},
			connectorHidden: true,
		},
		stiffness: {
			displayName: "Stiffness",
			types: {
				number: {
					config: 7_500,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 100_000,
						step: 0.01,
					},
				},
			},
			connectorHidden: true,
		},
		free_length: {
			displayName: "Free Length",
			types: {
				number: {
					config: 2,
					clamp: {
						showAsSlider: true,
						min: 0.1,
						max: 10,
						step: 0.01,
					},
				},
			},
		},
		max_force: {
			displayName: "Force",
			types: {
				number: {
					config: 25_000,
					clamp: {
						showAsSlider: true,
						min: 1,
						max: 800000,
					},
				},
			},
		},
		constraint: {
			displayName: "Constraint",
			types: {
				enum: {
					config: "linear",
					elementOrder: ["linear", "flexible"],
					elements: {
						linear: { displayName: "Linear", tooltip: "Can only along the Y-axis" },
						flexible: { displayName: "Flexible", tooltip: "Can bend in any direction" },
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type SuspensionModel = BlockModel & {
	readonly SpringSide: BasePart & {
		readonly SpringConstraint: SpringConstraint;
		readonly PrismaticConstraint: PrismaticConstraint;
	};
};

export type { Logic as SuspensionBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, SuspensionModel> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const springSide = this.instance.SpringSide;
		if (!springSide) return;
		const spring = springSide.SpringConstraint;

		const blockScale = BlockManager.manager.scale.get(block.instance) ?? Vector3.one;
		const scale = math.max(blockScale.X * blockScale.Y * blockScale.Z, 1);

		spring.Radius *= blockScale.findMin();
		spring.Thickness *= blockScale.findMin();

		const setSpringParameters = ({
			max_force,
			damping,
			stiffness,
			free_length,
			constraint,
		}: {
			max_force: number;
			damping: number;
			stiffness: number;
			free_length: number;
			constraint: string;
		}) => {
			if (!spring) return;
			const len = free_length * blockScale.Y;
			spring.MaxForce = max_force * scale;
			spring.Damping = damping * scale;
			spring.Stiffness = stiffness * scale;
			spring.FreeLength = len;
			spring.MaxLength = len * 2;
			spring.MinLength = 0.1;
			springSide.PrismaticConstraint.Enabled = constraint === "linear";
		};

		this.onkFirstInputs(["damping", "free_length", "max_force", "stiffness", "constraint"], setSpringParameters);
		this.on(setSpringParameters);
	}
}

const immediate = BlockCreation.immediate(definition, (block: SuspensionModel) => {
	Instances.waitForChild(block, "SpringSide", "SpringConstraint");
	const blockScale = BlockManager.manager.scale.get(block) ?? Vector3.one;
	block.SpringSide.SpringConstraint.Radius = math.min(blockScale.X, blockScale.Z) * 0.6;
});

export const SuspensionBlock = {
	...BlockCreation.defaults,
	id: "suspensionblock",
	displayName: "Suspension",
	description: "Sus pension spring",

	search: {
		aliases: ["sus", "spring"],
		partialAliases: ["coil"],
	},

	logic: { definition, ctor: Logic, immediate },
} as const satisfies BlockBuilder;
