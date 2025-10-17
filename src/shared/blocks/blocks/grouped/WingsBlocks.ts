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
const AERODYNAMICS_CONSTANTS = {
	LiftScale: 100, // magic number for backwards compatibility
	AirDensity: 2.8, // ρ at sea level
	HeightFactorExponent: 2, // for h = 1 - (y/H)^exp
	DragCoefficient: 0.03, // C_d for optional drag drag
	AreaScale: 1.0, // Base multiplier for effective size
	MinLiftForce: 10,
	MinVelocityThreshold: 0.5, // Threshold for min lift
	ThicknessRatio: 0.15, // thickness = areaXZ * ratio
	WedgeAreaReduction: 0.5,
	MinVelocityCutoff: 0.1, // Early return if V is too small (optimization)
} as const;

export type { Logic as WingsBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition, WingBlock> {
	private readonly part;
	private vectorForce?: VectorForce;
	private attachment?: Attachment;
	private effectiveSize?: Vector3;
	private aerodynamicFactor?: number;

	constructor(block: InstanceBlockLogicArgs, @tryInject playerData?: PlayerDataStorage) {
		super(definition, block);

		this.part = this.instance.WingSurface;

		if (!playerData?.config.get().physics.simplified_aerodynamics) {
			this.part.EnableFluidForces = true;
			return;
		}

		this.onkFirstInputs(["enabled"], ({ enabled }) => {
			if (!enabled) {
				this.disable();
				return;
			}

			this.attachment = new Instance("Attachment", this.part);
			this.vectorForce = new Instance("VectorForce", this.part);
			this.vectorForce.RelativeTo = Enum.ActuatorRelativeTo.Attachment0;
			this.vectorForce.Attachment0 = this.attachment;

			// Material: low density (single use)
			const density = math.max(0.7, new PhysicalProperties(this.part.Material).Density / 2);
			this.part.CustomPhysicalProperties = new PhysicalProperties(density, 0.3, 0.5, 1, 1);

			// Cache effective size and factor (once)
			this.effectiveSize = this.getEffectiveWingSize(this.part);
			this.aerodynamicFactor = AERODYNAMICS_CONSTANTS.LiftScale * AERODYNAMICS_CONSTANTS.AirDensity * 0.3;

			// Heartbeat
			this.event.subscribe(RunService.Heartbeat, () => {
				const wing = this.part; // Cached, no FindFirstChild every tick
				if (!wing) return;

				// Step 1: Relative velocity in local space (Assembly for assemblies)
				const relVel = wing.CFrame.VectorToObjectSpace(wing.AssemblyLinearVelocity);
				const vMag = relVel.Magnitude;

				// Early return for zero speed (optimization)
				if (vMag < AERODYNAMICS_CONSTANTS.MinVelocityCutoff) {
					this.vectorForce!.Force = new Vector3();
					this.vectorForce!.Enabled = false;
					return;
				}

				// Step 2: Height factor (dynamic, but cheap pow)
				const heightFactor = math.clamp(
					1 -
						math.pow(
							(wing.Position.Y - GameDefinitions.HEIGHT_OFFSET) / GameEnvironment.ZeroAirHeight,
							AERODYNAMICS_CONSTANTS.HeightFactorExponent,
						),
					0,
					1,
				);

				// Step 3: Dynamic AreaScale from height
				const dynamicAreaScale = AERODYNAMICS_CONSTANTS.AreaScale * heightFactor;
				const scaledSize = this.effectiveSize!.mul(dynamicAreaScale);

				// Step 4: Lift force (cached constants)
				let liftForce = scaledSize.mul(relVel.mul(-this.aerodynamicFactor!)).div(2);

				// Min lift for low speeds
				if (vMag < AERODYNAMICS_CONSTANTS.MinVelocityThreshold) {
					const minLiftDir = new Vector3(0, 1, 0); // Local up
					const minLift = minLiftDir.mul(AERODYNAMICS_CONSTANTS.MinLiftForce * heightFactor);
					liftForce = liftForce.add(minLift);
				}

				// Optional Drag
				let dragForce = new Vector3();
				if (AERODYNAMICS_CONSTANTS.DragCoefficient > 0) {
					const vScaled = vMag ** 2;
					const dragMag =
						0.5 *
						AERODYNAMICS_CONSTANTS.AirDensity *
						vScaled *
						scaledSize.Magnitude *
						AERODYNAMICS_CONSTANTS.DragCoefficient *
						heightFactor;
					const dragDir = relVel.mul(-1).Unit;
					dragForce = dragDir.mul(dragMag);
				}

				// Result
				const totalForce = liftForce.add(dragForce);
				this.vectorForce!.Enabled = totalForce.Magnitude > Workspace.Gravity * wing.AssemblyMass;
				this.vectorForce!.Force = totalForce;
			});
		});
	}

	initializeInputs(config: PlacedBlockConfig, allBlocks: ReadonlyMap<BlockUuid, GenericBlockLogic>): void {
		super.initializeInputs(config, allBlocks);
	}

	// Effective size
	private getEffectiveWingSize(wingSurface: BasePart): Vector3 {
		const areaXZ = wingSurface.Size.X * wingSurface.Size.Z;
		const thickness = areaXZ * AERODYNAMICS_CONSTANTS.ThicknessRatio;

		let effectiveSize: Vector3;
		if (wingSurface.IsA("WedgePart")) {
			effectiveSize = new Vector3(areaXZ, thickness, thickness).mul(AERODYNAMICS_CONSTANTS.WedgeAreaReduction);
		} else {
			effectiveSize = new Vector3(thickness, areaXZ, thickness);
		}

		return effectiveSize;
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
