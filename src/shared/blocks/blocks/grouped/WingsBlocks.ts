import { RunService, Workspace } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { GameEnvironment } from "shared/data/GameEnvironment";
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

// Constants
// Aerodynamic force calculation: F = -ρ * A * v * CL
// Where: ρ = air density, A = wing area, v = velocity, CL = lift coefficient
const AIR_DENSITY_FACTOR = 2.0; // Air density at game altitude
const LIFT_COEFFICIENT = 2.5; // Lift coefficient for simple wing profile
const VELOCITY_SCALE = 4.0; // Velocity scaling factor for game physics
const FORCE_MULTIPLIER = -(AIR_DENSITY_FACTOR * LIFT_COEFFICIENT * VELOCITY_SCALE); // actually some kind of magic here so better not question it or you might break everything
const HEIGHT_FACTOR_EXPONENT = 2; // for h = 1 - (y/H)^exp

export type { Logic as WingsBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition, WingBlock> {
	constructor(block: InstanceBlockLogicArgs, @tryInject playerData?: PlayerDataStorage) {
		super(definition, block);

		const fluidForcesEnabled = !playerData?.config.get().physics.simplified_aerodynamics;
		if (fluidForcesEnabled) {
			this.instance.WingSurface.EnableFluidForces = true;
			return;
		}

		this.onkFirstInputs(["enabled"], ({ enabled }) => {
			if (!enabled) {
				this.instance.WingSurface.EnableFluidForces = false;
				this.disable();
				return;
			}

			// Create force constraints
			const attachment = new Instance("Attachment", this.instance.WingSurface);
			const vectorForce = new Instance("VectorForce", this.instance.WingSurface);
			vectorForce.RelativeTo = Enum.ActuatorRelativeTo.Attachment0;
			vectorForce.Attachment0 = attachment;

			// Set up wing material properties
			const density = math.max(0.7, new PhysicalProperties(this.instance.WingSurface.Material).Density / 2);
			this.instance.WingSurface.CustomPhysicalProperties = new PhysicalProperties(density, 0.3, 0.5, 1, 1);

			// Calculate wing surface area and dimensions
			const wing = this.instance.WingSurface;
			const wingArea = wing.Size.X * wing.Size.Z;

			// Calculate effective surface vector based on wing type
			let effectiveSurface: Vector3;
			if (wing.IsA("WedgePart")) {
				// Wedge wings: area acts as lift, divided by 2 for balance
				const thickness = wing.Size.X;
				effectiveSurface = new Vector3(wingArea, thickness, thickness).div(2);
			} else {
				// Regular wings: area acts perpendicular to wing surface
				const thickness = wing.Size.Y;
				effectiveSurface = new Vector3(thickness, wingArea, thickness);
			}

			this.event.subscribe(RunService.Heartbeat, () => {
				if (!this.instance.FindFirstChild("WingSurface")) {
					return;
				}

				const wing = this.instance.WingSurface;

				// Step 1: Calculate effective velocity including rotation
				// Linear velocity component
				const linearVelocity = wing.AssemblyLinearVelocity;

				// Angular velocity contribution: v = ω × r (cross product)
				// where r is the vector from center of mass to wing position
				const angularVelocity = wing.AssemblyAngularVelocity;
				const relativePosition = wing.Position.sub(wing.AssemblyCenterOfMass);
				const rotationalVelocity = angularVelocity.Cross(relativePosition);

				// Total effective velocity
				const effectiveVelocity = linearVelocity.add(rotationalVelocity);

				// Step 2: Convert to local space
				const relativeVelocity = wing.CFrame.PointToObjectSpace(wing.Position.add(effectiveVelocity));

				// Step 3: Apply force multiplier to velocity
				const velocityForce = relativeVelocity.mul(FORCE_MULTIPLIER);

				// Step 4: Calculate lift force based on effective surface
				const liftForce = effectiveSurface.mul(velocityForce);

				// Step 5: Average with previous force for stability
				const averagedForce = liftForce.add(vectorForce.Force).div(2);

				// Step 6: Apply height factor (air density decreases with altitude)
				const heightFactor = math.clamp(
					1 -
						math.pow(
							(wing.Position.Y - GameDefinitions.HEIGHT_OFFSET) / GameEnvironment.ZeroAirHeight,
							HEIGHT_FACTOR_EXPONENT,
						),
					0,
					1,
				);

				// Step 7: Apply final force
				const finalForce = averagedForce.mul(heightFactor);

				vectorForce.Enabled = finalForce.Magnitude > Workspace.Gravity * wing.Mass;
				vectorForce.Force = finalForce;
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
		mirror: { behaviour: "wedgeWing" },
	},
	wing1x2: {
		displayName: "Wing 1x2",
		description: "A part with advanced aerodynamic properties but a bit longer",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wing1x3: {
		displayName: "Wing 1x3",
		description: "A part with advanced aerodynamic properties but two bits longer",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wing1x4: {
		displayName: "Wing 1x4",
		description: "A part with advanced aerodynamic properties but the joke is overused",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wedgewing1x1: {
		displayName: "Wedge Wing 1x1",
		description: "A wedge shaped wing",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wedgewing1x2: {
		displayName: "Wedge Wing 1x2",
		description: "A wedge shaped wing but longer",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wedgewing1x3: {
		displayName: "Wedge Wing 1x3",
		description: "A wedge shaped wing but much longer",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wedgewing1x4: {
		displayName: "Wedge Wing 1x4",
		description: "A humongously long wedge shaped wing",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
};
export const WingBlocks = BlockCreation.arrayFromObject(list);
