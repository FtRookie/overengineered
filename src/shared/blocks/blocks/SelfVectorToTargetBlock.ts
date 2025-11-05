import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["up", "front", "right", "vecToTarget", "toDegree"],
	outputOrder: ["x", "y", "z"],
	input: {
		up: {
			displayName: "Up",
			types: {
				vector3: {
					config: new Vector3(0, 1, 0),
				},
			},
		},
		front: {
			displayName: "Front",
			types: {
				vector3: {
					config: new Vector3(-1, 0, 0),
				},
			},
		},
		right: {
			displayName: "Right",
			types: {
				vector3: {
					config: new Vector3(0, 0, -1),
				},
			},
		},
		vecToTarget: {
			displayName: "VecToTarget",
			types: {
				vector3: {
					config: new Vector3(0, 0, 0),
				},
			},
		},
		toDegree: {
			displayName: "ToDegree",
			connectorHidden: true,
			types: {
				bool: {
					config: true,
				},
			},
		},
	},
	output: {
		x: {
			displayName: "Output",
			types: ["number"],
		},
		y: {
			displayName: "Output",
			types: ["number"],
		},
		z: {
			displayName: "Output",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as SelfVectorToTargetLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		let inputValues = {
			up: new Vector3(0, 1, 0),
			front: new Vector3(-1, 0, 0),
			right: new Vector3(0, 0, -1),
			vecToTarget: new Vector3(0, 0, 0),
			toDegree: true,
		};

		this.on((data) => (inputValues = data));

		this.onTicc(() => {
			const dx = inputValues.vecToTarget.Dot(inputValues.right); // компонент по right
			const dy = inputValues.vecToTarget.Dot(inputValues.up); // компонент по up
			const dz = inputValues.vecToTarget.Dot(inputValues.front); // компонент по forward

			let yaw = math.atan2(dx, dz);
			const horizontalLen = math.sqrt(dx * dx + dz * dz);
			let pitch = math.atan2(dy, horizontalLen);

			if (inputValues.toDegree) {
				yaw = math.deg(yaw);
				pitch = math.deg(pitch);
			}

			this.output.x.set("number", yaw);
			this.output.y.set("number", -pitch);
		});
	}
}

export const SelfVectorToTarget = {
	...BlockCreation.defaults,
	id: "selfvectortotarget",
	displayName: "Self Vector To Target",
	description: "Returns the angles (yaw, pitch) to the target relative to the self rotation vectors",
	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("x4GenericLogicBlockPrefab", "VEC-TO-TARG"),
		category: () => BlockCreation.Categories.other,
	},
} as const satisfies BlockBuilder;
