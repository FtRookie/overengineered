import { C2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["enabled", "shared", "dragMode", "response", "torque"],
	input: {
		enabled: {
			displayName: "Enabled",
			types: { bool: { config: true } },
			connectorHidden: true,
		},
		shared: {
			displayName: "Shared",
			types: { bool: { config: false } },
			connectorHidden: true,
		},
		dragMode: {
			displayName: "Drag Mode",
			types: {
				enum: {
					config: "translateViewPlane",
					elementOrder: ["translateViewPlane", "translatePlane", "translateLine", "rotateAxis"],
					elements: {
						translateViewPlane: {
							displayName: "Translate View Plane",
							tooltip: "Moves along your screen's XY plane",
						},
						translatePlane: { displayName: "Translate Plane", tooltip: "Only moves along the XZ plane" },
						translateLine: { displayName: "Translate Line", tooltip: "Only moves vertically" },
						rotateAxis: { displayName: "Rotate Axis", tooltip: "Rotates along the Y axis" },
					},
				},
			},
			connectorHidden: true,
		},
		response: {
			displayName: "Responsiveness",
			types: { number: { config: 10, clamp: { min: 0, max: 100, step: 0.1, showAsSlider: true } } },
			connectorHidden: true,
		},
		torque: {
			displayName: "Torque",
			types: {
				number: {
					config: 10000,
					clamp: {
						min: 0,
						max: 100000,
						step: 0.1,
						showAsSlider: true,
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

const updateType = t.intersection(
	t.interface({
		block: t.instance("Model").as<HandleBlockModel>(),
		enabled: t.boolean,
		shared: t.boolean,
		dragMode: t.string,
		response: t.numberWithBounds(0, 100, 0.1),
		torque: t.numberWithBounds(0, 100000, 0.1), // change on server too
	}),
);
type updateType = t.Infer<typeof updateType>;

type HandleBlockModel = BlockModel & {
	Main: MeshPart & {
		DragDetector: DragDetector;
	};
};

export type { Logic as HandleBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, HandleBlockModel> {
	static readonly updateType = updateType;
	static readonly enumToDragStyle: Record<string, Enum.DragDetectorDragStyle> = {
		translateViewPlane: Enum.DragDetectorDragStyle.TranslateViewPlane,
		translatePlane: Enum.DragDetectorDragStyle.TranslatePlane,
		translateLine: Enum.DragDetectorDragStyle.TranslateLine,
		rotateAxis: Enum.DragDetectorDragStyle.RotateAxis,
	};
	static readonly events = {
		update: new C2SRemoteEvent<updateType>("handle_update"),
	};
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		this.onkFirstInputs(
			["enabled", "shared", "dragMode", "response", "torque"],
			({ enabled, shared, dragMode, response, torque }) => {
				if (!enabled) this.disable();
				Logic.events.update.send({
					block: this.instance,
					enabled: enabled,
					shared: shared,
					dragMode: dragMode,
					response: response,
					torque: torque,
				});
			},
		);
	}
}

export const HandleBlock = {
	...BlockCreation.defaults,
	id: "handle",
	displayName: "Handle",
	description: "To hold",
	search: { partialAliases: ["grab"] },

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
