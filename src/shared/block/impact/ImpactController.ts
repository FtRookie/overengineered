import { Players, RunService } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { Objects } from "engine/shared/fixes/Objects";
import { BlockManager } from "shared/building/BlockManager";
import { Physics } from "shared/Physics";
import { TagUtils } from "shared/utils/TagUtils";
import type { BlockDamageController } from "engine/shared/BlockDamageController";

const overlapParams = new OverlapParams();
overlapParams.CollisionGroup = "Blocks";

const materialStrength: { readonly [k in Enum.Material["Name"]]: number } = Objects.fromEntries(
	Enum.Material.GetEnumItems().map((material) => {
		const physicalProperties = new PhysicalProperties(material);
		const strongness = math.max(0.5, physicalProperties.Density / 3.5);
		$debug(`Strength of '${material.Name}' set to ${strongness}`);

		return [material.Name, strongness] as const;
	}),
);

const getVolume = (vector: Vector3) => vector.X * vector.Y * vector.Z;

const LIMB_IMPACT_MIN_SPEED = 30;

const player = Players.LocalPlayer;
let airModifier = 0;

RunService.PostSimulation.Connect(() => {
	const ch = player?.Character;
	if (!ch) return;
	airModifier = Physics.GetAirDensityModifierOnHeight(Physics.LocalHeight.fromGlobal(ch.GetPivot().Position.Y));
});

/**
 * Velocity of the point of `p` that currently sits at `at` — its assembly's linear motion plus whatever the
 * rotation contributes there.
 */
const velocityAt = (p: BasePart, at: Vector3) =>
	p.AssemblyLinearVelocity.add(p.AssemblyAngularVelocity.Cross(at.sub(p.AssemblyCenterOfMass)));

/**
 * Somewhere inside the other body, to aim GetClosestPointOnSurface at.
 *
 * Terrain is one enormous BasePart whose Position says nothing about where it was touched, so aiming at it
 * would put the contact on the wrong side of the block entirely. Straight down covers what actually meets
 * terrain — wheels, hulls, landing gear — and gravity makes it the usual case.
 *
 * The offset is the bounding diagonal, not the height: Size is in LOCAL axes, and a wheel is usually mounted
 * turned, so its local Y may be neither vertical nor large. Too short an offset lands the aim point INSIDE
 * the part, and the nearest surface to that is any face at all rather than the underside.
 */
const referencePointFor = (p: BasePart, hit: BasePart | Terrain) =>
	hit.IsA("Terrain") ? p.Position.sub(new Vector3(0, p.Size.Magnitude, 0)) : hit.Position;

/**
 * Closest point on `p`'s oriented bounding box to `ref`: clamp `ref` into the box's local half-extents. Pure
 * arithmetic, no spatial query — the analytic stand-in for GetClosestPointOnSurface. Keeps `v + ω × r`'s
 * contact-patch cancellation, but for a mesh/union it's the box, not the true surface (a small offset).
 */
const closestPointOnBox = (p: BasePart, ref: Vector3) => {
	const rel = p.CFrame.PointToObjectSpace(ref);
	const hx = p.Size.X / 2;
	const hy = p.Size.Y / 2;
	const hz = p.Size.Z / 2;
	return p.CFrame.PointToWorldSpace(
		new Vector3(math.clamp(rel.X, -hx, hx), math.clamp(rel.Y, -hy, hy), math.clamp(rel.Z, -hz, hz)),
	);
};

@injectable
export class ImpactController extends Component {
	static isImpactAllowed(part: BasePart) {
		if (
			!part.CanTouch ||
			!part.CanCollide ||
			part.IsA("VehicleSeat") ||
			math.max(part.Size.X, part.Size.Y, part.Size.Z) < 0.5
		) {
			return false;
		}
		return true;
	}

	/** Contacts seen this frame (part -> what it touched); Touched multifires, so damage is computed once per contact in processContacts. */
	private readonly touchedThisFrame = new Map<BasePart, Set<BasePart | Terrain>>();

	constructor(
		blocks: readonly { readonly instance: BlockModel }[],
		@inject private readonly blockDamageController: BlockDamageController,
	) {
		super();

		this.event.subscribe(RunService.PostSimulation, () => this.processContacts());

		task.delay(0.1, () => {
			for (const block of blocks) {
				this.subscribeOnBlock(block);
			}
		});
	}

	subscribeOnBlock(block: { readonly instance: BlockModel }) {
		// Health is initialised lazily on the server on first damage — nothing to do here.
		for (const part of block.instance.GetDescendants()) {
			if (!part.IsA("BasePart")) continue;
			if (!ImpactController.isImpactAllowed(part)) continue;

			this.subscribeOnBasePart(part);
		}
	}

	subscribeOnBasePart(part: BasePart) {
		// do nothing for disabled impact
		if (part.HasTag(TagUtils.allTags.IMPACT_UNBREAKABLE)) return;

		// do nothing for parts that's not even in ride mode
		if (!BlockManager.isActiveBlockPart(part)) return;

		// Optimization (do nothing for non-connected blocks)
		if (part.GetJoints().size() === 0) return;

		const block = part.Parent as BlockModel;
		if (!block) return;

		// Touched multifires per frame; only record the contact here and defer the heavy math to processContacts.
		this.event.subscribe(part.Touched, (hit: BasePart | Terrain) => {
			// Optimization (do nothing for non-connected blocks)
			if (part.AssemblyMass === part.Mass) {
				// I kinda see a flaw in that logic but alright
				// - @samlovebutter
				return;
			}

			// Do nothing for non-collidable blocks
			if (!hit.CanCollide) return;

			this.touchedThisFrame.getOrSet(part, () => new Set<BasePart | Terrain>()).add(hit);
		});
	}

	private processContacts() {
		for (const [part, hits] of this.touchedThisFrame) {
			const block = part.Parent as BlockModel;
			if (!block) continue;

			for (const hit of hits) {
				// How fast the two surfaces are actually converging, measured AT the contact. `v + ω × r` needs r as
				// a VECTOR to the contact point, never a radius: a wheel rolling without slipping has a stationary
				// contact patch, so this reads zero, and only skidding or slamming produces a number. Summing angular
				// onto linear as a scalar once scored phantom studs/s on rolling wheels and ignited their owners.
				//
				// fixme: contact is the oriented-bounding-box clamp (closestPointOnBox), not the exact surface, to
				// drop the per-contact GetClosestPointOnSurface spatial query. Revert to the commented line if impact
				// feel regresses.
				const contact = closestPointOnBox(part, referencePointFor(part, hit));
				// const contact = part.GetClosestPointOnSurface(referencePointFor(part, hit));
				const speedDiff = velocityAt(part, contact).sub(velocityAt(hit, contact)).Magnitude;

				this.blockDamageController.applyDamage(block, {
					impactDamage: speedDiff,
					// heatDamage: 0.01 * airModifier, // 0.1 (10%) is just a chance of ignition
				});

				if (
					speedDiff >= LIMB_IMPACT_MIN_SPEED &&
					hit.IsA("BasePart") &&
					hit.Parent?.FindFirstChildOfClass("Humanoid")
				) {
					this.blockDamageController.applyDamage(hit, { impactDamage: speedDiff });
				}
			}
		}

		this.touchedThisFrame.clear();
	}
}
