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
			// Проверка вырожденности
			const AB = inputValues.b.sub(inputValues.a);
			const AC = inputValues.c.sub(inputValues.a);
			const n = AB.Cross(AC);
			const nLen2 = n.Dot(n);
			if (nLen2 === 0) {
				return new Vector3(0, 0, 0);
			}

			// Careful, this guy uses some fancy words vvvvvvvvvvvvvvvvvvvvvv
			// (actually had that math in the 7th/8th grade)
			// - @samlovebutter

			// ортонормированные базисы
			const e1 = AB.Unit; // вдоль AB
			const e3 = n.Unit; // по самой плоскости
			const e2 = e3.Cross(e1); // по нормали

			// Координаты e1 и e2 в базисе относительно А
			const xB = AB.Dot(e1);
			const yB = AB.Dot(e2);
			const xC = AC.Dot(e1);
			const yC = AC.Dot(e2);

			// тут вычисляется окружностный центр в 2D (формула через пересечение серп. перпендикулярных). Выбрал формулу через детерминант
			const D = 2 * (xB * yC - yB * xC);

			const xB2yB2 = xB * xB + yB * yB;
			const xC2yC2 = xC * xC + yC * yC;

			const ux = (yC * xB2yB2 - yB * xC2yC2) / D;
			const uy = (xB * xC2yC2 - xC * xB2yB2) / D;

			// обратно в 3D
			const O = inputValues.a.add(e1.mul(ux)).add(e2.mul(uy));

			// теперь зная центр окружности можно строить лерп
			const rVec2 = inputValues.a.sub(O);
			const r = rVec2.Magnitude;
			if (r === 0) {
				return new Vector3(0, 0, 0);
			}

			// Нормаль плоскости
			let axis = rVec2.Cross(inputValues.b.sub(O));
			let axisMag = axis.Magnitude;
			if (axisMag === 0) {
				// если A, B, C коллинеарны то выбираем любую ось перпендикулярную lVec
				let tmp = math.abs(rVec2.X) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
				axis = rVec2.Cross(tmp);
				axisMag = axis.Magnitude;
				if (axisMag === 0) {
					tmp = new Vector3(0, 0, 1);
					axis = rVec2.Cross(tmp);
					axisMag = axis.Magnitude;
				}
			}
			const n2 = axis.div(axisMag); // единичная ось вращения

			// из длины дуги в угол поворота
			const theta = inputValues.offset / r;

			// выбрал формулу поворота родрига для поворота на угол тета
			const [ct, st] = [math.cos(theta), math.sin(theta)];

			const [kx, ky, kz] = [n2.X, n2.Y, n2.Z];
			const [vx, vy, vz] = [rVec2.X, rVec2.Y, rVec2.Z];

			const kDotV = kx * vx + ky * vy + kz * vz;
			const kCrossV = new Vector3(ky * vz - kz * vy, kz * vx - kx * vz, kx * vy - ky * vx);

			const vRot = rVec2
				.mul(ct)
				.add(kCrossV.mul(st))
				.add(n.mul(kDotV * (1 - ct)));

			// Итоговая точка
			let D2 = O.add(vRot);

			// Нормализация длины на случай накопления ошибок
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
