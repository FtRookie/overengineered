import { t } from "engine/shared/t";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		angle: {
			displayName: "Braces Angle",
			types: {
				number: {
					config: 0 as number,
					clamp: {
						showAsSlider: true,
						min: -180,
						max: 180,
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type Brace = BasePart & {
	readonly WeldConstraint: WeldConstraint;
};
type BracedShaftModel = BlockModel & {
	readonly rot1: Brace;
	readonly rot2: Brace;
	readonly rot3: Brace;
	readonly rot4: Brace;
};

const initEventType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<BracedShaftModel>(),
	angle: t.numberWithBounds(
		definition.input.angle.types.number.clamp.min,
		definition.input.angle.types.number.clamp.max,
	),
});
type InitData = t.Infer<typeof initEventType>;

const init = ({ block, angle }: InitData) => {
	const rotation = CFrame.Angles(math.rad(angle), 0, 0);

	for (const brace of [block.rot1, block.rot2, block.rot3, block.rot4]) {
		const weld = brace.WeldConstraint;
		weld.Enabled = false;
		brace.CFrame = brace.CFrame.mul(rotation);
		weld.Enabled = true;
	}
};

const events = {
	init: new BlockSynchronizer("bracedshaft_init", initEventType, init),
} as const;

export type { Logic as BracedShaftBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, BracedShaftModel> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		this.onkFirstInputs(["angle"], ({ angle }) => events.init.sendOrBurn({ block: this.instance, angle }, this));
	}
}

// What an incredibly useless block.
export const BracedShaftBlock = {
	...BlockCreation.defaults,
	id: "bracedshaft",
	displayName: "Braced Shaft",
	description: "A shaft with adjustable mounting points",

	logic: { definition, ctor: Logic, events },
} as const satisfies BlockBuilder;
