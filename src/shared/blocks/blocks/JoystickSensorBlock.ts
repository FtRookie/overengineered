import { PerFrame } from "engine/shared/PerFrame";
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

let movement: PerFrame<{ readonly x: number; readonly y: number; readonly angle: number }> | undefined;

export type { Logic as JoystickSensorBlockLogic };
@injectable
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs, @inject playerInfo: PlayerInfo) {
		super(definition, block);

		const controlModule = playerInfo.getPlayerModule().controls;
		// the PlayerModule is required once per client, so every sensor reads the same controls
		const shared = (movement ??= new PerFrame(() => {
			const moveVector = controlModule.GetMoveVector();
			const x = moveVector.X;
			const y = -moveVector.Z;
			return { x, y, angle: moveVector.Magnitude > 0 ? math.deg(math.atan2(x, y)) : 0 };
		}));

		this.onTicc(() => {
			const { x, y, angle } = shared.get();
			this.output.x.set("number", x);
			this.output.y.set("number", y);
			this.output.angle.set("number", angle);
		});
		this.unsetOutputsOnDisable();
	}
}

export const JoystickSensorBlock = {
	...BlockCreation.defaults,
	id: "joysticksensor",
	displayName: "Joystick Sensor",
	description: "Outputs the current movement direction",
	search: { partialAliases: ["move", "controller", "stick"] },

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
