import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { PlayerInfo } from "engine/shared/PlayerInfo";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, BlockCategoryPath, BlockModelSource } from "shared/blocks/Block";

const autoModel = (prefab: BlockCreation.Model.PrefabName, text: string, category: BlockCategoryPath) => {
	return {
		model: BlockCreation.Model.fAutoCreated(prefab, text),
		category: () => category,
	} satisfies BlockModelSource;
};
const definition = {
	outputOrder: ["x", "y", "angle"],
	input: {},
	output: {
		x: {
			displayName: "X",
			types: ["number"],
		},
		y: {
			displayName: "Y",
			types: ["number"],
		},
		angle: {
			displayName: "Angle around Center",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as JoystickSensorBlockLogic };
@injectable
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs, @inject playerInfo: PlayerInfo) {
		super(definition, block);

		const controlModule = playerInfo.getPlayerModule().controls;

		this.onTicc(() => {
			const moveVector = controlModule.GetMoveVector();
			const x = moveVector.X;
			const y = -moveVector.Z;
			const angle = moveVector.Magnitude > 0 ? math.deg(math.atan2(x, y)) : 0;
			this.output.x.set("number", x);
			this.output.y.set("number", y);
			this.output.angle.set("number", angle);
		});
	}
}

export const JoystickSensorBlock = {
	...BlockCreation.defaults,
	id: "joysticksensor",
	displayName: "Joystick Sensor",
	description: "Outputs the current movement direction",
	search: { partialAliases: ["move", "controller", "stick"] },
	modelSource: autoModel("DoubleGenericLogicBlockPrefab", "JOYSTICK", BlockCreation.Categories.sensor),

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
