import { ServerPartUtils } from "server/plots/ServerPartUtils";
import { BlockConfig } from "shared/blockLogic/BlockConfig";
import { SpawnBlock } from "shared/blocks/blocks/SpawnBlock";
import { BlockManager } from "shared/building/BlockManager";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import { CustomRemotes } from "shared/Remotes";
import { SlotsMeta } from "shared/SlotsMeta";
import { spawnPositionsKeyed } from "shared/SpawnPositions";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { SlotDatabase } from "server/database/SlotDatabase";
import type { PlayModeBase } from "server/modes/PlayModeBase";
import type { MortalityController } from "server/MortalityController";
import type { ServerBlockDamageController } from "server/ServerBlockDamageController";
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
		@inject private readonly mortality: MortalityController,
		@inject private readonly damage: ServerBlockDamageController,
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

	/** One Spawn block of the build, picked at random in proportion to its Weight; none when no Spawn can be picked */
	private pickSpawn(
		blocks: readonly BlockModel[],
	): { readonly block: BlockModel; readonly useSeat: boolean } | undefined {
		const spawns: { block: BlockModel; weight: number; useSeat: boolean }[] = [];
		let total = 0;

		for (const block of blocks) {
			if (BlockManager.manager.id.get(block) !== SpawnBlock.id) continue;

			const config = BlockConfig.addDefaults(
				BlockManager.manager.config.get(block),
				SpawnBlock.logic.definition.input,
			);
			const weight = config.weight.config;
			if (!typeIs(weight, "number") || weight !== weight || weight <= 0) continue;

			spawns.push({ block, weight, useSeat: config.useSeat.config === true });
			total += weight;
		}

		if (spawns.size() === 0) return;

		let roll = math.random() * total;
		for (const spawn of spawns) {
			roll -= spawn.weight;
			if (roll < 0) return spawn;
		}

		return spawns[spawns.size() - 1];
	}

	private rideStart(player: Player, pos: SpawnPosition): Response {
		$log(`[ride] spawning at ${pos}`);
		const spawnPosition = spawnPositionsKeyed[pos];

		const playerController = this.serverControllers.controllers.get(player.UserId);
		const controller = playerController?.plotController;
		if (!playerController || !controller) throw "what";

		const blocksChildren = controller.blocks.getBlocks();

		// lastRun stays in the datastore, so entering ride mode costs no HTTP round trip.
		this.slots.setBlocks(
			player.UserId,
			SlotsMeta.lastRunSlotIndex,
			BlocksSerializer.serializeToObject(controller.blocks),
		);
		playerController.slotRequests.copyLayoutTo(SlotsMeta.lastRunSlotIndex);

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

		const spawn = this.pickSpawn(blocksChildren);
		if (spawn) {
			const humanoid = player.Character?.FindFirstChildOfClass("Humanoid");
			const rootPart = humanoid?.RootPart;
			const pad = spawn.block.PrimaryPart;
			if (humanoid && rootPart && pad) {
				// a character still sitting from build mode stays in the seat through the teleport otherwise
				if (humanoid.SeatPart) {
					humanoid.SeatPart.FindFirstChild("SeatWeld")?.Destroy();
					humanoid.Sit = false;
					task.wait(0.2);
				}

				rootPart.AssemblyLinearVelocity = Vector3.zero;
				rootPart.AssemblyAngularVelocity = Vector3.zero;
				rootPart.PivotTo(pad.CFrame.mul(new CFrame(0, pad.Size.Y / 2 + 3, 0)));
			}
		}

		// potentially redundant now
		const vehicleSeat = blocksChildren
			.find((model) => BlockManager.manager.id.get(model) === "vehicleseat")
			?.FindFirstChild("VehicleSeat") as VehicleSeat | undefined;
		if (vehicleSeat && (!spawn || spawn.useSeat)) {
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
		this.damage.snapshotPvp(player.UserId); // before arm, which reads PvP for mortality
		// riding is where damage counts, so the limbs are registered here
		this.mortality.arm(player);

		return { success: true };
	}
	private rideStop(player: Player): Response {
		const controller = this.serverControllers.controllers.get(player.UserId)?.plotController;
		if (!controller) throw "what";

		this.mortality.disarm(player);

		// Validate BEFORE wiping. Refusing to leave ride mode is recoverable; deleting the build is not.
		const blocksToLoad = this.slots.getBlocks(player.UserId, SlotsMeta.lastRunSlotIndex);
		if (blocksToLoad.version === undefined || blocksToLoad.version > BlocksSerializer.latestVersion) {
			this.mortality.arm(player);
			return { success: false, message: "The ride snapshot could not be read" };
		}

		controller.blocks.deleteOperation.execute("all");
		BlocksSerializer.deserializeFromObject(blocksToLoad, controller.blocks, this.blockList);
		this.damage.releasePvp(player.UserId);

		return { success: true };
	}
}
