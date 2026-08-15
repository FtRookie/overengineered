import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockLogicValueResults, isCustomBlockLogicValueResult } from "shared/blockLogic/BlockLogicValueStorage";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type {
	BlockLogicArgs,
	BlockLogicFullBothDefinitions,
	BlockLogicTickContext,
	DebugInfo,
} from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["value", "window", "tickBased"],
	input: {
		value: {
			displayName: "Value",
			types: {
				number: { config: 0 as number },
				vector3: { config: new Vector3(0, 0, 0) },
			},
			group: "0",
			configHidden: true,
		},
		window: {
			displayName: "Window",
			types: {
				number: {
					config: 1,
				},
			},
		},
		tickBased: {
			displayName: "Time in ticks",
			tooltip: "Controls whether the window is measured in ticks (true) or seconds (false)",
			types: BlockConfigDefinitions.bool,
			connectorHidden: true,
		},
	},
	output: {
		result: {
			displayName: "Result",
			types: ["number", "vector3"],
			group: "0",
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as ValueDeltaBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	// Keyed by tick. The window is a live input, so nothing is ever pruned: a window widened mid-ride must still
	// reach a sample an earlier, narrower window would have let us drop.
	private readonly pastValues: { [tick: number]: number | Vector3 } = {};
	private samples = 0;

	constructor(block: BlockLogicArgs) {
		super(definition, block);

		let tickBased = false;
		this.onkFirstInputs(["tickBased"], ({ tickBased: tb }) => (tickBased = tb));

		let firstTick: number | undefined;
		// read raw rather than via initializeInputCache: the cache keeps the last value on a GARBAGE input, hiding it
		this.onTicc((ctx) => {
			const value = this.input.value.get(ctx);
			const window = this.input.window.get(ctx);
			if (isCustomBlockLogicValueResult(value) || isCustomBlockLogicValueResult(window)) {
				// GARBAGE never resolves, so burn: the block stops and its own output goes GARBAGE downstream too
				if (value === BlockLogicValueResults.garbage || window === BlockLogicValueResults.garbage) {
					this.disableAndBurn();
				}
				return;
			}

			const current = value.value;
			this.pastValues[ctx.tick] = current;
			firstTick ??= ctx.tick;
			this.samples++;

			// seconds mode looks back by however many ticks the window spans at the current step
			const back = tickBased ? math.floor(window.value) : math.round(window.value / ctx.dt);
			// a window reaching past the oldest sample clamps to it: the delta covers all history so far and keeps
			// growing toward the full window as more ticks accumulate
			const past = this.pastValues[math.max(ctx.tick - back, firstTick)];
			if (past === undefined) {
				this.output.result.unset();
				return;
			}

			if (typeIs(past, "Vector3")) {
				this.output.result.set("vector3", (current as Vector3).sub(past));
			} else {
				this.output.result.set("number", (current as number) - past);
			}
		});
	}

	getDebugInfo(ctx: BlockLogicTickContext): readonly DebugInfo[] {
		return [
			//
			...super.getDebugInfo(ctx),
			{ kind: "info", label: "Samples:", type: "", value: `${this.samples}` },
		];
	}
}

export const ValueDeltaBlock = {
	...BlockCreation.defaults,
	id: "valuedelta",
	displayName: "Value Delta",
	description: "Measures change of inputs in the given time frame",
	search: {
		partialAliases: ["change"],
	},

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("DoubleGenericLogicBlockPrefab", "DELTA"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
