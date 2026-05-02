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

RunService.Heartbeat.Connect(() => {
	const ch = player?.Character;
	if (!ch) return;
	airModifier = Physics.GetAirDensityModifierOnHeight(Physics.LocalHeight.fromGlobal(ch.GetPivot().Position.Y));
});

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
		// init health
		this.blockDamageController.initHealth(block.instance);

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

			// Compute magnitudes
			const partSpeed = part.AssemblyLinearVelocity.Magnitude + part.AssemblyAngularVelocity.Magnitude;
			const secondPartSpeed = hit.AssemblyLinearVelocity.Magnitude + hit.AssemblyAngularVelocity.Magnitude;

			const speedDiff = math.abs(partSpeed - secondPartSpeed);

			this.blockDamageController.applyDamage(block, {
				impactDamage: speedDiff,
				heatDamage: 0.1 * airModifier, // 0.1 (10%) is just a chance of ignition
			});
		});
	}
}
