import { GuiService, Workspace } from "@rbxts/services";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder, BlockCategoryPath, BlockModelSource } from "shared/blocks/Block";

const autoModel = (prefab: BlockCreation.Model.PrefabName, text: string, category: BlockCategoryPath) => {
	return {
		model: BlockCreation.Model.fAutoCreated(prefab, text),
		category: () => category,
	} satisfies BlockModelSource;
};
const definition = {
	inputOrder: ["position", "cameraDir", "upDir", "cameraPos", "fov"],
	input: {
		position: {
			displayName: "Position",
			types: {
				vector3: {
					config: new Vector3(),
				},
			},
			configHidden: true,
		},
		cameraPos: {
			displayName: "Camera Position",
			types: {
				vector3: {
					config: new Vector3(),
				},
			},
			configHidden: true,
		},
		upDir: {
			displayName: "Up Direction",
			types: {
				vector3: {
					config: new Vector3(),
				},
			},
			configHidden: true,
		},
		cameraDir: {
			displayName: "Camera Direction",
			types: {
				vector3: {
					config: new Vector3(),
				},
			},
			configHidden: true,
		},
		fov: {
			displayName: "Field of View",
			types: {
				number: {
					config: 70,
					clamp: {
						showAsSlider: true,
						min: 1,
						max: 120,
					},
				},
			},
		},
	},
	outputOrder: ["result", "visible"],
	output: {
		result: {
			displayName: "Screen Position",
			unit: "X, Y, none",
			types: ["vector3"],
		},
		visible: {
			displayName: "On Screen",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as PointToScreenSpaceBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		this.onkRecalcInputs(
			["position", "cameraPos", "upDir", "cameraDir", "fov"],
			({ position, cameraPos, cameraDir, upDir, fov }) => {
				const screenSize = Workspace.CurrentCamera!.ViewportSize;
				const right = cameraDir.Cross(upDir).Unit;
				const trueUp = right.Cross(cameraDir).Unit;

				const difference = position.sub(cameraPos);
				const depth = difference.Dot(cameraDir);
				if (depth <= 0) {
					this.output.result.unset();
					this.output.visible.set("bool", false);
					return;
				}

				const X = difference.Dot(right);
				const Y = difference.Dot(trueUp);
				const rfov = math.tan(math.rad(fov / 2));
				const aspect = screenSize.X / screenSize.Y;

				const ndcX = X / (depth * rfov) / aspect;
				const ndcY = Y / (depth * rfov);

				const pixelX = (0.5 + ndcX / 2) * screenSize.X;
				const pixelY = (0.5 - ndcY / 2) * screenSize.Y;

				const guiInset = GuiService.GetGuiInset()[0];
				const scaleX = (pixelX - guiInset.X) / (screenSize.X - guiInset.X);
				const scaleY = (pixelY - guiInset.Y) / (screenSize.Y - guiInset.Y);

				this.output.result.set("vector3", new Vector3(scaleX, scaleY, 0));
				this.output.visible.set("bool", true);
			},
		);
	}
}
export const PointToScreenSpaceBlock = {
	...BlockCreation.defaults,
	displayName: "Point to Screen Space",
	id: "pointtoscreenspace",
	description: "Converts a world position into a normalized screen position",
	modelSource: autoModel("x4GuiLogicBlockPrefab", "Point->Screen", BlockCreation.Categories.converterVector),
	search: { aliases: ["crosshair"], partialAliases: ["gui"] },
	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
