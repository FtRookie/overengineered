import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		value: {
			displayName: "Value",
			types: {
				byte: {
					config: 0,
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

const segmentIds = ["A", "B", "C", "D", "E", "F", "G"] as const;
const segmentLetters: { readonly [k in string]: readonly string[] } = {
	"0": ["A", "B", "C", "D", "E", "F"],
	"1": ["E", "F"],
	"2": ["A", "F", "G", "C", "D"],
	"3": ["A", "G", "D", "E", "F"],
	"4": ["B", "F", "G", "E"],
	"5": ["A", "B", "G", "E", "D"],
	"6": ["A", "B", "G", "E", "D", "C"],
	"7": ["E", "F", "A"],
	"8": ["A", "B", "C", "D", "E", "F", "G"],
	"9": ["A", "B", "D", "E", "F", "G"],
	A: ["A", "B", "C", "E", "F", "G"],
	B: ["B", "C", "D", "E", "G"],
	C: ["A", "B", "C", "D"],
	D: ["C", "D", "E", "F", "G"],
	E: ["A", "B", "C", "D", "G"],
	F: ["A", "B", "C", "G"],
};
const litColor = Color3.fromRGB(150, 150, 150);
const unlitColor = Color3.fromRGB(70, 67, 69);

const updateEventType = t.interface({
	block: t.instance("Model").nominal("blockModel"),
	code: t.numberWithBounds(0, 255, 1),
});
type UpdateData = t.Infer<typeof updateEventType>;

const update = ({ block, code }: UpdateData) => {
	const letters = string.format("%02X", code).split("");

	for (let i = 0; i < 2; i++) {
		const segments = block.FindFirstChild(`Segments${i === 0 ? "L" : "R"}`);
		if (!segments) continue;

		const lit = segmentLetters[letters[i]];
		for (const id of segmentIds) {
			const segment = segments.FindFirstChild(id) as BasePart | undefined;
			if (segment) segment.Color = lit.includes(id) ? litColor : unlitColor;
		}
	}
};

const events = {
	update: new BlockSynchronizer("sevensegmentdisplay_update", updateEventType, update),
} as const;

export type { Logic as SevenSegmentDisplayBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	static readonly events = events;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		this.on(({ value }) => events.update.sendOrBurn({ block: this.instance, code: value }, this));
	}
}

export const SevenSegmentDisplayBlock = {
	...BlockCreation.defaults,
	id: "sevensegmentdisplay",
	displayName: "7-Segment Display",
	description: "Simple 7-Segment display. Opcode viewer? OwO",

	logic: { definition, ctor: Logic, events },
} as const satisfies BlockBuilder;
