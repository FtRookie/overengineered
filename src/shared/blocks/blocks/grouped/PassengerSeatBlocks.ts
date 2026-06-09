import { Players, RunService } from "@rbxts/services";
import { C2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults } from "shared/blocks/Block";

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

type PassengerSeatModel = BlockModel & {
	readonly VehicleSeat: VehicleSeat;
};

export type { Logic as PassengerSeatBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, PassengerSeatModel> {
	static readonly events = {
		sittable: new C2SRemoteEvent<{ readonly block: PassengerSeatModel; sittable: boolean }>(
			"passengerseat_sittable",
		),
	} as const;
	readonly vehicleSeat;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		this.vehicleSeat = this.instance.VehicleSeat;
		const lockCache = this.initializeInputCache("lock");

		this.event.subscribeObservable(
			this.event.readonlyObservableFromInstanceParam(this.vehicleSeat, "Occupant"),
			(occupant) => {
				this.output.occupied.set("bool", occupant !== undefined);
				if (!occupant) {
					this.output.occupant.unset();
					if (RunService.IsClient()) {
						const h = Players.LocalPlayer.Character?.FindFirstChildOfClass("Humanoid");
						if (h) h.UseJumpPower = true;
					}
					return;
				}
				const player = Players.GetPlayerFromCharacter(occupant.Parent as Model);
				if (player) this.output.occupant.set("string", player.Name);
				if (player === Players.LocalPlayer) {
					occupant.UseJumpPower = !(lockCache.tryGet() ?? false);
					occupant.JumpHeight = 0;
				}
			},
			true,
		);

		if (!RunService.IsClient()) return;
		this.onDisable(() => {
			const h = Players.LocalPlayer.Character?.FindFirstChildOfClass("Humanoid");
			if (!h) return;
			h.UseJumpPower = true;
		});

		this.onk(["lock"], ({ lock }) => {
			const occupant = this.vehicleSeat.Occupant;
			if (occupant !== Players.LocalPlayer.Character?.FindFirstChildOfClass("Humanoid")) return;
			occupant!.UseJumpPower = !lock;
			occupant!.JumpHeight = 0;
		});

		this.onk(["sittable"], ({ sittable }) => {
			this.vehicleSeat.Disabled = !sittable;
			Logic.events.sittable.send({ block: this.instance, sittable });
		});
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
