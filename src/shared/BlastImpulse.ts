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

// fixme: picked, not measured. How long past two round trips a blast is remembered: the server breaks a destroyed
// block a round trip after the push, plus the frames its damage and break queues take
const BROKEN_PUSH_SLACK = 0.5;

type Push = { readonly part: BasePart; readonly velocity: Vector3 };
type RecentBlast = {
	readonly epicenter: Vector3;
	readonly radius: number;
	readonly pressure: number;
	readonly cone: BlastCone | undefined;
	readonly expires: number;
};

/**
 * A blast limited to a cone: `direction` is a unit vector, the half-angle is given by its cosine, and the apex sits
 * `apexBehind` studs behind the epicenter along the direction
 */
export type BlastCone = { readonly direction: Vector3; readonly cosHalfAngle: number; readonly apexBehind: number };

/**
 * The cone of a charge whose part is `size` and fires out of its top face: the apex at the middle of the bottom face,
 * the sides through the top face's edge at half its shorter side, so the height is the depth of the cone
 */
export const blastConeOf = (direction: Vector3, size: Vector3): BlastCone => {
	const halfWidth = math.min(size.X, size.Z) / 2;
	const depth = size.Y;
	return {
		direction,
		cosHalfAngle: depth / math.sqrt(halfWidth * halfWidth + depth * depth),
		apexBehind: depth / 2,
	};
};

/** Whether something at `offset` from the epicenter is inside the cone; always true without one */
export const isInBlastCone = (cone: BlastCone | undefined, offset: Vector3) => {
	if (cone === undefined) return true;

	const fromApex = offset.add(cone.direction.mul(cone.apexBehind));
	return fromApex.Dot(cone.direction) >= fromApex.Magnitude * cone.cosHalfAngle;
};

const recentBlasts: RecentBlast[] = [];
// parts this client already broke loose and pushed, so a later server break does not push them twice
const pushedLoose = new Set<BasePart>();

const blastVelocity = (offset: Vector3, distance: number, radius: number, pressure: number) => {
	const falloff = 1 - distance / radius;
	return offset.Unit.mul(pressure * PRESSURE_TO_VELOCITY * falloff * falloff);
};

const rememberBlast = (epicenter: Vector3, radius: number, pressure: number, cone: BlastCone | undefined) => {
	const now = time();
	for (let i = recentBlasts.size() - 1; i >= 0; i--) {
		if (recentBlasts[i].expires <= now) recentBlasts.remove(i);
	}
	if (recentBlasts.isEmpty()) pushedLoose.clear();

	const expires = now + Players.LocalPlayer.GetNetworkPing() * 4 + BROKEN_PUSH_SLACK;
	recentBlasts.push({ epicenter, radius, pressure, cone, expires });
};
/** distance the sender measured to the block */
export type BlastHit = { readonly block: BlockModel; readonly distance: number };

export namespace BlastImpulse {
	// Deferred: a blast that ragdolls or kills the character swaps its joints a moment later, resetting any
	// velocity applied first. Wait for the verdict — ragdoll, death, or a ping-timeout if it survives — then shove.
	export function applyToCharacter(epicenter: Vector3, radius: number, pressure: number, cone?: BlastCone) {
		if (radius <= 0 || pressure <= 0) return;

		const character = Players.LocalPlayer.Character;
		const root = character?.PrimaryPart;
		const humanoid = character?.FindFirstChildOfClass("Humanoid");
		if (!character || !root || !humanoid) return;

		const offset = root.Position.sub(epicenter);
		const distance = offset.Magnitude;
		if (distance >= radius || distance < 0.01) return;
		if (!isInBlastCone(cone, offset)) return;

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
			PartUtils.applyToAllDescendantsOfType("BasePart", character, (part) => {
				const assemblyRoot = part.AssemblyRootPart;
				if (!assemblyRoot || seen.has(assemblyRoot)) return;
				seen.add(assemblyRoot);
				if (!assemblyRoot.IsDescendantOf(character)) return;

				assemblyRoot.AssemblyLinearVelocity = assemblyRoot.AssemblyLinearVelocity.add(velocity);
			});
		});
	}

	/**
	 * Gives one of this client's blocks the push of the strongest recent blast it sat in, once the server's break
	 * has replicated. A destroyed block is broken a round trip after the blast, so it would otherwise drop loose
	 * with none of the blast's velocity.
	 */
	export function pushBroken(block: BlockModel) {
		if (recentBlasts.isEmpty()) return;
		if (block.Parent?.Parent?.GetAttribute("ownerid") !== Players.LocalPlayer.UserId) return;

		const now = time();
		const center = block.GetPivot().Position;
		let strongest: RecentBlast | undefined;
		let strongestFalloff = 0;
		for (const blast of recentBlasts) {
			if (blast.expires <= now) continue;

			const offset = center.sub(blast.epicenter);
			const distance = offset.Magnitude;
			if (distance >= blast.radius) continue;
			if (!isInBlastCone(blast.cone, offset)) continue;

			const falloff = blast.pressure * (1 - distance / blast.radius) ** 2;
			if (falloff <= strongestFalloff) continue;
			strongest = blast;
			strongestFalloff = falloff;
		}
		if (!strongest) return;

		const { epicenter, radius, pressure, cone, expires } = strongest;
		const pending: BasePart[] = [];
		PartUtils.applyToAllDescendantsOfType("BasePart", block, (part) => {
			if (!pushedLoose.has(part)) pending.push(part);
		});

		task.spawn(() => {
			while (!pending.isEmpty() && time() < expires) {
				for (let i = pending.size() - 1; i >= 0; i--) {
					const part = pending[i];
					if (part.Parent !== undefined && !part.GetJoints().isEmpty()) continue;
					pending.remove(i);
					if (part.Parent === undefined) continue;

					const offset = part.Position.sub(epicenter);
					const distance = offset.Magnitude;
					if (distance >= radius || distance < 0.01) continue;
					if (!isInBlastCone(cone, offset)) continue;

					const velocity = blastVelocity(offset, distance, radius, pressure);
					part.ApplyImpulseAtPosition(velocity.mul(part.AssemblyMass), part.Position);
				}
				if (!pending.isEmpty()) task.wait();
			}
		});
	}

	export function apply(
		epicenter: Vector3,
		radius: number,
		pressure: number,
		withPush = true,
		breakWelds = false,
		cone?: BlastCone,
	): readonly BlastHit[] {
		const affected: BlastHit[] = [];
		if (radius <= 0 || pressure <= 0) return affected;
		rememberBlast(epicenter, radius, pressure, cone);

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
			if (!isInBlastCone(cone, offset)) continue;

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

			byAssembly
				.getOrSet(root, () => [])
				.push({ part, velocity: blastVelocity(offset, distance, radius, pressure) });
		}

		if (breakWelds) {
			// snap the exposed parts loose so the impulse hits free parts, not the welded machine; the server
			// re-breaks them via the same ImpactBreak path
			const broken: BasePart[] = [];
			for (const [, pushes] of byAssembly) {
				for (const { part } of pushes) {
					PartUtils.BreakJoints(part);
					broken.push(part);
					pushedLoose.add(part);
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
