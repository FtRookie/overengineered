import { RunService, Players } from "@rbxts/services";
import { C2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { PlayerInfo } from "engine/shared/PlayerInfo";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { SharedMachine } from "shared/blockLogic/SharedMachine";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		lock: {
			displayName: "Lock",
			types: {
				bool: { config: false },
			},
		},
		sittable: {
			displayName: "Sittable",
			types: {
				bool: { config: true },
			},
		},
	},
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

type VehicleSeatModel = BlockModel & {
	readonly VehicleSeat: VehicleSeat;
};

export type { Logic as VehicleSeatBlockLogic };

@injectable
class Logic extends InstanceBlockLogic<typeof definition, VehicleSeatModel> {
	static readonly events = {
		sittable: new C2SRemoteEvent<{ readonly block: VehicleSeatModel; sittable: boolean }>("vehicleseat_sittable"),
	} as const;
	readonly vehicleSeat;

	constructor(block: InstanceBlockLogicArgs, @inject machine: SharedMachine, @inject playerInfo: PlayerInfo) {
		super(definition, block);

		this.vehicleSeat = this.instance.VehicleSeat;
		const lockCache = this.initializeInputCache("lock");

		this.event.subscribeObservable(
			this.event.readonlyObservableFromInstanceParam(this.vehicleSeat, "Occupant"),
			(occupant) => {
				this.output.occupied.set("bool", occupant !== undefined);
				if (!occupant) {
					this.output.occupant.unset();
					const get = playerInfo.humanoid.get();
					if (get) get.UseJumpPower = true;
					return;
				}
				const player = Players.GetPlayerFromCharacter(occupant.Parent as Model);
				if (player) this.output.occupant.set("string", player.Name);
				if (player === Players.LocalPlayer) {
					occupant.UseJumpPower = !(lockCache.tryGet() ?? false);
					occupant.JumpHeight = 0;
				}
			},
			true, // <-----
		);

		this.onk(["lock"], ({ lock }) => {
			const occupant = this.vehicleSeat.Occupant;
			if (occupant !== playerInfo.humanoid.get()) return;
			occupant!.UseJumpPower = !lock;
			occupant!.JumpHeight = 0;
		});

		if (!RunService.IsClient()) return;

		this.onk(["sittable"], ({ sittable }) => {
			this.vehicleSeat.Disabled = !sittable;
			Logic.events.sittable.send({ block: this.instance, sittable });
		});

		// This event is only registered seperately because it doesn't run immediately
		this.event.subscribeObservable(
			this.event.readonlyObservableFromInstanceParam(this.vehicleSeat, "Occupant"),
			(oc) => machine.occupiedByLocalPlayer.set(oc?.Parent === Players.LocalPlayer.Character),
		);
	}
}

export const VehicleSeatBlock = {
	...BlockCreation.defaults,
	id: "vehicleseat",
	displayName: "Driver seat",
	description: "A seat for your vehicle. Allows you to control your contraption",
	limit: 1,
	search: { partialAliases: ["vehicle"] },

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
