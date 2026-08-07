import { Players, Workspace } from "@rbxts/services";
import { BlockManager } from "shared/building/BlockManager";
import { RemoteEvents } from "shared/RemoteEvents";
import { SharedRagdoll } from "shared/SharedRagdoll";
import { PartUtils } from "shared/utils/PartUtils";

const PRESSURE_TO_VELOCITY = 1 / 10;

const params = new RaycastParams();
params.IgnoreWater = true;

type Push = { readonly part: BasePart; readonly velocity: Vector3 };
/** One block the blast reached, with the distance the sender measured to it. */
export type BlastHit = { readonly block: BlockModel; readonly distance: number };

export namespace BlastImpulse {
	/**
	 * Throws the local player's character away from an explosion. Runs on the owning client, like the block push.
	 *
	 * The impulse is deferred: a blast that kills or ragdolls this character swaps its joints moments later,
	 * which re-forms the assemblies and resets any velocity applied before the swap. The shove waits for that
	 * verdict — ragdoll, death, or a round-trip timeout for a character the blast left standing — and lands
	 * after it.
	 */
	export function applyToCharacter(epicenter: Vector3, radius: number, pressure: number) {
		if (radius <= 0 || pressure <= 0) return;

		const character = Players.LocalPlayer.Character;
		const root = character?.PrimaryPart;
		const humanoid = character?.FindFirstChildOfClass("Humanoid");
		if (!character || !root || !humanoid) return;

		const offset = root.Position.sub(epicenter);
		const distance = offset.Magnitude;
		if (distance >= radius || distance < 0.01) return;

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

			// Reported before the line-of-sight test, and for every owner: this list is what the blast damages,
			// and damage has never cared about shielding. The distance rides along because the server measures
			// against replicated positions, which lag for anyone's moving machine — one it reckons at or past
			// the radius would land on falloff 0 and take nothing.
			if (!seen.has(model)) {
				seen.add(model);
				affected.push({ block: model, distance });
			}

			if (!withPush) continue;

			// The push is the half that respects cover, so a shielded block is damaged but not thrown.
			const hit = Workspace.Raycast(epicenter, offset, params);
			// matched on the model rather than the part: a ray at a part's centre often lands on a sibling
			// colbox first, which still means the block is exposed
			if (!hit || BlockManager.tryGetBlockModelByPart(hit.Instance) !== model) continue;

			// Only pushed for our own, though — an impulse on an assembly this client does not simulate is
			// discarded by the engine anyway.
			if (model.Parent?.Parent?.GetAttribute("ownerid") !== localPlayer.UserId) continue;

			const root = part.AssemblyRootPart;
			if (!root) continue;

			const falloff = 1 - distance / radius;
			const velocity = offset.Unit.mul(pressure * PRESSURE_TO_VELOCITY * falloff * falloff);
			byAssembly.getOrSet(root, () => []).push({ part, velocity });
		}

		if (breakWelds) {
			// This client is authoritative over its own parts: the exposed ones snap loose right here, so the
			// impulse lands on free parts instead of dragging the welded machine. The server re-breaks them
			// authoritatively through the same ImpactBreak path the motor blocks use.
			const broken: BasePart[] = [];
			for (const [, pushes] of byAssembly) {
				for (const { part } of pushes) {
					PartUtils.BreakJoints(part);
					broken.push(part);
				}
			}
			if (!broken.isEmpty()) RemoteEvents.ImpactBreak.send(broken);

			// Every part is its own assembly now, so scaling by its own mass hands each one its falloff
			// velocity directly.
			for (const [, pushes] of byAssembly) {
				for (const { part, velocity } of pushes) {
					part.ApplyImpulseAtPosition(velocity.mul(part.AssemblyMass), part.Position);
				}
			}

			return affected;
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
