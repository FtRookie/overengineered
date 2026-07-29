import { RunService } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { BlockManager } from "shared/building/BlockManager";
import { TagUtils } from "shared/utils/TagUtils";
import type { BlockDamageController } from "engine/shared/BlockDamageController";

/**
 * How much of a sliding contact counts as impact. Grinding along a surface does damage, but nothing like
 * hitting it — and unlike a head-on hit, a scrape re-scores every frame the contact persists.
 */
const SCRAPE_SCALE = 0.3;
/** Below this the aim point landed inside the part and there is no usable normal to split against. */
const NORMAL_EPSILON = 0.01;
/** Seconds between rebuilds of the assembly list, so a break that re-forms assemblies is picked up. */
const ROOT_RESCAN = 0.5;

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
	private readonly tracked = new Set<BasePart>();
	private readonly roots: BasePart[] = [];
	private readonly rootSeen = new Set<BasePart>();
	private readonly preLinear = new Map<BasePart, Vector3>();
	private readonly preAngular = new Map<BasePart, Vector3>();
	private nextRootScan = 0;

	constructor(
		blocks: readonly { readonly instance: BlockModel }[],
		@inject private readonly blockDamageController: BlockDamageController,
	) {
		super();

		this.event.subscribe(RunService.PreSimulation, () => this.snapshotAssemblies());
		this.event.subscribe(RunService.PostSimulation, () => this.processContacts());

		task.delay(0.1, () => {
			for (const block of blocks) {
				this.subscribeOnBlock(block);
			}
		});
	}

	private snapshotAssemblies() {
		const now = time();
		if (now >= this.nextRootScan) {
			this.nextRootScan = now + ROOT_RESCAN;

			table.clear(this.roots);
			this.rootSeen.clear();
			for (const part of this.tracked) {
				if (part.Parent === undefined) {
					this.tracked.delete(part);
					continue;
				}

				const root = part.AssemblyRootPart;
				if (!root || this.rootSeen.has(root)) continue;

				this.rootSeen.add(root);
				this.roots.push(root);
			}
		}

		this.preLinear.clear();
		this.preAngular.clear();
		for (const root of this.roots) {
			if (root.Parent === undefined) continue;

			this.preLinear.set(root, root.AssemblyLinearVelocity);
			this.preAngular.set(root, root.AssemblyAngularVelocity);
		}
	}

	private velocityBefore(p: BasePart, at: Vector3): Vector3 {
		const root = p.AssemblyRootPart;
		const linear = (root === undefined ? undefined : this.preLinear.get(root)) ?? p.AssemblyLinearVelocity;
		const angular = (root === undefined ? undefined : this.preAngular.get(root)) ?? p.AssemblyAngularVelocity;

		return linear.add(angular.Cross(at.sub(p.AssemblyCenterOfMass)));
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

		this.tracked.add(part);

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
				const toward = referencePointFor(part, hit);
				const contact = closestPointOnBox(part, toward);
				// const contact = part.GetClosestPointOnSurface(referencePointFor(part, hit));
				const relative = this.velocityBefore(part, contact).sub(this.velocityBefore(hit, contact));

				// `toward` sits inside the other body and `contact` on this part's surface, so the gap between
				// them is the outward normal. Splitting against it separates hitting a surface from sliding
				// along one; the whole magnitude scored both the same. A degenerate normal means the aim point
				// landed inside the part, and there is nothing to split against.
				const outward = toward.sub(contact);
				let speedDiff = relative.Magnitude;
				if (outward.Magnitude > NORMAL_EPSILON) {
					const normal = outward.Unit;
					const closing = relative.Dot(normal);
					const sliding = relative.sub(normal.mul(closing)).Magnitude;
					speedDiff = math.abs(closing) + sliding * SCRAPE_SCALE;
				}

				this.blockDamageController.applyDamage(block, {
					impactDamage: speedDiff,
					// heatDamage: 0.01 * airModifier, // 0.1 (10%) is just a chance of ignition
				});
			}
		}

		this.touchedThisFrame.clear();
	}
}
