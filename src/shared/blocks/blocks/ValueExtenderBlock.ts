import { Strings } from "engine/shared/fixes/String.propmacro";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type {
	BlockLogicArgs,
	BlockLogicFullBothDefinitions,
	BlockLogicTickContext,
	DebugInfo,
} from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["value", "duration", "tickBased"],
	input: {
		value: {
			displayName: "Value",
			types: BlockConfigDefinitions.any,
			group: "0",
			configHidden: true,
		},
		duration: {
			displayName: "Duration",
			types: {
				number: {
					config: 1,
				},
			},
		},
		tickBased: {
			displayName: "Delaying in ticks",
			tooltip: "Controls whether the duration is measued in ticks (true) or seconds (false)",
			types: BlockConfigDefinitions.bool,
			connectorHidden: true,
		},
	},
	output: {
		result: {
			displayName: "Result",
			types: asMap(BlockConfigDefinitions.any).keys(),
			group: "0",
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type Wait = {
	left: number;
	readonly value: BlockLogicTypes.TypeListOfType<typeof definition.input.value.types>;
	readonly valueType: BlockLogicTypes.IdListOfType<typeof definition.input.value.types>;
	readonly tickBased: boolean;
};

export type { Logic as DelayBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	private wait?: Wait;

	constructor(block: BlockLogicArgs) {
		super(definition, block);

		this.on(({ value, valueType, valueChanged, duration, tickBased }) => {
			if (!valueChanged) return;
			if (this.wait) return;

			this.wait = { left: duration, value, valueType, tickBased };
			this.output.result.set(valueType, value);
		});

		this.onTicc(({ dt }) => {
			const wait = this.wait;
			if (!wait) return;

			if (wait.left <= 0) {
				this.wait = undefined;
				this.output.result.unset();
				return;
			}

			if (wait.tickBased) {
				wait.left--;
			} else {
				wait.left -= dt;

				if (wait.left <= 0) {
					this.wait = undefined;
					this.output.result.unset();
				}
			}
		});
	}

	getDebugInfo(ctx: BlockLogicTickContext): readonly DebugInfo[] {
		return [
			//
			...super.getDebugInfo(ctx),
			{ label: "Wait:", type: "", value: `${Strings.pretty(this.wait)}` },
		];
	}
}

export const ValueExtenderBlock = {
	...BlockCreation.defaults,
	id: "valueextender",
	displayName: "Value Extender",
	description: "Sustains values for configured duration when input changes, then returns availater",
	search: {
		partialAliases: ["sustain"],
	},

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("DoubleGenericLogicBlockPrefab", "EXTEND"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
