import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { AllInputKeysToObject, BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["target", "p", "i", "d", "now", "imin", "imax"],
	input: {
		target: {
			displayName: "Target value",
			types: {
				number: {
					config: 0,
				},
				vector3: {
					config: Vector3.zero,
				},
			},
			group: "1",
		},
		p: {
			displayName: "Proportional",
			tooltip: "Direct response",
			types: {
				number: {
					config: 0,
				},
				vector3: {
					config: Vector3.zero,
				},
			},
			group: "1",
		},
		i: {
			displayName: "Integral",
			tooltip: "Change over time / drift",
			types: {
				number: {
					config: 0,
				},
				vector3: {
					config: Vector3.zero,
				},
			},
			group: "1",
		},
		d: {
			displayName: "Derivative",
			tooltip: "Prevent overshoot",
			types: {
				number: {
					config: 0,
				},
				vector3: {
					config: Vector3.zero,
				},
			},
			group: "1",
		},
		now: {
			displayName: "Current Value",
			types: {
				number: {
					config: 0,
				},
				vector3: {
					config: Vector3.zero,
				},
			},
			group: "1",
		},
		imin: {
			displayName: "Min Integral border",
			types: {
				number: {
					config: 0,
				},
				vector3: {
					config: Vector3.zero,
				},
			},
			group: "1",
			connectorHidden: true,
		},
		imax: {
			displayName: "Max Integral border",
			types: {
				number: {
					config: 0,
				},
				vector3: {
					config: Vector3.zero,
				},
			},
			group: "1",
			connectorHidden: true,
		},
	},
	output: {
		output: {
			displayName: "Output",
			types: ["number", "vector3"],
			group: "1",
		},
		integral: {
			displayName: "integral",
			types: ["number", "vector3"],
			group: "1",
		},
	},
} satisfies BlockLogicFullBothDefinitions;

const toVector = (v: number | Vector3): Vector3 => (typeIs(v, "Vector3") ? v : new Vector3(v, v, v));
const toNumber = (v: number | Vector3): number => (typeIs(v, "Vector3") ? v.X : v);

export type { Logic as PIDControllerBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		let inputValues: AllInputKeysToObject<(typeof definition)["input"]> | undefined;

		this.on((data) => (inputValues = data));

		let [errorPrev, errorPrevV] = [0, Vector3.zero];
		let [integral, integralV] = [0, Vector3.zero];

		this.onTicc(({ dt }) => {
			if (dt === 0 || inputValues === undefined) return;
			const { target, now, p, i, d, imin, imax } = inputValues;

			// the wire group forces all inputs to one type, so branching on target covers them all
			if (typeIs(target, "Vector3")) {
				const errorCost = target.sub(toVector(now));
				// clamp integral, since the error during the delay will accumulate infinitely
				integralV = integralV.add(errorCost.mul(dt)).Max(toVector(imin)).Min(toVector(imax));
				const derivative = errorCost.sub(errorPrevV).div(dt);
				const output = toVector(p)
					.mul(errorCost)
					.add(toVector(i).mul(integralV))
					.add(toVector(d).mul(derivative));

				errorPrevV = errorCost;

				this.output.integral.set("vector3", integralV);
				this.output.output.set("vector3", output);
				return;
			}

			const errorCost = toNumber(target) - toNumber(now);
			// clamp integral, since the error during the delay will accumulate infinitely
			integral = math.clamp(integral + errorCost * dt, toNumber(imin), toNumber(imax));
			const derivative = (errorCost - errorPrev) / dt;
			const output = toNumber(p) * errorCost + toNumber(i) * integral + toNumber(d) * derivative;

			errorPrev = errorCost;

			this.output.integral.set("number", integral);
			this.output.output.set("number", output);
		});
	}
}

export const PIDControllerBlock = {
	...BlockCreation.defaults,
	id: "pidcontrollerblock",
	displayName: "PID Controller",
	description: "Controller: P/I/D - Proportional-Integral-Derivative",
	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("x4GenericLogicBlockPrefab", "PID"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
