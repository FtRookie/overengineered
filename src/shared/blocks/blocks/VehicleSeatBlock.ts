import { RunService, Players } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type {
	BlockLogicFullBothDefinitions,
	BlockLogicTickContext,
	InstanceBlockLogicArgs,
} from "shared/blockLogic/BlockLogic";
import type { SharedMachine } from "shared/blockLogic/SharedMachine";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {},
	output: {
		occupied: {
			displayName: "Occupied",
			types: ["bool"],
		},
		occupant: {
			displayName: "Occupant",
			types: ["string"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type VehicleSeatModel = BlockModel & {
	readonly VehicleSeat: VehicleSeat;
};

export type { Logic as VehicleSeatBlockLogic };

@injectable
class Logic extends InstanceBlockLogic<typeof definition, VehicleSeatModel> {
	readonly vehicleSeat;

	constructor(block: InstanceBlockLogicArgs, @inject machine: SharedMachine) {
		super(definition, block);

		this.vehicleSeat = this.instance.VehicleSeat;
		this.event.subscribeObservable(
			this.event.readonlyObservableFromInstanceParam(this.vehicleSeat, "Occupant"),
			(occupant) => {
				this.output.occupied.set("bool", occupant !== undefined);
				const player = Players.GetPlayerFromCharacter(occupant?.Parent as Model);
				if (occupant && player) {
					this.output.occupant.set("string", player.Name);
				} else {
					this.output.occupant.unset();
				}
			},
			true,
		);

		if (RunService.IsClient()) {
			this.vehicleSeat
				.GetPropertyChangedSignal("Occupant")
				.Connect(() =>
					machine.occupiedByLocalPlayer.set(
						this.vehicleSeat.Occupant?.Parent === Players.LocalPlayer.Character,
					),
				);
		}
	}

	getDebugInfo(ctx: BlockLogicTickContext): readonly string[] {
		const char = this.vehicleSeat.Occupant?.Parent;
		const player = char && Players.GetPlayerFromCharacter(char);

		return [...super.getDebugInfo(ctx), `Occupied by ${player?.Name}`];
	}
}

export const VehicleSeatBlock = {
	...BlockCreation.defaults,
	id: "vehicleseat",
	displayName: "Driver seat",
	description: "A seat for your vehicle. Allows only you to control your contraption",
	limit: 1,
	search: { partialAliases: ["vehicle"] },

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
