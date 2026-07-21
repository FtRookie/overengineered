import { ServerPartUtils } from "server/plots/ServerPartUtils";
import { BlockManager } from "shared/building/BlockManager";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import { CustomRemotes } from "shared/Remotes";
import { SlotsMeta } from "shared/SlotsMeta";
import { spawnPositionsKeyed } from "shared/SpawnPositions";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { SlotDatabase } from "server/database/SlotDatabase";
import type { PlayModeBase } from "server/modes/PlayModeBase";
import type { ServerPlayersController } from "server/ServerPlayersController";
import type { SpawnPosition } from "shared/SpawnPositions";

// height to place the HumanoidRootPart above a target so the character doesn't clip into it
const hrpHeightOffset = 2;

@injectable
export class RideMode implements PlayModeBase {
	constructor(
		@inject private readonly serverControllers: ServerPlayersController,
		@inject private readonly blockList: BlockList,
		@inject private readonly slots: SlotDatabase,
		@inject private readonly playerData: PlayerDatabase,
	) {
		CustomRemotes.modes.ride.teleportOnSeat.invoked.Connect(this.sit.bind(this));
	}

	// potentially redundant now
	private alignAndSit(seat: VehicleSeat, hum: Humanoid, hrp: BasePart) {
		hrp.CFrame = seat.CFrame.mul(new CFrame(0, hrpHeightOffset, 0));
		hrp.AssemblyAngularVelocity = Vector3.zero;
		hrp.AssemblyLinearVelocity = Vector3.zero;
		seat.Sit(hum);
	}

	// potentially redundant now
	private sit(player: Player) {
		const hum = player.Character?.FindFirstChildOfClass("Humanoid");
		const hrp = hum?.RootPart;
		if (!hum || !hrp) return;
		if (hum.Sit) return;

		const vehicleSeat = this.serverControllers.controllers
			.get(player.UserId)
			?.plotController.blocks?.getBlocks()
			?.find((model) => BlockManager.manager.id.get(model) === "vehicleseat")
			?.FindFirstChild("VehicleSeat") as VehicleSeat | undefined;
		if (!vehicleSeat) return;

		if (vehicleSeat.Occupant && vehicleSeat.Occupant !== hum) {
			vehicleSeat.Occupant.Sit = false;
			task.wait(0.5);
		}

		if (hum.Health <= 0) return;
		this.alignAndSit(vehicleSeat, hum, hrp);
	}

	onTransitionFrom(player: Player, prevmode: PlayModes | undefined, pos?: SpawnPosition): Response | undefined {
		if (prevmode === "build") {
			return this.rideStart(player, pos ?? "plot");
		}
	}
	onTransitionTo(player: Player, nextmode: PlayModes | undefined): Response | undefined {
		if (nextmode === undefined || nextmode === "build") {
			return this.rideStop(player);
		}
	}

	private initializePhysics(owner: Player, blocks: readonly BlockModel[]) {
		const data = blocks.flatmap((value) => value.GetChildren());

		const rootParts: BasePart[] = [];
		for (const instance of data) {
			if (instance.IsA("BasePart") && instance.AssemblyRootPart === instance) {
				rootParts.push(instance);
			}
		}

		const players = this.serverControllers.getPlayers().filter((p) => p !== owner);
		CustomRemotes.physics.normalizeRootparts.send(players, { parts: rootParts });
	}

	private rideStart(player: Player, pos: SpawnPosition): Response {
		print("spawning at ", pos);
		const spawnPosition = spawnPositionsKeyed[pos];

		const controller = this.serverControllers.controllers.get(player.UserId)?.plotController;
		if (!controller) throw "what";

		const blocksChildren = controller.blocks.getBlocks();

		// lastRun stays in the datastore, so entering ride mode costs no HTTP round trip.
		this.slots.setBlocks(
			player.UserId,
			SlotsMeta.lastRunSlotIndex,
			BlocksSerializer.serializeToObject(controller.blocks),
		);

		if (spawnPosition) {
			for (const block of blocksChildren) {
				block.PivotTo(spawnPosition.mul(controller.blocks.origin.ToObjectSpace(block.GetPivot())));
			}

			try {
				const humanoid = player.Character?.FindFirstChild("Humanoid") as Humanoid;
				humanoid.RootPart!.PivotTo(
					spawnPosition.mul(controller.blocks.origin.ToObjectSpace(humanoid.RootPart!.GetPivot())),
				);
			} catch {
				// empty
			}
		}

		// potentially redundant now
		const vehicleSeat = blocksChildren
			.find((model) => BlockManager.manager.id.get(model) === "vehicleseat")
			?.FindFirstChild("VehicleSeat") as VehicleSeat | undefined;
		if (vehicleSeat) {
			const hum = player.Character?.WaitForChild("Humanoid") as Humanoid;
			const hrp = player.Character?.WaitForChild("HumanoidRootPart") as Part;

			if (vehicleSeat.Occupant && vehicleSeat.Occupant !== hum) {
				vehicleSeat.Occupant.Sit = false;
				task.wait(0.5);
			}

			if (hum.Health > 0) {
				this.alignAndSit(vehicleSeat, hum, hrp);
			}
		}

		for (const block of blocksChildren) {
			ServerPartUtils.switchDescendantsAnchor(block, false);
			if (this.playerData.get(player.UserId).settings?.environment?.physics?.advanced_aerodynamics) {
				ServerPartUtils.switchDescendantsAero(block, true);
			}
		}

		for (const block of blocksChildren) {
			ServerPartUtils.switchDescendantsNetworkOwner(block, player);
		}

		// TODO: move this somewhere
		for (const block of blocksChildren) {
			if (BlockManager.manager.id.get(block) === "anchorblock") {
				ServerPartUtils.switchDescendantsAnchor(block, true);
			}
		}

		this.initializePhysics(player, controller.blocks.getBlocks());

		return { success: true };
	}
	private rideStop(player: Player): Response {
		const controller = this.serverControllers.controllers.get(player.UserId)?.plotController;
		if (!controller) throw "what";

		// Validate BEFORE wiping. Refusing to leave ride mode is recoverable; deleting the build is not.
		const blocksToLoad = this.slots.getBlocks(player.UserId, SlotsMeta.lastRunSlotIndex);
		if (blocksToLoad.version === undefined || blocksToLoad.version > BlocksSerializer.latestVersion) {
			return { success: false, message: "The ride snapshot could not be read" };
		}

		controller.blocks.deleteOperation.execute("all");
		BlocksSerializer.deserializeFromObject(blocksToLoad, controller.blocks, this.blockList);

		return { success: true };
	}
}
