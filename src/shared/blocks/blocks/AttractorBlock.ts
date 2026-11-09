import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import type { BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";

const definition = {
	inputOrder: ["repel", "strength", "distance"],
	input: {
		repel: {
			displayName: "Repel",
			tooltip: "Repel instead of attract",
			types: {
				bool: { config: false },
			},
		},
		strength: {
			displayName: "Strength",
			types: {
				number: {
					config: 100,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 100,
					},
				},
			},
		},
		distance: {
			displayName: "Distance multiplier",
			types: {
				number: { config: 1 },
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

const magicNumber = 60 * 1; // dt
const attractors: Logic[] = [];
const forcesApplied: Map<BasePart, Vector3> = new Map<BasePart, Vector3>();

const calculateForce = (block1: BasePart, block2: BasePart, distMult: number): Vector3 | undefined => {
	const pos1 = block1.Position;
	const pos2 = block2.Position;
	const difference = pos1.sub(pos2);
	const distance = difference.Magnitude / distMult;
	if (distance > 10) return;

	const invSqrt = 1 / (1 + math.sqrt(distance));
	const result = difference.Unit.mul(-invSqrt);

	//distance between
	//inverse square root
	//make it minus value if
	//multiply by normalized value?
	//???
	//profit!!

	return result;
};

RunService.PostSimulation.Connect((dt) => {
	if (attractors.size() === 0) return;

	for (const [plot, attrs] of attractors.groupBy((c) => c.plot)) {
		forcesApplied.clear();

		// Getting AssemblyRootPart is slow and it's happening several times per magnet, so we cache it
		const allParts = plot.getBlocks().mapFiltered((c) => c.PrimaryPart);
		const assemblies = allParts.mapToMap((m) => $tuple(m, m.AssemblyRootPart));

		for (const attr of attrs) {
			const attractor = attr.instance.PrimaryPart!;
			const strength = attr.getStrength() * magicNumber * dt;
			if (strength === 0) continue;

			for (const otherPart of allParts) {
				if (assemblies.get(attractor) === assemblies.get(otherPart)) {
					continue;
				}

				let calculatedForce = calculateForce(attractor, otherPart, attr.distanceMultiplier);
				if (!calculatedForce) continue;

				calculatedForce = calculatedForce.mul(attr.repel ? -1 : 1);

				const blockScale = BlockManager.manager.scale.get(otherPart.Parent as BlockModel) ?? Vector3.one;
				const force2 = blockScale.X * blockScale.Y * blockScale.Z;

				const appliedForce = calculatedForce.mul(strength).add(calculatedForce.mul(force2));
				forcesApplied.set(attractor, (forcesApplied.get(attractor) ?? Vector3.zero).add(appliedForce));
				forcesApplied.set(otherPart, (forcesApplied.get(otherPart) ?? Vector3.zero).add(appliedForce.mul(-1)));
			}
		}

		for (const [part, force] of forcesApplied) {
			part.ApplyImpulseAtPosition(force, part.Position);
		}
	}
});

export type { Logic as MagnetBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition> {
	repel = false;
	readonly part;
	private strength = 0;

	readonly scale: number;
	distanceMultiplier: number = 1;

	constructor(
		block: InstanceBlockLogicArgs,
		@inject readonly plot: ReadonlyPlot,
	) {
		super(definition, block);
		this.part = this.instance.WaitForChild("Part") as BasePart;

		const blockScale = BlockManager.manager.scale.get(block.instance) ?? Vector3.one;
		this.scale = blockScale.X * blockScale.Y * blockScale.Z;

		this.onk(["repel"], ({ repel }) => (this.repel = repel));
		this.onk(["strength"], ({ strength }) => (this.strength = strength));
		this.onk(["distance"], ({ distance }) => (this.distanceMultiplier = distance));

		this.onEnable(() => attractors.push(this));
		forcesApplied.set(this.instance.PrimaryPart!, Vector3.zero);
	}

	getStrength(): number {
		return this.strength * this.scale;
	}

	destroy() {
		attractors.remove(attractors.indexOf(this));
		forcesApplied.delete(this.instance.PrimaryPart!);
		super.destroy();
	}
}

export const AttractorBlock = {
	...BlockCreation.defaults,
	id: "attractor",
	displayName: "Attractor",
	description: "Magnet but attracts your every block ever",

	search: {
		partialAliases: ["magnet"],
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
