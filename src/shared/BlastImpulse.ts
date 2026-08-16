import { Players, Workspace } from "@rbxts/services";
import { BlockManager } from "shared/building/BlockManager";
import { RemoteEvents } from "shared/RemoteEvents";
import { SharedRagdoll } from "shared/SharedRagdoll";
import { PartUtils } from "shared/utils/PartUtils";

const PRESSURE_TO_VELOCITY = 1 / 10;

/**
 * Built on first use rather than at import. The Lune shim stubs Instance, Vector3, CFrame and friends but not
 * RaycastParams, so constructing one at module scope made every block importing this fail to load in the
 * headless checks — nine of them, the whole Weaponry tree included.
 */
let params: RaycastParams | undefined;
const raycastParams = () => {
	if (!params) {
		params = new RaycastParams();
		params.IgnoreWater = true;
	}

	return params;
};

type Push = { readonly part: BasePart; readonly velocity: Vector3 };
/** distance the sender measured to the block */
export type BlastHit = { readonly block: BlockModel; readonly distance: number };

export namespace BlastImpulse {
	// Deferred: a blast that ragdolls or kills the character swaps its joints a moment later, resetting any
	// velocity applied first. Wait for the verdict — ragdoll, death, or a ping-timeout if it survives — then shove.
	export function applyToCharacter(epicenter: Vector3, radius: number, pressure: number) {
		if (radius <= 0 || pressure <= 0) return;

		const character = Players.LocalPlayer.Character;
		const root = character?.PrimaryPart;
		const humanoid = character?.FindFirstChildOfClass("Humanoid");
		if (!character || !root || !humanoid) return;

		const offset = root.Position.sub(epicenter);
		const distance = offset.Magnitude;
		if (distance >= radius || distance < 0.01) return;

		const params = raycastParams();
		params.ExcludeInstances = [character];
		if (Workspace.Raycast(epicenter, offset, params)) return;

		const falloff = 1 - distance / radius;
		const velocity = offset.Unit.mul(pressure * PRESSURE_TO_VELOCITY * falloff * falloff);

		task.spawn(() => {
			const verdictDeadline = time() + Players.LocalPlayer.GetNetworkPing() * 2;
			while (!SharedRagdoll.isPlayerRagdolling(humanoid) && humanoid.Health > 0 && time() < verdictDeadline) {
				task.wait();
			}

			if (SharedRagdoll.isPlayerRagdolling(humanoid) || humanoid.Health <= 0) task.wait();
			if (!character.IsDescendantOf(Workspace)) return;

			const seen = new Set<BasePart>();
			for (const part of character.GetDescendants()) {
				if (!part.IsA("BasePart")) continue;

				const assemblyRoot = part.AssemblyRootPart;
				if (!assemblyRoot || seen.has(assemblyRoot)) continue;
				seen.add(assemblyRoot);
				if (!assemblyRoot.IsDescendantOf(character)) continue;

				assemblyRoot.AssemblyLinearVelocity = assemblyRoot.AssemblyLinearVelocity.add(velocity);
			}
		});
	}

	export function apply(
		epicenter: Vector3,
		radius: number,
		pressure: number,
		withPush = true,
		breakWelds = false,
	): readonly BlastHit[] {
		const affected: BlastHit[] = [];
		if (radius <= 0 || pressure <= 0) return affected;

		const localPlayer = Players.LocalPlayer;
		const character = localPlayer.Character;
		// the rider sits inside the machine and would otherwise shadow half of it
		const params = raycastParams();
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

			// damage list — built before the LOS test, all owners: damage ignores cover. distance rides along
			// because the server's replicated positions lag, so falloff is measured from ours, not its own
			if (!seen.has(model)) {
				seen.add(model);
				affected.push({ block: model, distance });
			}

			if (!withPush) continue;

			// push respects cover, so a shielded block is damaged but not thrown
			const hit = Workspace.Raycast(epicenter, offset, params);
			// match the model, not the part: a centre ray often hits a sibling colbox first, still exposed
			if (!hit || BlockManager.tryGetBlockModelByPart(hit.Instance) !== model) continue;

			// our own only: the engine discards an impulse on an assembly this client doesn't simulate
			if (model.Parent?.Parent?.GetAttribute("ownerid") !== localPlayer.UserId) continue;

			const root = part.AssemblyRootPart;
			if (!root) continue;

			const falloff = 1 - distance / radius;
			const velocity = offset.Unit.mul(pressure * PRESSURE_TO_VELOCITY * falloff * falloff);
			byAssembly.getOrSet(root, () => []).push({ part, velocity });
		}

		if (breakWelds) {
			// snap the exposed parts loose so the impulse hits free parts, not the welded machine; the server
			// re-breaks them via the same ImpactBreak path
			const broken: BasePart[] = [];
			for (const [, pushes] of byAssembly) {
				for (const { part } of pushes) {
					PartUtils.BreakJoints(part);
					broken.push(part);
				}
			}
			if (!broken.isEmpty()) RemoteEvents.ImpactBreak.send(broken);

			// each part is its own assembly now, so its own mass gives it the falloff velocity directly
			for (const [, pushes] of byAssembly) {
				for (const { part, velocity } of pushes) {
					part.ApplyImpulseAtPosition(velocity.mul(part.AssemblyMass), part.Position);
				}
			}

			return affected;
		}

		// scale by assembly mass so speed is mass-independent (area grows as surface, mass as volume, so a plain
		// impulse vanishes past a few thousand mass). divide by exposed parts — each contributes a full share
		for (const [root, pushes] of byAssembly) {
			const scale = root.AssemblyMass / pushes.size();
			for (const { part, velocity } of pushes) {
				part.ApplyImpulseAtPosition(velocity.mul(scale), part.Position);
			}
		}

		return affected;
	}
}
