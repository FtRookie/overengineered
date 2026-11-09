import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { GameDefinitions } from "shared/data/GameDefinitions";
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

const attractorsByPlot = new Map<ReadonlyPlot, Logic[]>();
const forcesApplied = new Map<BasePart, Vector3>();
const parts: BasePart[] = [];
const positions = new Map<BasePart, Vector3>();
const roots = new Map<BasePart, BasePart | false>();
const volumes = new Map<BasePart, number>();

const rootOf = (part: BasePart): BasePart | undefined => {
	const cached = roots.get(part);
	if (cached !== undefined) return cached || undefined;

	const root = part.AssemblyRootPart;
	roots.set(part, root ?? false);
	return root;
};

const volumeOf = (part: BasePart): number => {
	let volume = volumes.get(part);
	if (volume !== undefined) return volume;

	const blockScale = BlockManager.manager.scale.get(part.Parent as BlockModel) ?? Vector3.one;
	volume = blockScale.X * blockScale.Y * blockScale.Z;
	volumes.set(part, volume);
	return volume;
};

const stepPlot = (plot: ReadonlyPlot, attrs: readonly Logic[], dt: number) => {
	forcesApplied.clear();
	parts.clear();
	positions.clear();
	roots.clear();

	for (const block of plot.getBlocks()) {
		const part = block.PrimaryPart;
		if (!part) continue;

		parts.push(part);
		positions.set(part, part.Position);
	}

	for (const attr of attrs) {
		const attractor = attr.instance.PrimaryPart;
		if (!attractor) continue;

		const strength = attr.getStrength() * GameDefinitions.REFERENCE_FPS * dt;
		if (strength === 0) continue;

		const inPlotPosition = positions.get(attractor);
		const attractorPosition = inPlotPosition ?? attractor.Position;

		for (const otherPart of parts) {
			const difference = attractorPosition.sub(positions.get(otherPart)!);
			const distance = difference.Magnitude / attr.distanceMultiplier;
			if (distance > 10) continue;
			if ((inPlotPosition ? rootOf(attractor) : undefined) === rootOf(otherPart)) continue;

			const invSqrt = 1 / (1 + math.sqrt(distance));
			const calculatedForce = difference.Unit.mul(attr.repel ? invSqrt : -invSqrt);

			//distance between
			//inverse square root
			//make it minus value if
			//multiply by normalized value?
			//???
			//profit!!

			const force2 = volumeOf(otherPart);

			const appliedForce = calculatedForce.mul(strength).add(calculatedForce.mul(force2));
			forcesApplied.set(attractor, (forcesApplied.get(attractor) ?? Vector3.zero).add(appliedForce));
			forcesApplied.set(otherPart, (forcesApplied.get(otherPart) ?? Vector3.zero).add(appliedForce.mul(-1)));
		}
	}

	for (const [part, force] of forcesApplied) {
		part.ApplyImpulseAtPosition(force, positions.get(part) ?? part.Position);
	}
};

const stepAll = (dt: number) => {
	for (const [plot, attrs] of attractorsByPlot) {
		const [ok, err] = pcall(stepPlot, plot, attrs, dt);
		if (!ok) task.spawn(error, err, 0);
	}
};
let stepConnection: RBXScriptConnection | undefined;

export type { Logic as AttractorBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition> {
	repel = false;
	private strength = 0;

	readonly scale: number;
	distanceMultiplier: number = 1;

	constructor(
		block: InstanceBlockLogicArgs,
		@inject readonly plot: ReadonlyPlot,
	) {
		super(definition, block);

		const blockScale = BlockManager.manager.scale.get(block.instance) ?? Vector3.one;
		this.scale = blockScale.X * blockScale.Y * blockScale.Z;

		this.onk(["repel"], ({ repel }) => (this.repel = repel));
		this.onk(["strength"], ({ strength }) => (this.strength = strength));
		this.onk(["distance"], ({ distance }) => (this.distanceMultiplier = distance));

		this.onEnable(() => {
			let attrs = attractorsByPlot.get(plot);
			if (!attrs) attractorsByPlot.set(plot, (attrs = []));
			if (attrs.contains(this)) return;

			attrs.push(this);
			stepConnection ??= RunService.PostSimulation.Connect(stepAll);
		});
		this.onDisable(() => {
			const attrs = attractorsByPlot.get(plot);
			if (!attrs) return;

			const index = attrs.indexOf(this);
			if (index !== -1) attrs.remove(index);
			if (attrs.isEmpty()) attractorsByPlot.delete(plot);
			if (!attractorsByPlot.isEmpty()) return;

			stepConnection?.Disconnect();
			stepConnection = undefined;
			volumes.clear();
		});
	}

	getStrength(): number {
		return this.strength * this.scale;
	}
}

export const AttractorBlock = {
	...BlockCreation.defaults,
	id: "attractor",
	displayName: "Attractor",
	description: "Warning, your device may suffer",

	search: {
		partialAliases: ["magnet"],
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
