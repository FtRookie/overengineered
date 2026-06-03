import { Workspace } from "@rbxts/services";
import { Materials } from "engine/shared/data/Materials";
import { HostedService } from "engine/shared/di/HostedService";
import { LocalInstanceData } from "engine/shared/LocalInstanceData";
import { BlockManager } from "shared/building/BlockManager";
import { CustomRemotes } from "shared/Remotes";
import { CustomDebrisService } from "shared/service/CustomDebrisService";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { ServerBlockDamageController } from "server/ServerBlockDamageController";
import type { SharedPlots } from "shared/building/SharedPlots";
import type { FireEffect } from "shared/effects/FireEffect";

const overlapParams = new OverlapParams();
overlapParams.CollisionGroup = "Blocks"; // todo: change checks for colboxes in fire controller and use "ColBoxExclusive" here

const tryChance = (chance: number) => math.random() < chance;

// Apply color
const darkness = math.random(0, 50);
const color = Color3.fromRGB(darkness, darkness, darkness);
@injectable
export class SpreadingFireController extends HostedService {
	private readonly pendingThreads = new Map<PlotModel, Set<thread>>();
	static instance?: SpreadingFireController;

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

	extinguish(part: BasePart) {
		LocalInstanceData.RemoveLocalTag(part, "Burn");
		this.fireEffect.extinguish(part);

		const block = BlockManager.tryGetBlockModelByPart(part);
		if (block) this.blockDamageController.unmarkBurning(block);
	}
}
