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

const MAX_EXTINGUISH_RADIUS = ExtinguisherBombBlock.logic.definition.input.radius.types.number.clamp.max;
const MIN_SPREAD_CHANCE = 0.001; // below this a part burns without ever spreading

const PlayerIgnite = {
	radius: 4, // studs
	interval: 1, // seconds between sweeps
	spreadChance: 0.3,
} as const;

const tryChance = (chance: number) => math.random() < chance;

@injectable
export class SpreadingFireController extends HostedService {
	static instance?: SpreadingFireController;

	private readonly plotSpreadParts = new Map<PlotModel, Set<BasePart>>();

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

		this.event.subscribe(RemoteEvents.Extinguish.invoked, (player, { part, radius }) => {
			if (!part) return;
			const [blocks, players] = this.extinguishArea(part.Position, math.clamp(radius, 0, MAX_EXTINGUISH_RADIUS));
			if (!blocks.isEmpty() || !players.isEmpty()) this.extinguished.Fire(player, blocks, players);
		});

		this.event.subscribe(this.blockDamageController.blockBurnedOut, (block) => {
			const clear = (part: BasePart) => {
				LocalInstanceData.RemoveLocalTag(part, "Burn");
				this.fireEffect.extinguish(part);
			};

			if (block.IsA("BasePart")) clear(block);
			for (const part of block.GetDescendants()) {
				if (part.IsA("BasePart")) clear(part);
			}
		});

		this.event.loop(PlayerIgnite.interval, () => {
			for (const plr of Players.GetPlayers()) {
				const character = plr.Character;
				const root = character?.PrimaryPart;
				if (!root) continue;

				if (this.blockDamageController.getHealth(root) === undefined) continue;
				if (!this.blockDamageController.isPvpEnabled(plr.UserId)) continue;

				for (const p of Workspace.GetPartBoundsInRadius(root.Position, PlayerIgnite.radius, overlapParams)) {
					if (!LocalInstanceData.HasLocalTag(p, "Burn")) continue;
					for (const limb of character.GetChildren()) {
						if (limb.IsA("BasePart")) this.burn(limb, PlayerIgnite.spreadChance);
					}
					break;
				}
			}
		});
	}

	/** Returns the affected blocks and players (deduped). */
	extinguishArea(position: Vector3, radius: number): LuaTuple<[blocks: BlockModel[], players: Player[]]> {
		const players: Player[] = [];
		for (const plr of Players.GetPlayers()) {
			const char = plr.Character;
			if (!char) continue;
			const root = char.PrimaryPart;
			if (!root || root.Position.sub(position).Magnitude > radius) continue;

			if (this.extinguishPlayer(plr)) players.push(plr);
		}

		const blocks: BlockModel[] = [];
		for (const p of Workspace.GetPartBoundsInRadius(position, radius, overlapParams)) {
			if (!LocalInstanceData.HasLocalTag(p, "Burn")) continue;
			const block = this.extinguish(p);
			if (block && !blocks.contains(block)) blocks.push(block);
		}

		return $tuple(blocks, players);
	}
	/** Puts out every burning limb on a character. Returns whether anything was alight to begin with. */
	extinguishPlayer(player: Player): boolean {
		const character = player.Character;
		if (!character) return false;

		let wasBurning = false;
		for (const limb of character.GetDescendants()) {
			if (!limb.IsA("BasePart")) continue;
			if (!LocalInstanceData.HasLocalTag(limb, "Burn")) continue;

			this.extinguish(limb);
			wasBurning = true;
		}

		return wasBurning;
	}

	burn(part: BasePart, spreadChance: number = 0) {
		if (part.Anchored) return;
		if (LocalInstanceData.HasLocalTag(part, "Burn")) return;
		if (spreadChance <= 0) return;
		LocalInstanceData.AddLocalTag(part, "Burn");
		if (CustomDebrisService.exists(part)) CustomDebrisService.remove(part);

		const darkness = math.random(0, 50);
		part.Color = Color3.fromRGB(darkness, darkness, darkness);
		this.fireEffect.send(part, { part });

		const block = BlockManager.tryGetBlockModelByPart(part);
		this.blockDamageController.markBurning(block ?? part);

		if (!part.Parent) return;
		if (!part.CanSetNetworkOwnership()[0]) return;

		if (spreadChance < MIN_SPREAD_CHANCE) return;
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
