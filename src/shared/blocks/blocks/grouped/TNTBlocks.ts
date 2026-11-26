import { RunService, Workspace } from "@rbxts/services";
import { Objects } from "engine/shared/fixes/Objects";
import { BlastImpulse, blastConeOf } from "shared/BlastImpulse";
import { ImpactController } from "shared/block/impact/ImpactController";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { RemoteEvents } from "shared/RemoteEvents";
import type { BlockDamageController } from "engine/shared/BlockDamageController";
import type { BlastCone } from "shared/BlastImpulse";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults, BlockLogicInfo } from "shared/blocks/Block";

// fixme: picked, not measured. Studs/s the TNT and what it touches must close at, as ImpactController.contactSpeed
// scores it (sliding counts at its scrape scale)
const impactDetonationSpeed = 30;

const definition = {
	input: {
		explode: {
			displayName: "Explode",
			types: {
				bool: {
					config: false,
					control: {
						config: {
							enabled: true,
							key: "B",
							switch: false,
							reversed: false,
						},
						canBeSwitch: false,
						canBeReversed: false,
					},
				},
			},
		},
		radius: {
			displayName: "Explosion radius",
			types: {
				number: {
					config: 12,
					clamp: {
						showAsSlider: true,
						min: 1,
						max: 20,
					},
				},
			},
		},
		pressure: {
			displayName: "Explosion pressure",
			types: {
				number: {
					config: 2500,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 2500,
					},
				},
			},
		},
		flammable: {
			displayName: "Flammable",
			types: {
				bool: {
					config: true,
				},
			},
		},
		impact: {
			displayName: "Impact",
			types: {
				bool: {
					config: true,
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

const shapedChargeDefinition = {
	input: {
		...definition.input,
		radius: { ...definition.input.radius, displayName: "Cone length" },
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type TNTBlock = BlockModel & {
	Part: UnionOperation | BasePart;
};
// Propellant's model: ColBox is the collider the halves are welded to, its up axis out of Top
type ShapedChargeBlock = BlockModel & {
	ColBox: UnionOperation;
	Top: UnionOperation;
	Bottom: UnionOperation;
};

abstract class TNTLogicBase<TDef extends typeof definition, TBlock extends BlockModel> extends InstanceBlockLogic<
	TDef,
	TBlock
> {
	// a shaped charge's cone at the moment it goes off; a plain TNT has none
	protected coneOf: () => BlastCone | undefined = () => undefined;

	constructor(
		def: TDef,
		block: InstanceBlockLogicArgs,
		damageController: BlockDamageController,
		mainPartOf: (instance: TBlock) => BasePart,
	) {
		super(def, block);

		const mainPart = mainPartOf(this.instance);

		// radius and pressure are read here only to size the local push; the server reads its own copy off the
		// block, so what this client believes them to be cannot widen the blast
		const radius = this.initializeInputCache("radius");
		const pressure = this.initializeInputCache("pressure");
		const impact = this.initializeInputCache("impact");

		// Reentrancy guard — Touched, Explode input, and `blockBroken` (self-destruct or
		// chain reaction from another TNT) all funnel here. Without this, applying damage
		// to ourselves inside the explosion loop would re-fire blockBroken → re-enter.
		let hasExploded = false;

		const explodeTNT = () => {
			if (hasExploded) return;
			hasExploded = true;

			// This client is authoritative over its own blocks, so their welds snap and the shove lands
			// immediately — no round trip. The blocks it found are sent on, since the server's own query runs
			// against lagging positions; the server settles damage, characters and the other clients.
			const epicenter = mainPart.Position;
			const cone = this.coneOf();
			// TDef only extends the TNT definition, so the caches lose the number type of these inputs
			const blastRadius = (radius.tryGet() as number | undefined) ?? 0;
			const blastPressure = (pressure.tryGet() as number | undefined) ?? 0;
			const affected = RunService.IsClient()
				? BlastImpulse.apply(epicenter, blastRadius, blastPressure, true, true, cone)
				: Objects.empty;
			// only the detonator's own character is shoved; other characters just take the blast damage
			if (RunService.IsClient()) BlastImpulse.applyToCharacter(epicenter, blastRadius, blastPressure, cone);

			// Size and flammability are not sent — the server reads them off the block's saved config, so a
			// forged payload cannot ask for a bigger blast than the block is built for.
			RemoteEvents.Explode.send({
				part: mainPart,
				epicenter,
				affected,
				direction: cone?.direction,
				at: Workspace.GetServerTimeNow(),
			});
			this.disable();
		};

		this.on(({ explode }) => {
			if (!explode) return;
			explodeTNT();
		});

		// the TNT's own velocity from before the physics step, as ImpactController takes its snapshots, so a hit is
		// judged by how fast it came in rather than by what the collision left of it
		let linearBefore = Vector3.zero;
		let angularBefore = Vector3.zero;
		this.event.subscribe(RunService.PreSimulation, () => {
			if (!impact.get()) return;

			linearBefore = mainPart.AssemblyLinearVelocity;
			angularBefore = mainPart.AssemblyAngularVelocity;
		});
		const velocityAt = (body: BasePart, at: Vector3) =>
			body === mainPart
				? linearBefore.add(angularBefore.Cross(at.sub(mainPart.AssemblyCenterOfMass)))
				: body.AssemblyLinearVelocity.add(
						body.AssemblyAngularVelocity.Cross(at.sub(body.AssemblyCenterOfMass)),
					);

		this.event.subscribe(mainPart.Touched, (part) => {
			if (!impact.get()) return;
			if (!part.CanCollide) return;

			if (ImpactController.contactSpeed(mainPart, part, velocityAt) >= impactDetonationSpeed) explodeTNT();
		});

		// Chain reaction: if any damage source kills this block (including the explosive
		// damage from a neighbouring TNT), detonate. Run on a fresh coroutine — Signal.Fire
		// throws after 10 nested self-fires on the same thread, which would cap chain length.
		this.event.subscribe(damageController.blockBroken, (brokenBlock) => {
			if (brokenBlock === this.instance) task.spawn(explodeTNT);
		});
	}
}

export type { Logic as TNTBlockLogic };
@injectable
class Logic extends TNTLogicBase<typeof definition, TNTBlock> {
	constructor(block: InstanceBlockLogicArgs, @inject damageController: BlockDamageController) {
		super(definition, block, damageController, (instance) => instance.Part);
	}
}

@injectable
class ShapedChargeLogic extends TNTLogicBase<typeof shapedChargeDefinition, ShapedChargeBlock> {
	constructor(block: InstanceBlockLogicArgs, @inject damageController: BlockDamageController) {
		super(shapedChargeDefinition, block, damageController, (instance) => instance.ColBox);

		this.coneOf = () => {
			const part = this.instance.ColBox;
			return blastConeOf(part.CFrame.UpVector, part.Size);
		};
	}
}

const logic: BlockLogicInfo = { definition, ctor: Logic };
const list: BlockBuildersWithoutIdAndDefaults = {
	tnt: {
		displayName: "TNT",
		description: "A box of explosives. DO NOT HIT!",
		limitFamily: "tnt",
		logic,
	},
	cylindricaltnt: {
		displayName: "Cylindrical TNT",
		description: "Not a boxed version",
		limitFamily: "tnt",
		logic,
	},
	sphericaltnt: {
		displayName: "Spherical TNT",
		description: "Catch this, anarchid boy!",
		limitFamily: "tnt",
		logic,
	},
	halfsphericaltnt: {
		displayName: "Half Spherical TNT",
		description: "Had to cut corners. Unfortunately, sphere doesn't have corners.. So we sliced it in half!",
		limitFamily: "tnt",
		logic,
	},
	shapedcharge: {
		displayName: "Shaped Charge",
		description: "TNT but it only explodes whats in front of it (size changes cone)",
		limitFamily: "tnt",
		logic: { definition: shapedChargeDefinition, ctor: ShapedChargeLogic },
	},
};
export const TNTBlocks = BlockCreation.arrayFromObject(list);
