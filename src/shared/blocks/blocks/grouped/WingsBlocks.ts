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

export type WingBlock = BlockModel & {
	readonly WingSurface:
		| BasePart
		| (UnionOperation & {
				readonly VectorForce: VectorForce;
		  });
};

// Constants
const FORCE_MULTIPLIER = -20.5; // F = -ρ * A * v * CL, ~~ -(5 * 5.3 * 4)
const HEIGHT_FACTOR_EXPONENT = 2; // for h = 1 - (y/H)^exp
const MIN_HORIZONTAL_SPEED = 30; // Minimum horizontal speed for full lift (studs/sec) - lower for easier gliding
const MIN_SPEED = 0.1; // optimization n shit
const MIN_LIFT = 100;

/** Aerofoil geometry, so the lift solver and the jet exhaust wash cannot disagree about it. */
export namespace WingGeometry {
	/**
	 * The aerofoil: the face perpendicular to the part's thinnest axis, with its outward direction and area.
	 * Taken from the geometry rather than the class — a wedge wing's surface is a plain Part thin along X,
	 * where a panel is thin along Y, so `IsA("WedgePart")` answers neither.
	 */
	export function face(wing: BasePart): { readonly normal: Vector3; readonly area: number } {
		const size = wing.Size;
		const cframe = wing.CFrame;
		if (size.X <= size.Y && size.X <= size.Z) return { normal: cframe.RightVector, area: size.Y * size.Z };
		if (size.Y <= size.Z) return { normal: cframe.UpVector, area: size.X * size.Z };

		return { normal: cframe.LookVector, area: size.X * size.Y };
	}

	/** Per-axis area the lift force is scaled by. */
	export function effectiveSurface(wing: BasePart): Vector3 {
		const area = wing.Size.X * wing.Size.Z;
		if (wing.IsA("WedgePart")) {
			// wedge area acts as lift, divided by 2 for balance
			const thickness = wing.Size.X;
			return new Vector3(area, thickness, thickness).div(2);
		}

		const thickness = wing.Size.Y;
		return new Vector3(thickness, area, thickness);
	}
}

export type { Logic as WingsBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition, WingBlock> {
	constructor(block: InstanceBlockLogicArgs, @tryInject playerData?: PlayerDataStorage) {
		super(definition, block);

		const fluidForcesEnabled = !playerData?.config.get().environment.physics.simplified_aerodynamics;
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
			const attachment = new Instance("Attachment");
			attachment.Parent = this.instance.WingSurface;
			const vectorForce = new Instance("VectorForce");
			vectorForce.Parent = this.instance.WingSurface;
			vectorForce.RelativeTo = Enum.ActuatorRelativeTo.Attachment0;
			vectorForce.Attachment0 = attachment;

			// Set up wing material properties
			const density = math.max(0.7, new PhysicalProperties(this.instance.WingSurface.Material).Density / 2);
			this.instance.WingSurface.CustomPhysicalProperties = new PhysicalProperties(density, 0.3, 0.5, 1, 1);

			const wing = this.instance.WingSurface;
			const effectiveSurface = WingGeometry.effectiveSurface(wing);

			if (RunService.IsStudio()) vectorForce.Visible = true;

			// gravity and wing mass are static for the ride, so the lift threshold is resolved once
			const wingWeight = Workspace.Gravity * wing.Mass;
			let lastForceEnabled: boolean | undefined;
			let lastForce: Vector3 | undefined;

			this.event.subscribe(RunService.PostSimulation, () => {
				if (wing.Parent === undefined) {
					return;
				}

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

				// Step 2: Calculate horizontal speed for lift scaling
				const horizontalVelocity = new Vector3(effectiveVelocity.X, 0, effectiveVelocity.Z);
				const horizontalSpeed = horizontalVelocity.Magnitude;

				// Gradual lift dropoff using smoothstep curve
				// Provides smooth transition from 0 to full lift
				const speedRatio = math.min(horizontalSpeed / MIN_HORIZONTAL_SPEED, 1);
				const speedFactor = speedRatio * speedRatio * (3 - 2 * speedRatio); // Smoothstep interpolation

				// Step 3: Convert to local space
				const relativeVelocity = wing.CFrame.PointToObjectSpace(wing.Position.add(effectiveVelocity));

				// Step 4: Reduce horizontal drag to prevent speed loss during gliding
				// Only apply force multiplier to vertical component (Y) for lift
				// Reduce horizontal components (X, Z) to minimize drag
				const HORIZONTAL_DRAG_REDUCTION = 0.05; // Reduce horizontal drag by 95%
				const adjustedVelocity = new Vector3(
					relativeVelocity.X * HORIZONTAL_DRAG_REDUCTION,
					relativeVelocity.Y, // Full vertical component for lift
					relativeVelocity.Z * HORIZONTAL_DRAG_REDUCTION,
				);

				// Step 5: Apply force multiplier to adjusted velocity
				const velocityForce = adjustedVelocity.mul(FORCE_MULTIPLIER);

				// Step 6: Calculate lift force based on effective surface
				const liftForce = effectiveSurface.mul(velocityForce);

				let intermediate = Vector3.zero;
				if (linearVelocity.Magnitude > MIN_SPEED) {
					const airflowDir = linearVelocity.Unit.mul(-1); // opposite motion
					const dot = airflowDir.Dot(wing.CFrame.UpVector);
					const aoa = math.asin(math.clamp(dot, -1, 1));
					const test = airflowDir.mul(math.abs(aoa) * effectiveVelocity.Magnitude);
					intermediate = liftForce.add(test);
				}

				// Step 7: Scale lift by speed factor (less lift at low speeds)
				const scaledLiftForce = liftForce.add(intermediate).mul(speedFactor);

				// Step 8: Average with previous force for stability
				const averagedForce = scaledLiftForce.add(vectorForce.Force).div(2);

				// Step 9: Apply height factor (air density decreases with altitude)
				const heightFactor = math.clamp(
					1 -
						math.pow(
							(wing.Position.Y - GameDefinitions.HEIGHT_OFFSET) / GameEnvironment.ZeroAirHeight,
							HEIGHT_FACTOR_EXPONENT,
						),
					0,
					1,
				);

				// Step 10: Apply final force
				const finalForce = averagedForce.mul(heightFactor);

				const enabled = finalForce.Magnitude > wingWeight;
				if (lastForceEnabled !== enabled) {
					lastForceEnabled = enabled;
					vectorForce.Enabled = enabled;
				}
				// A constraint write dirties the physics solver, so a wing holding steady — parked, or level in
				// still air — should not pay for one. Vector3 compares by value, so this only skips a no-op.
				if (lastForce !== finalForce) {
					lastForce = finalForce;
					vectorForce.Force = finalForce;
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
		displayName: "Wing Panel",
		description: "A part with advanced aerodynamic properties",
		limitFamily: "wing",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wing1x2: {
		displayName: "Wing 1x2",
		description: "A part with advanced aerodynamic properties but a bit longer",
		hidden: true,
		limitFamily: "wing",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wing1x3: {
		displayName: "Wing 1x3",
		description: "A part with advanced aerodynamic properties but two bits longer",
		hidden: true,
		limitFamily: "wing",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wing1x4: {
		displayName: "Wing 1x4",
		description: "A part with advanced aerodynamic properties but the joke is overused",
		hidden: true,
		limitFamily: "wing",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wedgewing1x1: {
		displayName: "Wedge Wing",
		description: "A wedge shaped wing",
		limitFamily: "wing",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wedgewing1x2: {
		displayName: "Wedge Wing 1x2",
		description: "A wedge shaped wing but longer",
		hidden: true,
		limitFamily: "wing",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wedgewing1x3: {
		displayName: "Wedge Wing 1x3",
		description: "A wedge shaped wing but much longer",
		hidden: true,
		limitFamily: "wing",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wedgewing1x4: {
		displayName: "Wedge Wing 1x4",
		description: "A humongously long wedge shaped wing",
		hidden: true,
		limitFamily: "wing",
		logic,
		mirror: { behaviour: "wedgeWing" },
	},
	wingrounding: {
		displayName: "Wing Rounding",
		description: "A wing rounding. Literally rounds your wing",
	},
	wingsharpening: {
		displayName: "Wing Sharper",
		description: "An evil brother of the wing rounding",
	},
};
export const WingBlocks = BlockCreation.arrayFromObject(list);
