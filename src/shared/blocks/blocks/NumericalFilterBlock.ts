import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { AllInputKeysToObject, BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["value", "tau", "mode"],
	input: {
		value: {
			displayName: "Value",
			types: {
				number: { config: 0 },
				vector3: { config: Vector3.zero },
			},
			group: "1",
		},
		tau: {
			displayName: "Time Constant",
			tooltip: "How aggressively to smooth values, 0 = no filter",
			unit: "Seconds",
			types: {
				number: {
					config: 0.1,
					clamp: { showAsSlider: false, min: 0, max: 60 },
				},
			},
		},
		mode: {
			displayName: "Mode",
			types: {
				enum: {
					config: "low",
					elementOrder: ["low", "high"],
					elements: {
						low: {
							displayName: "Low Pass",
							tooltip: "Removes jitter and rapid changes, but is not an average",
						},
						high: {
							displayName: "High Pass",
							tooltip: "Keeps the change, drops the steady values",
						},
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		result: {
			displayName: "Result",
			types: ["number", "vector3"],
			group: "1",
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type Axis = "X" | "Y" | "Z";
const componentOf = (v: number | Vector3, axis: Axis): number => (typeIs(v, "Vector3") ? v[axis] : v);

export type { Logic as NumericalFilterBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		let inputValues: AllInputKeysToObject<(typeof definition)["input"]> | undefined;
		this.on((data) => (inputValues = data));

		// Unset until a first sample arrives, so the filter starts from the signal rather than sliding up
		// out of a stored zero.
		const state = {
			X: { in: undefined as number | undefined, out: 0 },
			Y: { in: undefined as number | undefined, out: 0 },
			Z: { in: undefined as number | undefined, out: 0 },
		};

		let dtNow = 0;
		let highNow = false;

		const stepAxis = (_: number, axis: Axis): number => {
			const values = inputValues!;
			const s = state[axis];
			const input = componentOf(values.value, axis);

			if (s.in === undefined) {
				s.in = input;
				s.out = highNow ? 0 : input;
				return s.out;
			}

			// Both weights are built from the ratio of the step to the time constant, so a given tau behaves
			// the same however fast the game runs — a fixed per-tick weight would not.
			const tau = values.tau;
			const out = highNow
				? (tau / (tau + dtNow)) * (s.out + input - s.in)
				: s.out + (dtNow / (tau + dtNow)) * (input - s.out);

			s.in = input;
			s.out = out;
			return out;
		};

		this.onTicc(({ dt }) => {
			if (dt === 0 || inputValues === undefined) return;

			dtNow = dt;
			highNow = inputValues.mode === "high";

			if (typeIs(inputValues.value, "Vector3")) {
				this.output.result.set("vector3", inputValues.value.apply(stepAxis));
				return;
			}

			this.output.result.set("number", stepAxis(0, "X"));
		});
	}
}

export const NumericalFilterBlock = {
	...BlockCreation.defaults,
	id: "numericalfilter",
	displayName: "Numerical Filter",
	description: "Low or high pass filter, smooths a noisy signal or isolates its movement",
	search: { partialAliases: ["filter", "low", "high", "smooth", "noise"] },

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("DoubleGenericLogicBlockPrefab", "FILTER"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
