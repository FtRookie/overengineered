import { RunService, Workspace } from "@rbxts/services";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import type { DistanceUnit } from "shared/data/GameDefinitions";

const definition = {
	outputOrder: ["position", "direction", "up"],
	input: {
		unit: {
			displayName: "Unit",
			types: {
				enum: {
					config: "studs",
					elementOrder: ["studs", "meters"],
					elements: {
						studs: { displayName: "Studs", tooltip: "The default unit of Roblox" },
						meters: { displayName: "Meters", tooltip: "100x the standard metric unit of length" },
						feet: { displayName: "Feet", tooltip: "About a third of a meter" },
						miles: { displayName: "Miles", tooltip: "5280 feet" },
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		position: {
			displayName: "Position",
			types: ["vector3"],
		},
		direction: {
			displayName: "Direction",
			unit: "Normal",
			types: ["vector3"],
		},
		up: {
			displayName: "Up vector",
			unit: "Normal",
			types: ["vector3"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as OwnerCameraLocatorBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		// unit is config-only, so resolve the multiplier once instead of re-reading it every tick
		let unitMul = GameDefinitions.STUDS_TO.studs;
		this.onkFirstInputs(["unit"], ({ unit }) => (unitMul = GameDefinitions.STUDS_TO[unit as DistanceUnit]));
		const applyUnit = (v: number) => v * unitMul;

		this.event.subscribe(RunService.PostSimulation, () => {
			const camera = Workspace.CurrentCamera;
			if (!camera) return;

			const cf = camera.CFrame;
			const offset = cf.Position.sub(new Vector3(0, GameDefinitions.HEIGHT_OFFSET, 0));
			this.output.position.set("vector3", offset.apply(applyUnit));
			this.output.direction.set("vector3", cf.LookVector);
			this.output.up.set("vector3", cf.UpVector);
		});
	}
}

export const OwnerCameraLocatorBlock = {
	...BlockCreation.defaults,
	id: "ownercameralocator",
	displayName: "Owner Camera Locator",
	description: "Returns owner camera position and direction",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
