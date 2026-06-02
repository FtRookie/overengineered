import { Colors } from "engine/shared/Colors";
import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		transparency: {
			displayName: "Transparency",
			tooltip: "Turns this tint on/off",
			types: {
				number: {
					config: 0,
					clamp: {
						min: 0,
						max: 1,
						showAsSlider: true,
					},
				},
			},
		},
		color: {
			displayName: "Color",
			tooltip: "The color of the light and the block",
			types: {
				color: {
					config: Colors.white,
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type TintBlockModel = BlockModel & {
	Part: BasePart;
};

const update = ({ block, color, transparency }: UpdateData) => {
	const part = block.FindFirstChild("Part") as typeof block.Part;
	if (!part) return;

	block.Part.Color = color ?? Colors.white;
	block.Part.Transparency = transparency;
};

const updateEventType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<TintBlockModel>(),
	transparency: t.numberWithBounds(0, 1),
	color: t.color.orUndefined(),
});
type UpdateData = t.Infer<typeof updateEventType>;

const events = {
	update: new BlockSynchronizer("b_tint_update", updateEventType, update),
} as const;

export type { Logic as TintBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, TintBlockModel> {
	constructor(args: InstanceBlockLogicArgs) {
		super(definition, args);
		this.on(({ transparency, color }) => {
			events.update.sendOrBurn(
				{
					block: this.instance,
					transparency: transparency,
					color: color,
				},
				this,
			);
		});
	}
}

export const TintBlock = {
	...BlockCreation.defaults,
	id: "tintblock",
	displayName: "Tint Block",
	description: "Becomes transparent",
	logic: { definition, ctor: Logic },
	search: { aliases: ["lcd", "opacity", "transparency"] },
} as const satisfies BlockBuilder;
