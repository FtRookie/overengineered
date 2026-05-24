import { Workspace } from "@rbxts/services";
import { LocalInstanceData } from "engine/shared/LocalInstanceData";
import { CustomDebrisService } from "shared/service/CustomDebrisService";
import type { FireEffect } from "shared/effects/FireEffect";

const overlapParams = new OverlapParams();
overlapParams.CollisionGroup = "Blocks";

const tryChance = (chance: number) => chance < math.random();

// Apply color
const darkness = math.random(0, 50);
const color = Color3.fromRGB(darkness, darkness, darkness);
@injectable
export class SpreadingFireController {
	constructor(@inject private readonly fireEffect: FireEffect) {}

	burn(part: BasePart, spreadChance: number = 0) {
		LocalInstanceData.AddLocalTag(part, "Burn");
		if (CustomDebrisService.exists(part)) CustomDebrisService.remove(part);

		part.Color = color;
		// Apply fire effect
		this.fireEffect.send(part, { part });

		if (!part.Parent) return;
		if (!part.CanSetNetworkOwnership()[0]) return;

		// minimal threshold
		if (spreadChance < 0.001) return;
		if (!tryChance(spreadChance)) return;

		// Burn closest parts
		const closestParts = Workspace.GetPartBoundsInRadius(part.Position, 3.5, overlapParams);
		for (const p of closestParts) {
			if (!tryChance(spreadChance / 2)) continue;
			this.fireEffect.send(p, { part: p });
		}
	}

	extinguish(part: BasePart) {
		LocalInstanceData.RemoveLocalTag(part, "Burn");
		this.fireEffect.extinguish(part);
	}
}
