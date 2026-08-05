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
	/** What each humanoid had before it was first locked, so both properties can be put back. */
	private static readonly originalJump = new Map<Humanoid, { useJumpPower: boolean; jumpHeight: number }>();

	/**
	 * Locking works by switching the humanoid to `JumpHeight` mode and zeroing the height, because jumping is
	 * what releases a seat. Both properties have to be restored: leaving `JumpHeight` at 0 is invisible while
	 * `UseJumpPower` is true, and becomes "cannot jump anywhere" the moment anything sets it false again —
	 * which the next sit does. Passing `false` (or nothing) restores.
	 */
	static setJumpLock(humanoid: Humanoid | undefined, locked = false) {
		if (!humanoid) return;

		if (!locked) {
			const original = Logic.originalJump.get(humanoid);
			if (!original) return;

			Logic.originalJump.delete(humanoid);
			humanoid.UseJumpPower = original.useJumpPower;
			humanoid.JumpHeight = original.jumpHeight;
			return;
		}

		if (!Logic.originalJump.has(humanoid)) {
			Logic.originalJump.set(humanoid, {
				useJumpPower: humanoid.UseJumpPower,
				jumpHeight: humanoid.JumpHeight,
			});
			humanoid.Destroying.Once(() => Logic.originalJump.delete(humanoid));
		}

		humanoid.UseJumpPower = false;
		humanoid.JumpHeight = 0;
	}

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
					Logic.setJumpLock(playerInfo.humanoid.get());
					return;
				}
				const player = Players.GetPlayerFromCharacter(occupant.Parent as Model);
				if (player) this.output.occupant.set("string", player.Name);
				if (player === Players.LocalPlayer) {
					Logic.setJumpLock(occupant, lockCache.tryGet() ?? false);
				}
			},
			true,
		);

		if (!RunService.IsClient()) return;

		// Both, because playerInfo.humanoid is cleared on death — the seat's own occupant is the humanoid
		// that was actually locked.
		this.onDisable(() => {
			Logic.setJumpLock(this.vehicleSeat.Occupant);
			Logic.setJumpLock(playerInfo.humanoid.get());
		});

		this.onk(["lock"], ({ lock }) => {
			// `!occupant` first: an empty seat and a missing humanoid are both undefined, so comparing them
			// alone passes the guard and the old non-null assertion then threw.
			const occupant = this.vehicleSeat.Occupant;
			if (!occupant || occupant !== playerInfo.humanoid.get()) return;

			Logic.setJumpLock(occupant, lock);
		});

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
