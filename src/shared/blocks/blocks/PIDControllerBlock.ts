import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { AllInputKeysToObject, BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["target", "p", "i", "d", "now", "imin", "imax", "behaviour"],
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
		behaviour: {
			displayName: "Integral Behaviour",
			types: {
				enum: {
					config: "new",
					elementOrder: ["new", "legacy"],
					elements: {
						new: {
							displayName: "New",
							tooltip: "Integral banks at the gain of the moment, derivative reads the measurement",
						},
						legacy: {
							displayName: "Legacy",
							tooltip: "Integral banks raw error, derivative reads error and jumps on a new target",
						},
					},
				},
			},
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

type Axis = "X" | "Y" | "Z";
/** A scalar answers for every axis, which is how one gain still covers a vector target. */
const componentOf = (v: number | Vector3, axis: Axis): number => (typeIs(v, "Vector3") ? v[axis] : v);

export type { Logic as PIDControllerBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		let inputValues: AllInputKeysToObject<(typeof definition)["input"]> | undefined;

		this.on((data) => (inputValues = data));

		// One controller per axis. `nowPrev` is unset until a second reading exists — a stored zero would
		// read as a real measurement and kick exactly as hard as the setpoint step it avoids.
		const state = {
			X: { errorPrev: 0, integral: 0, nowPrev: undefined as number | undefined },
			Y: { errorPrev: 0, integral: 0, nowPrev: undefined as number | undefined },
			Z: { errorPrev: 0, integral: 0, nowPrev: undefined as number | undefined },
		};

		// Held here rather than passed, so the step below can be built once instead of per tick.
		let dtNow = 0;
		let legacyNow = false;

		const stepAxis = (_: number, axis: Axis): number => {
			const values = inputValues!;
			const s = state[axis];

			const now = componentOf(values.now, axis);
			const errorCost = componentOf(values.target, axis) - now;
			const i = componentOf(values.i, axis);

			const banked = legacyNow ? errorCost * dtNow : i * errorCost * dtNow;
			s.integral = math.clamp(
				s.integral + banked,
				componentOf(values.imin, axis),
				componentOf(values.imax, axis),
			);

			// d(SP)/dt is taken as 0, which leaves -d(PV)/dt — hence the reversed subtraction. A raw
			// difference over a frame carries whatever noise the measurement has; smoothing it is a
			// filter's job upstream, not a controller's.
			const derivative = legacyNow
				? (errorCost - s.errorPrev) / dtNow
				: s.nowPrev !== undefined
					? (s.nowPrev - now) / dtNow
					: 0;

			s.errorPrev = errorCost;
			s.nowPrev = now;

			// P takes the whole error, so a stepped target moves the output by p·Δtarget in one frame.
			// Setpoint weighting would soften that, at the cost of a gain this block does not expose.
			const term = legacyNow ? i * s.integral : s.integral;
			return componentOf(values.p, axis) * errorCost + term + componentOf(values.d, axis) * derivative;
		};

		this.onTicc(({ dt }) => {
			if (dt === 0 || inputValues === undefined) return;

			dtNow = dt;
			legacyNow = inputValues.behaviour === "legacy";

			if (typeIs(inputValues.target, "Vector3")) {
				const output = inputValues.target.apply(stepAxis);

				this.output.integral.set("vector3", new Vector3(state.X.integral, state.Y.integral, state.Z.integral));
				this.output.output.set("vector3", output);
				return;
			}

			const output = stepAxis(0, "X");

			this.output.integral.set("number", state.X.integral);
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
