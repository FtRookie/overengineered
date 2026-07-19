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

	constructor(
		blocks: readonly { readonly instance: BlockModel }[],
		@inject private readonly blockDamageController: BlockDamageController,
	) {
		super();

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

		part.Touched.Connect((hit: BasePart | Terrain) => {
			// Optimization (do nothing for non-connected blocks)
			if (part.AssemblyMass === part.Mass) {
				// I kinda see a flaw in that logic but alright
				// - @samlovebutter
				return;
			}

			// Do nothing for non-collidable blocks
			if (!hit.CanCollide) return;

			// How fast the two surfaces are actually converging, measured AT the contact.
			//
			// This used to add angular velocity straight onto linear — rad/s onto studs/s, quantities that
			// cannot be summed. It barely showed on most blocks and was ruinous for wheels, which spin by
			// definition: a wheel simply rolling along scored hundreds of phantom studs/s, took impact
			// damage every time Touched fired, heated up and caught fire. Players then ignited from their
			// own burning wheels, which is why it looked like they were combusting for no reason.
			//
			// `v + ω × r` needs r as a VECTOR to the contact point, never a radius — a wheel is not a
			// sphere and an ellipsoid has no single radius to substitute. It also gets the physics right
			// for free: a wheel rolling without slipping has a stationary contact patch, so this reads
			// zero, and only skidding or slamming produces a number.
			const contact = part.GetClosestPointOnSurface(referencePointFor(part, hit));
			const speedDiff = velocityAt(part, contact).sub(velocityAt(hit, contact)).Magnitude;

			this.blockDamageController.applyDamage(block, {
				impactDamage: speedDiff,
				// heatDamage: 0.01 * airModifier, // 0.1 (10%) is just a chance of ignition
			});
		});
	}
}
