import { Players } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type {
	BlockLogicFullBothDefinitions,
	BlockLogicTickContext,
	InstanceBlockLogicArgs,
} from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {
		occupied: {
			displayName: "Occupied",
			types: ["bool"],
		},
		occupant: {
			displayName: "Occupant Name",
			types: ["string"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type PassengerSeatModel = BlockModel & {
	readonly VehicleSeat: VehicleSeat;
};

export type { Logic as PassengerSeatBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, PassengerSeatModel> {
	readonly vehicleSeat;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		this.vehicleSeat = this.instance.VehicleSeat;

		const update = () => {
			const occupant = this.vehicleSeat.Occupant;
			this.output.occupied.set("bool", occupant !== undefined);
			if (!occupant) {
				this.output.occupant.unset();
				return;
			}
			const player = Players.GetPlayerFromCharacter(occupant.Parent as Model);
			if (player) this.output.occupant.set("string", player.Name);
		};

		this.event.subscribe(this.vehicleSeat.GetPropertyChangedSignal("Occupant"), update);
		this.onEnable(update);
	}

	getDebugInfo(ctx: BlockLogicTickContext): readonly string[] {
		const char = this.vehicleSeat.Occupant?.Parent;
		const player = char && Players.GetPlayerFromCharacter(char);

		return [...super.getDebugInfo(ctx), `Occupied by ${player?.Name}`];
	}
}

const list: BlockBuildersWithoutIdAndDefaults = {
	passengerseat: {
		displayName: "Passenger seat",
		description: "Allow your friends to have immeasurable fun with you",

		logic: { definition, ctor: Logic },
	},
	armlesspassengerseat: {
		displayName: "Armless Passenger seat",
		description: "Allow your friends to have immeasurable fun with you, but armless",

		logic: { definition, ctor: Logic },
	},
	flatseat: {
		displayName: "Flat seat",
		description: "Allow your friends backs to have immeasurable back pain",

		logic: { definition, ctor: Logic },
	},
};
export const PassengerSeatBlocks = BlockCreation.arrayFromObject(list);
