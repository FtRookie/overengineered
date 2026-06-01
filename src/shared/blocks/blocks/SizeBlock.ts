import { Instances } from "engine/shared/fixes/Instances";
import { Strings } from "engine/shared/fixes/String.propmacro";
import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["unit", "display"],
	input: {
		unit: {
			displayName: "Unit",
			types: {
				enum: {
					config: "studs",
					elementOrder: ["studs", "blocks", "meters", "feet"],
					elements: {
						studs: {
							displayName: "Studs",
							tooltip: "Units are in studs, the default roblox unit, and grid step.",
						},
						blocks: { displayName: "Blocks", tooltip: "Units are in blocks, 2 studs per block" },
						meters: {
							displayName: "Meters",
							tooltip: `The standard metric unit of length, 1 stud is ${GameDefinitions.STUDS_TO_METERS} meters`,
						},
						feet: { displayName: "Feet", tooltip: "WHAT IS A KILOMETER?" },
					},
				},
			},
			connectorHidden: true,
		},
		display: {
			displayName: "Model",
			types: {
				enum: {
					config: "banana",
					elementOrder: ["banana", "pickle"],
					elements: {
						banana: { displayName: "Banana", tooltip: "Banana for scale" },
						pickle: { displayName: "Pickle", tooltip: "Pickle for scale" },
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type SizeBlockModel = BlockModel & {
	Part: BasePart & {
		Front: SurfaceGui;
		Back: SurfaceGui;
		Left: SurfaceGui;
		Right: SurfaceGui;
		Top: SurfaceGui;
		Bottom: SurfaceGui;
	};
	Banana: MeshPart;
	Pickle: MeshPart;
};

const updateType = t.intersection(
	t.interface({
		block: t.instance("Model").as<SizeBlockModel>(),
		ratio: t.number,
	}),
	t.partial({ display: t.string }),
);
type updateType = t.Infer<typeof updateType>;

const update = ({ block, ratio, display }: updateType) => {
	const setText = (s: SurfaceGui, x: number, y: number) => {
		const out = `${Strings.prettyNumber(x, 0.001)} x ${Strings.prettyNumber(y, 0.001)}`;
		s.FindFirstChildOfClass("TextLabel")!.Text = out;
	};
	const blockScale = BlockManager.manager.scale.get(block)?.mul(ratio) ?? Vector3.one;
	const part = block.Part;
	if (!part) return;
	setText(part.Front, blockScale.X, blockScale.Y);
	setText(part.Back, blockScale.X, blockScale.Y);
	setText(part.Left, blockScale.Z, blockScale.Y);
	setText(part.Right, blockScale.Z, blockScale.Y);
	setText(part.Top, blockScale.Z, blockScale.X);
	setText(part.Bottom, blockScale.Z, blockScale.X);
	if (!display) return;
	block.Banana.Transparency = display === "banana" ? 0 : 1;
	block.Pickle.Transparency = display === "pickle" ? 0 : 1;
};

const events = {
	update: new BlockSynchronizer("sb_update", updateType, update),
};

export type { Logic as SizeBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, SizeBlockModel> {
	static readonly unitRatios: Record<string, number> = {
		studs: 2,
		blocks: 1,
		meters: 0.56,
		feet: 0.56 / 0.3048,
	};
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const displayCache = this.initializeInputCache("display");

		this.on(({ unit }) => {
			const ratio = Logic.unitRatios[unit];
			events.update.send({ block: this.instance, ratio, display: displayCache.tryGet() });
		});
	}
}

const immediate = BlockCreation.immediate(definition, (block: SizeBlockModel, config) => {
	Instances.waitForChild(block, "Part");
	const ratio =
		Logic.unitRatios[BlockCreation.defaultIfWiredUnset(config?.unit, definition.input.unit.types.enum.config)];
	const display = BlockCreation.defaultIfWiredUnset(config?.display, definition.input.display.types.enum.config);
	events.update.send({ block, ratio, display });
});

export const SizeBlock = {
	...BlockCreation.defaults,
	id: "sizeblock",
	displayName: "Size Block",
	description: "Banana for scale.",
	search: {
		partialAliases: [
			"ruler",
			"length",
			"width",
			"height",
			"measure",
			"banana",
			"🍌",
			"🥒",
			"pickle",
			"meter",
			"feet",
			"foot",
			"stud",
		],
	},

	logic: { definition, ctor: Logic, events, immediate },
} as const satisfies BlockBuilder;
