import { Players, Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { ArgsSignal } from "engine/shared/event/Signal";
import { LocalInstanceData } from "engine/shared/LocalInstanceData";
import { ExtinguisherBombBlock } from "shared/blocks/blocks/ExtinguisherBombBlock";
import { BlockManager } from "shared/building/BlockManager";
import { RemoteEvents } from "shared/RemoteEvents";
import { CustomRemotes } from "shared/Remotes";
import { CustomDebrisService } from "shared/service/CustomDebrisService";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { ServerBlockDamageController } from "server/ServerBlockDamageController";
import type { SharedPlots } from "shared/building/SharedPlots";
import type { FireEffect } from "shared/effects/FireEffect";

const overlapParams = new OverlapParams();
overlapParams.CollisionGroup = "Blocks"; // todo: change checks for colboxes in fire controller and use "ColBoxExclusive" here

// Extinguish remote clamp (the bomb's slider max)
const MAX_EXTINGUISH_RADIUS = ExtinguisherBombBlock.logic.definition.input.radius.types.number.clamp.max;

// Players catch fire within this many studs of a burning block, checked every interval (seconds)
const PLAYER_IGNITE_RADIUS = 4;
const PLAYER_IGNITE_INTERVAL = 1;

const tryChance = (chance: number) => math.random() < chance;

// Apply color
const darkness = math.random(0, 50);
const color = Color3.fromRGB(darkness, darkness, darkness);

@injectable
export class SpreadingFireController extends HostedService {
	/** burning parts per plot, for the ride-mode mass-cancel (parallel to spreadThreads) */
	private readonly plotSpreadParts = new Map<PlotModel, Set<BasePart>>();
	static instance?: SpreadingFireController;

	/** Fires when a player's extinguisher put out at least one burning block or player. */
	readonly extinguished = new ArgsSignal<
		[extinguisher: Player | undefined, blocks: readonly BlockModel[], players: readonly Player[]]
	>();

	constructor(
		@inject private readonly fireEffect: FireEffect,
		@inject private readonly playModeController: PlayModeController,
		@inject private readonly plots: SharedPlots,
		@inject private readonly blockDamageController: ServerBlockDamageController,
	) {
		super();

		SpreadingFireController.instance = this;
		CustomRemotes.modes.set.received.Connect((player, { mode }) => {
			if (mode !== "ride") return;
			const plot = plots.getPlotByOwnerID(player.UserId);
			if (!plot) throw "Where's your plot, mate?";
			this.plotSpreadParts.delete(plot);
		});

		// extinguisher detonations; teardown lives here — the shared bomb handler can't reach unmarkBurning
		this.event.subscribe(RemoteEvents.Extinguish.invoked, (player, { part, radius }) => {
			if (!part) return;
			const [blocks, players] = this.extinguishArea(part.Position, math.clamp(radius, 0, MAX_EXTINGUISH_RADIUS));
			if (!blocks.isEmpty() || !players.isEmpty()) this.extinguished.Fire(player, blocks, players);
		});

		// A fire that lasted the full 25s but didn't get destroyed needs it's tag removed
		this.event.subscribe(this.blockDamageController.blockBurnedOut, (block) => {
			for (const part of block.GetDescendants()) {
				if (!part.IsA("BasePart")) continue;
				LocalInstanceData.RemoveLocalTag(part, "Burn");
				this.fireEffect.extinguish(part);
			}
		});

		// Players don't get block→block spread, but still catch fire near a burning part. Their limbs then burn
		// through the same pipeline as blocks (finite: HP→0 dismember, or the 25s burnout) — there's no separate
		// player-fire timer to leak, which was the "fire never goes out" bug.
		this.event.loop(PLAYER_IGNITE_INTERVAL, () => {
			for (const plr of Players.GetPlayers()) {
				const character = plr.Character;
				const root = character?.PrimaryPart;
				if (!root) continue;

				for (const p of Workspace.GetPartBoundsInRadius(root.Position, PLAYER_IGNITE_RADIUS, overlapParams)) {
					if (!LocalInstanceData.HasLocalTag(p, "Burn")) continue;
					for (const limb of character.GetChildren()) {
						if (limb.IsA("BasePart")) this.burn(limb, 0.3);
					}
					break;
				}
			}
		});
	}

	/** Extinguish every burning part within `radius` studs; returns the affected blocks and players (deduped). */
	extinguishArea(position: Vector3, radius: number): LuaTuple<[blocks: BlockModel[], players: Player[]]> {
		// Sweep characters BEFORE blocks: the block overlap query below returns any part whose collision
		// group collides with "Blocks" — which includes character limbs — so running it first would
		// extinguish a burning limb and clear its "Burn" tag before this loop can count it, dropping the
		// player from the result (and only awarding the block-extinguish achievement).
		const players: Player[] = [];
		for (const plr of Players.GetPlayers()) {
			const char = plr.Character;
			if (!char) continue;
			const root = char.PrimaryPart;
			if (!root || root.Position.sub(position).Magnitude > radius) continue;

			let wasBurning = false;
			for (const limb of char.GetDescendants()) {
				if (!limb.IsA("BasePart")) continue;
				if (!LocalInstanceData.HasLocalTag(limb, "Burn")) continue;
				this.extinguish(limb);
				wasBurning = true;
			}
			if (wasBurning) players.push(plr);
		}

		const blocks: BlockModel[] = [];
		for (const p of Workspace.GetPartBoundsInRadius(position, radius, overlapParams)) {
			if (!LocalInstanceData.HasLocalTag(p, "Burn")) continue;
			const block = this.extinguish(p);
			if (block && !blocks.contains(block)) blocks.push(block);
		}

		return $tuple(blocks, players);
	}
	burn(part: BasePart, spreadChance: number = 0) {
		// Anchored parts shouldn't burn
		if (part.Anchored) return;
		if (LocalInstanceData.HasLocalTag(part, "Burn")) return;
		if (spreadChance <= 0) return; // ForceField, ice, etc. never catch
		LocalInstanceData.AddLocalTag(part, "Burn");
		if (CustomDebrisService.exists(part)) CustomDebrisService.remove(part);

		part.Color = color;
		// Apply fire effect
		this.fireEffect.send(part, { part });

		// Start draining HP while it burns — a block or a registered limb, both through the unified pipeline.
		// An unregistered part (no HP) simply drops out of burningState on the first burn tick.
		const block = BlockManager.tryGetBlockModelByPart(part);
		this.blockDamageController.markBurning(block ?? part);

		if (!part.Parent) return;
		if (!part.CanSetNetworkOwnership()[0]) return;

		// minimal threshold
		if (spreadChance < 0.001) return;
		if (!tryChance(spreadChance)) return;

		const plotFolder = block?.Parent?.Parent as PlotModel;
		if (!plotFolder) return;

		this.plotSpreadParts.getOrSet(plotFolder, () => new Set<BasePart>()).add(part);
	}

	extinguish(part: BasePart): BlockModel | undefined {
		LocalInstanceData.RemoveLocalTag(part, "Burn");
		this.fireEffect.extinguish(part);

		const block = BlockManager.tryGetBlockModelByPart(part);
		this.blockDamageController.unmarkBurning(block ?? part);
		if (block) this.plotSpreadParts.get(block.Parent?.Parent as PlotModel)?.delete(part);
		return block;
	}
}
