import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type {
	BlockLogicFullBothDefinitions,
	GenericBlockLogic,
	InstanceBlockLogicArgs,
} from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults, BlockLogicInfo } from "shared/blocks/Block";

const definition = {
	input: {
		enabled: {
			displayName: "Enabled",
			tooltip: "Disables aerodynamic properties if you are a fan of using this block for other purposes",
			types: {
				bool: {
					config: true,
				},
			},
			connectorHidden: true,
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type WingBlock = BlockModel & {
	readonly WingSurface:
		| BasePart
		| (UnionOperation & {
				readonly VectorForce: VectorForce;
		  });
};

export type { Logic as WingsBlockLogic };

@injectable
class Logic extends InstanceBlockLogic<typeof definition, WingBlock> {
	private readonly part;
	private liftForce: number = 6000;

	constructor(block: InstanceBlockLogicArgs, @tryInject playerData?: PlayerDataStorage) {
		super(definition, block);

		this.part = this.instance.WingSurface;

		if (!playerData?.config.get().physics.simplified_aerodynamics) {
			this.part.EnableFluidForces = true;
			return;
		}

		this.onkFirstInputs(["enabled"], ({ enabled }) => {
			if (!enabled) {
				this.part.EnableFluidForces = false;
				this.disable();
				return;
			}

			// Create force constraints
			const attachment = new Instance("Attachment", this.part);
			const vectorForce = new Instance("VectorForce", this.part);
			vectorForce.RelativeTo = Enum.ActuatorRelativeTo.Attachment0;
			vectorForce.Attachment0 = attachment;

			// Set up wing material properties
			const density = math.max(0.7, new PhysicalProperties(this.part.Material).Density / 2);
			this.part.CustomPhysicalProperties = new PhysicalProperties(density, 0.3, 0.5, 1, 1);

			this.event.subscribe(RunService.Heartbeat, (dt) => {
				const wing = this.instance.FindFirstChild("WingSurface") as BasePart | undefined;
				if (!wing) return;

				const currentLiftForce = this.liftForce;

				const mass = wing.AssemblyMass;
				const position = wing.Position;
				const velocity = wing.AssemblyLinearVelocity;
				const localVelocity = wing.CFrame.PointToObjectSpace(position.add(velocity));

				if (!localVelocity) return;

				const VelocityMultiplier = 0.2;
				const localVerticalVelocity = localVelocity.Y;
				const localHorizontalVelocity =
					math.sqrt(localVelocity.X ** 2 + localVelocity.Z ** 2) * VelocityMultiplier;
				let speedMultiplier = math.abs(localHorizontalVelocity * VelocityMultiplier);
				speedMultiplier = math.clamp(speedMultiplier, 0, 1);

				if (speedMultiplier > 0) {
					const forceDirection = new Vector3(0, -localVerticalVelocity, 0);
					const forceMagnitude = (mass * speedMultiplier * currentLiftForce) / 4;
					const force = forceDirection.mul(forceMagnitude).Unit.mul(forceMagnitude);

					vectorForce.Force = force;
					vectorForce.Enabled = true;
				} else {
					vectorForce.Enabled = false;
				}
			});
		});
	}

	initializeInputs(config: PlacedBlockConfig, allBlocks: ReadonlyMap<BlockUuid, GenericBlockLogic>): void {
		super.initializeInputs(config, allBlocks);
	}
}

const logic: BlockLogicInfo = { definition, ctor: Logic };
const list: BlockBuildersWithoutIdAndDefaults = {
	wing1x1: {
		displayName: "Wing 1x1",
		description: "A part with advanced aerodynamic properties",
		logic,
		mirror: {
			behaviour: "wedgeWing",
		},
	},
	wing1x2: {
		displayName: "Wing 1x2",
		description: "A part with advanced aerodynamic properties but a bit longer",
		logic,
		mirror: {
			behaviour: "wedgeWing",
		},
	},
	wing1x3: {
		displayName: "Wing 1x3",
		description: "A part with advanced aerodynamic properties but two bits longer",
		logic,
		mirror: {
			behaviour: "wedgeWing",
		},
	},
	wing1x4: {
		displayName: "Wing 1x4",
		description: "A part with advanced aerodynamic properties but the joke is overused",
		logic,
		mirror: {
			behaviour: "wedgeWing",
		},
	},
	wedgewing1x1: {
		displayName: "Wedge Wing 1x1",
		description: "A wedge shaped wing",
		logic,
		mirror: {
			behaviour: "wedgeWing",
		},
	},
	wedgewing1x2: {
		displayName: "Wedge Wing 1x2",
		description: "A wedge shaped wing but longer",
		logic,
		mirror: {
			behaviour: "wedgeWing",
		},
	},
	wedgewing1x3: {
		displayName: "Wedge Wing 1x3",
		description: "A wedge shaped wing but much longer",
		logic,
		mirror: {
			behaviour: "wedgeWing",
		},
	},
	wedgewing1x4: {
		displayName: "Wedge Wing 1x4",
		description: "A humongously long wedge shaped wing",
		logic,
		mirror: {
			behaviour: "wedgeWing",
		},
	},
};
export const WingBlocks = BlockCreation.arrayFromObject(list);
