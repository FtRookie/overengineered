import { C2SRemoteEvent } from "engine/shared/event/PERemoteEvent";

export namespace SharedRagdoll {
	export const event = new C2SRemoteEvent<boolean>("ragdoll_trigger");
	const ragdollAttributeName = "Radgoll";

	export function subscribeToPlayerRagdollChange(humanoid: Humanoid, func: () => void): RBXScriptConnection {
		return humanoid.GetAttributeChangedSignal(ragdollAttributeName).Connect(func);
	}

	/** @server */
	export function setPlayerRagdoll(humanoid: Humanoid, ragdolling: boolean): void {
		humanoid.SetAttribute(ragdollAttributeName, ragdolling);
	}
	export function isPlayerRagdolling(humanoid: Humanoid): boolean {
		return humanoid.GetAttribute(ragdollAttributeName) === true;
	}

	/** True once both upper-leg joints are dismembered — the character can no longer stand. */
	export function isLegless(character: Model): boolean {
		let leftGone = false;
		let rightGone = false;
		for (const joint of character.GetDescendants()) {
			if (!joint.IsA("Motor6D") || joint.GetAttribute("Dismembered") !== true) continue;

			// Upper-leg root only (R15 "…UpperLeg", R6 "… Leg"); a lost lower leg / foot doesn't stop you standing.
			const limb = joint.Part1;
			if (!limb || !limb.Name.contains("Leg") || limb.Name.contains("Lower")) continue;
			if (limb.Name.contains("Left")) leftGone = true;
			else if (limb.Name.contains("Right")) rightGone = true;
		}
		return leftGone && rightGone;
	}
}
