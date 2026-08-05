import { Players, Workspace } from "@rbxts/services";
import { BlockManager } from "shared/building/BlockManager";

const PRESSURE_TO_VELOCITY = 1 / 40;

const params = new RaycastParams();
params.IgnoreWater = true;

type Push = { readonly part: BasePart; readonly velocity: Vector3 };

export namespace BlastImpulse {
	/**
	 * Throws the local player's blocks away from an explosion, skipping any the blast cannot see.
	 *
	 * Runs on the owning client: ride mode hands every block's network ownership to its player
	 * (`ServerPartUtils.switchDescendantsNetworkOwner`), and a write to an assembly the writer does not own
	 * never reaches the peer simulating it — which is why the old server-side push did nothing.
	 */
	export function apply(epicenter: Vector3, radius: number, pressure: number): readonly BlockModel[] {
		const affected: BlockModel[] = [];
		if (radius <= 0 || pressure <= 0) return affected;

		const localPlayer = Players.LocalPlayer;
		const character = localPlayer.Character;
		// the rider sits inside the machine and would otherwise shadow half of it
		params.ExcludeInstances = character ? [character] : undefined;

		const seen = new Set<BlockModel>();
		const byAssembly = new Map<BasePart, Push[]>();
		for (const part of Workspace.GetPartBoundsInRadius(epicenter, radius)) {
			if (!BlockManager.isActiveBlockPart(part)) continue;

			const model = BlockManager.tryGetBlockModelByPart(part);
			if (!model) continue;

			const offset = part.Position.sub(epicenter);
			const distance = offset.Magnitude;
			if (distance >= radius || distance < 0.01) continue;

			const hit = Workspace.Raycast(epicenter, offset, params);
			// matched on the model rather than the part: a ray at a part's centre often lands on a sibling
			// colbox first, which still means the block is exposed
			if (!hit || BlockManager.tryGetBlockModelByPart(hit.Instance) !== model) continue;

			// Reported for every owner: the server's own query runs against replicated positions, which lag for
			// anyone's moving machine, so this is what it would otherwise miss.
			if (!seen.has(model)) {
				seen.add(model);
				affected.push(model);
			}

			// Only pushed for our own, though — an impulse on an assembly this client does not simulate is
			// discarded by the engine anyway.
			if (model.Parent?.Parent?.GetAttribute("ownerid") !== localPlayer.UserId) continue;

			const root = part.AssemblyRootPart;
			if (!root) continue;

			const falloff = 1 - distance / radius;
			const velocity = offset.Unit.mul(pressure * PRESSURE_TO_VELOCITY * falloff * falloff);
			byAssembly.getOrSet(root, () => []).push({ part, velocity });
		}

		// Scaled by the assembly's own mass so a build gains the same speed however heavy it is. A plain
		// impulse is mass-independent, which reads as nothing at all once a machine is a few thousand mass:
		// exposure grows with surface area while mass grows with volume. Divided by the number of exposed
		// parts because each one contributes a full share, and they would otherwise multiply.
		for (const [root, pushes] of byAssembly) {
			const scale = root.AssemblyMass / pushes.size();
			for (const { part, velocity } of pushes) {
				part.ApplyImpulseAtPosition(velocity.mul(scale), part.Position);
			}
		}

		return affected;
	}
}
