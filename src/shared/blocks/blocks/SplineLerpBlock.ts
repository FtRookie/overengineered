import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["a", "b", "c", "offset"],
	outputOrder: ["output"],
	input: {
		a: {
			displayName: "A",
			types: {
				vector3: {
					config: new Vector3(0, 0, 0),
				},
			},
		},
		b: {
			displayName: "B",
			types: {
				vector3: {
					config: new Vector3(0, 0, 0),
				},
			},
		},
		c: {
			displayName: "C",
			types: {
				vector3: {
					config: new Vector3(0, 0, 0),
				},
			},
		},
		offset: {
			displayName: "Offset",
			types: {
				number: {
					config: 0,
				},
			},
		},
	},
	output: {
		output: {
			displayName: "Output",
			types: ["vector3"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as SplineLerpBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		let inputValues = {
			a: new Vector3(0, 0, 0),
			b: new Vector3(0, 0, 0),
			c: new Vector3(0, 0, 0),
			offset: 0,
		};

		this.on((data) => (inputValues = data));

		this.onTicc(() => {
			const AB = inputValues.b.sub(inputValues.a);
			const AC = inputValues.c.sub(inputValues.a);
			const n = AB.Cross(AC);
			const nLen2 = n.Dot(n);

			// A -> B, if zero - take A -> C
			const linearFallback = () => {
				let dir = AB;
				if (dir.Magnitude === 0) dir = AC;
				if (dir.Magnitude === 0) {
					// все точки совпали - просто вернуть A
					this.output.output.set("vector3", inputValues.a);
					return;
				}
				const p = inputValues.a.add(dir.Unit.mul(inputValues.offset));
				this.output.output.set("vector3", p);
			};

			// If the points are collinear, we use linear mode.
			if (nLen2 === 0) {
				linearFallback();
				return;
			}

			// Careful, this guy uses some fancy words vvvvvvvvvvvvvvvvvvvvvv
			// (actually had that math in the 7th/8th grade)
			// - @samlovebutter

			// orthonormal bases
			const e1 = AB.Unit; // along AB
			const e3 = n.Unit; // plane normal
			const e2 = e3.Cross(e1); // perpendicular in the plane

			// Coordinates e1 and e2 in the basis relative to A
			const xB = AB.Dot(e1);
			const yB = AB.Dot(e2);
			const xC = AC.Dot(e1);
			const yC = AC.Dot(e2);

			// here the circumcenter is calculated in 2D (the formula is based on the intersection of crescent perpendiculars). I chose the formula using the determinant
			const D = 2 * (xB * yC - yB * xC);
			if (D === 0) {
				// if not found, then we go to linear
				linearFallback();
				return;
			}

			const xB2yB2 = xB * xB + yB * yB;
			const xC2yC2 = xC * xC + yC * yC;

			const ux = (yC * xB2yB2 - yB * xC2yC2) / D;
			const uy = (xB * xC2yC2 - xC * xB2yB2) / D;

			// back to 3D
			const O = inputValues.a.add(e1.mul(ux)).add(e2.mul(uy));

			// now knowing the center of the circle you can build a lerp
			const rVec2 = inputValues.a.sub(O);
			const r = rVec2.Magnitude;
			if (r === 0) {
				// And if it coincides with the center, there's nothing to rotate.
				this.output.output.set("vector3", O);
				return;
			}

			// Plane Normal
			let axis = rVec2.Cross(inputValues.b.sub(O));
			let axisMag = axis.Magnitude;
			if (axisMag === 0) {
				// In case A, B lie on the same radial line, we choose an arbitrary axis perpendicular to rVec2
				let tmp = math.abs(rVec2.X) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
				axis = rVec2.Cross(tmp);
				axisMag = axis.Magnitude;
				if (axisMag === 0) {
					tmp = new Vector3(0, 0, 1);
					axis = rVec2.Cross(tmp);
					axisMag = axis.Magnitude;
				}
			}
			const n2 = axis.div(axisMag); // single axis of rotation

			// from arc length to rotation angle
			const theta = inputValues.offset / r;

			// chose the Rodrigues rotation formula for rotation by angle theta
			const [ct, st] = [math.cos(theta), math.sin(theta)];
			const [kx, ky, kz] = [n2.X, n2.Y, n2.Z];
			const [vx, vy, vz] = [rVec2.X, rVec2.Y, rVec2.Z];

			const kDotV = kx * vx + ky * vy + kz * vz;
			const kCrossV = new Vector3(ky * vz - kz * vy, kz * vx - kx * vz, kx * vy - ky * vx);

			const vRot = rVec2
				.mul(ct)
				.add(kCrossV.mul(st))
				.add(n2.mul(kDotV * (1 - ct))); // @samlovebutter | there was a mistake here before there was n

			// Bottom line
			let D2 = O.add(vRot);

			// Normalize the length in case of error accumulation
			const diff = D2.sub(O);
			if (math.abs(diff.Magnitude - r) > 1e-6) {
				D2 = O.add(diff.Unit.mul(r));
			}

			this.output.output.set("vector3", D2);
		});
	}
}

export const SplineLerpBlock = {
	...BlockCreation.defaults,
	id: "splinelerpblock",
	displayName: "Spline Lerp",
	description:
		"Creates a path (spline) based on provided coordinates. Allows you to predict simple movement. Wanna know how to use it? Go search on the internet.",
	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("x4GenericLogicBlockPrefab", "SPL-LERP"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
