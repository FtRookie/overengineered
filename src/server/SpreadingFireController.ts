import { Players, Workspace } from "@rbxts/services";
import { Materials } from "engine/shared/data/Materials";
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

const tryChance = (chance: number) => math.random() < chance;

// Apply color
const darkness = math.random(0, 50);
const color = Color3.fromRGB(darkness, darkness, darkness);
@injectable
export class SpreadingFireController extends HostedService {
	private readonly pendingThreads = new Map<PlotModel, Set<thread>>();
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
			for (const t of this.pendingThreads.get(plot) ?? new Set()) task.cancel(t);
		});

		// extinguisher detonations; teardown lives here — the shared bomb handler can't reach unmarkBurning
		this.event.subscribe(RemoteEvents.Extinguish.invoked, (player, { part, radius }) => {
			if (!part) return;
			const [blocks, players] = this.extinguishArea(part.Position, math.clamp(radius, 0, MAX_EXTINGUISH_RADIUS));
			if (!blocks.isEmpty() || !players.isEmpty()) this.extinguished.Fire(player, blocks, players);
		});
	}

	/** Extinguish every burning part within `radius` studs; returns the affected blocks and players (deduped). */
	extinguishArea(position: Vector3, radius: number): LuaTuple<[blocks: BlockModel[], players: Player[]]> {
		const blocks: BlockModel[] = [];
		for (const p of Workspace.GetPartBoundsInRadius(position, radius, overlapParams)) {
			if (!LocalInstanceData.HasLocalTag(p, "Burn")) continue;
			const block = this.extinguish(p);
			if (block && !blocks.contains(block)) blocks.push(block);
		}

		// limbs aren't in the Blocks collision group — sweep characters directly
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

		return $tuple(blocks, players);
	}

	burn(part: BasePart, spreadChance: number = 0) {
		// Anchored parts shouldn't burn
		if (part.Anchored) return;
		if (LocalInstanceData.HasLocalTag(part, "Burn")) return;
		// Spread ignites by chance regardless of material — block non-flammable ones (ForceField, ice).
		const ignitionChance =
			Materials.Properties[part.Material.Name]?.thermalProperties?.ignitionChance ??
			Materials.Properties.Default.thermalProperties!.ignitionChance!;
		if (ignitionChance <= 0) return;
		LocalInstanceData.AddLocalTag(part, "Burn");
		if (CustomDebrisService.exists(part)) CustomDebrisService.remove(part);

		part.Color = color;
		// Apply fire effect
		this.fireEffect.send(part, { part });

		// Start draining the block's HP while it burns.
		const block = BlockManager.tryGetBlockModelByPart(part);
		if (block) this.blockDamageController.markBurning(block);

		if (!part.Parent) return;
		if (!part.CanSetNetworkOwnership()[0]) return;

		// minimal threshold
		if (spreadChance < 0.001) return;
		if (!tryChance(spreadChance)) return;

		const plotFolder = block?.Parent?.Parent as PlotModel;
		if (!plotFolder) return;

		const thread = task.delay(math.random() * 3 + 1, () => {
			// Bail if the source part has been destroyed (mode change rebuilt the plot,
			// player left, etc.) — its Position would otherwise be stale.
			if (!part.Parent) return;
			// Burn closest parts (recursive with decaying chance)
			const closestParts = Workspace.GetPartBoundsInRadius(part.Position, 4, overlapParams);
			part.GetTouchingParts().forEach((v) => closestParts.push(v));

			for (const p of closestParts) {
				if (!tryChance(spreadChance)) continue;
				this.burn(p, spreadChance * 0.7);
			}
		});

		this.pendingThreads.getOrSet(plotFolder, () => new Set<thread>()).add(thread);
	}

	extinguish(part: BasePart): BlockModel | undefined {
		LocalInstanceData.RemoveLocalTag(part, "Burn");
		this.fireEffect.extinguish(part);

		const block = BlockManager.tryGetBlockModelByPart(part);
		if (block) this.blockDamageController.unmarkBurning(block);
		return block;
	}
}
