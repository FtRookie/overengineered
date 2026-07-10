import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { DisconnectBlock } from "shared/blocks/blocks/DisconnectBlock";
import { BuildingManager } from "shared/building/BuildingManager";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { RemoteEvents } from "shared/RemoteEvents";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import type { WeightUnit } from "shared/data/GameDefinitions";

const definition = {
	input: {
		assemblyonly: {
			displayName: "Assembly Only",
			types: {
				bool: {
					config: false,
				},
			},
			connectorHidden: true,
		},
		unit: {
			displayName: "Unit",
			types: {
				enum: {
					config: "rmu",
					elementOrder: ["rmu", "kgs", "lbs"],
					elements: {
						rmu: { displayName: "RMU", tooltip: "Weight of a 1x1x1 part with a density of 1" },
						kgs: { displayName: "Kilograms", tooltip: "Standard metric unit of weight" },
						lbs: { displayName: "Pounds", tooltip: "The standard imperial unit of weight" },
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		result: {
			displayName: "Mass (RMU)",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as MassSensorBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const assemblyOnlyCache = this.initializeInputCache("assemblyonly");
		const unitCache = this.initializeInputCache("unit");

		const update = () => {
			if (!this.instance.PrimaryPart) {
				this.disable();
				return;
			}

			const assemblyOnly = assemblyOnlyCache.get();
			const unit = unitCache.get() as WeightUnit;

			const out = assemblyOnly ? this.instance.PrimaryPart.AssemblyMass : this.getBuildingMass();
			this.output.result.set("number", out * GameDefinitions.RMU_TO[unit]);
		};

		this.event.subscribe(DisconnectBlock.logic.ctor.events.disconnect.senderInvoked, update);
		this.event.subscribe(RemoteEvents.ImpactBreak.senderInvoked, update);

		this.onFirstInputs(update);
	}

	private getBuildingMass() {
		let mass = 0;
		for (const block of BuildingManager.getMachineBlocks(this.instance)) {
			for (const desc of block.GetDescendants()) {
				if (!desc.IsA("BasePart")) continue;
				mass += desc.Mass;
			}
		}

		return mass;
	}
}

export const MassSensorBlock = {
	...BlockCreation.defaults,
	id: "masssensor",
	displayName: "Mass Sensor",
	description: "Returns the current contraption/assembly mass in RMU",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
