import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { PartUtils } from "shared/utils/PartUtils";
import type { BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["strength", "invertPolarity", "distance"],
	input: {
		strength: {
			displayName: "Strength",
			types: {
				number: {
					config: 100,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 300,
					},
				},
			},
		},
		invertPolarity: {
			displayName: "Invert polarity",
			types: {
				bool: {
					config: false,
					control: {
						config: {
							enabled: true,
							key: "G",
							switch: false,
							reversed: false,
						},
						canBeSwitch: true,
						canBeReversed: true,
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

const magnets: Logic[] = [];
const positions: Vector3[] = [];
const strengths: number[] = [];
const forcesApplied = new Map<Logic, Vector3>();
const roots = new Map<Logic, BasePart | false>();

// Getting AssemblyRootPart is slow and it's happening several times per magnet, so we cache it
const rootOf = (magnet: Logic): BasePart | undefined => {
	const cached = roots.get(magnet);
	if (cached !== undefined) return cached || undefined;

	const root = magnet.part.AssemblyRootPart;
	roots.set(magnet, root ?? false);
	return root;
};

const stepAll = (dt: number) => {
	forcesApplied.clear();
	roots.clear();
	positions.clear();
	strengths.clear();
	for (const m of magnets) {
		positions.push(m.part.Position);
		strengths.push(m.getStrength() * GameDefinitions.REFERENCE_FPS * dt);
	}

	for (let i = 0; i < magnets.size(); i++) {
		const magneti = magnets[i];
		const strength1 = strengths[i];
		if (strength1 === 0) continue;

		for (let j = i + 1; j < magnets.size(); j++) {
			const strength2 = strengths[j];
			if (strength2 === 0) continue;

			const magnetj = magnets[j];
			const difference = positions[i].sub(positions[j]);
			const distance = difference.Magnitude / (magneti.distanceMultiplier * magnetj.distanceMultiplier);
			if (distance > 10) continue;
			if (rootOf(magneti) === rootOf(magnetj)) continue;

			const invSqrt = 1 / (1 + math.sqrt(distance));
			const isAttracted = magneti.polarity === magnetj.polarity;
			const calculatedForce = difference.Unit.mul(isAttracted ? invSqrt : -invSqrt);

			//distance between
			//inverse square root
			//make it minus value if
			//multiply by normalized value?
			//???
			//profit!!

			const appliedForce = calculatedForce.mul(strength1).add(calculatedForce.mul(strength2));
			forcesApplied.set(magneti, (forcesApplied.get(magneti) ?? Vector3.zero).add(appliedForce));
			forcesApplied.set(magnetj, (forcesApplied.get(magnetj) ?? Vector3.zero).add(appliedForce.mul(-1)));
		}

		const finalForce = forcesApplied.get(magneti);
		if (finalForce) {
			magneti.part.ApplyImpulseAtPosition(finalForce, positions[i]);
		}
	}
};
let stepConnection: RBXScriptConnection | undefined;

const partColor1 = Color3.fromRGB(128, 128, 240);
const partColor2 = Color3.fromRGB(240, 128, 128);

export type { Logic as MagnetBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	polarity = false;
	readonly part;
	private strength = 0;

	readonly scale: number;
	distanceMultiplier: number = 1;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
		this.part = this.instance.WaitForChild("Part") as BasePart;

		const blockScale = BlockManager.manager.scale.get(block.instance) ?? Vector3.one;
		this.scale = blockScale.X * blockScale.Y * blockScale.Z;

		this.onk(["strength"], ({ strength }) => (this.strength = strength));
		this.onk(["distance"], ({ distance }) => (this.distanceMultiplier = distance));
		this.onk(["invertPolarity"], ({ invertPolarity }) => {
			this.polarity = invertPolarity;
			PartUtils.applyToAllDescendantsOfType(
				"BasePart",
				this.instance,
				(part) => (part.Color = invertPolarity ? partColor1 : partColor2),
			);
		});

		// Registration and the caches keyed off it share one lifetime. The tick only clears the caches
		// when at least one magnet is live, so a magnet that leaves has to take its own entries with it.
		this.onEnable(() => {
			if (magnets.contains(this)) return;
			magnets.push(this);
			stepConnection ??= RunService.PostSimulation.Connect(stepAll);
		});
		this.onDisable(() => {
			const index = magnets.indexOf(this);
			if (index !== -1) magnets.remove(index);

			forcesApplied.delete(this);
			roots.delete(this);
			if (!magnets.isEmpty()) return;

			stepConnection?.Disconnect();
			stepConnection = undefined;
		});
	}

	getStrength(): number {
		return this.strength * this.scale;
	}
}

export const MagnetBlock = {
	...BlockCreation.defaults,
	id: "magnet",
	displayName: "Magnet",
	description: "Block that attracts to different polarity magnets, repels from same. Only for your blocks, though",

	search: {
		partialAliases: ["attractor"],
	},
	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
