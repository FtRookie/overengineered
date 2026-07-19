import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
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
						max: 100,
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

const magicNumber = 60 * 1; // dt
const magnets: Logic[] = [];
const forcesApplied: Map<Logic, Vector3> = new Map<Logic, Vector3>();
const assemblies: Map<Logic, BasePart | undefined> = new Map<Logic, BasePart | undefined>();

const calculateForce = (block1: Logic, block2: Logic, distMult: number): Vector3 | undefined => {
	const pos1 = block1.part.Position;
	const pos2 = block2.part.Position;
	const difference = pos1.sub(pos2);
	const distance = difference.Magnitude / distMult;
	if (distance > 10) return;

	const invSqrt = 1 / (1 + math.sqrt(distance));
	const isAttracted = block1.polarity === block2.polarity;
	const result = difference.Unit.mul(isAttracted ? invSqrt : -invSqrt);

	//distance between
	//inverse square root
	//make it minus value if
	//multiply by normalized value?
	//???
	//profit!!

	return result;
};

RunService.PostSimulation.Connect((dt) => {
	if (magnets.size() === 0) return;

	forcesApplied.clear();

	// Getting AssemblyRootPart is slow and it's happening several times per magnet, so we cache it
	assemblies.clear();
	for (const m of magnets) {
		assemblies.set(m, m.part.AssemblyRootPart);
	}

	for (let i = 0; i < magnets.size(); i++) {
		const magneti = magnets[i];
		const strength1 = magneti.getStrength() * magicNumber * dt;
		if (strength1 === 0) continue;

		for (let j = i + 1; j < magnets.size(); j++) {
			const magnetj = magnets[j];
			if (assemblies.get(magneti) === assemblies.get(magnetj)) {
				continue;
			}

			const calculatedForce = calculateForce(
				magneti,
				magnetj,
				magneti.distanceMultiplier * magnetj.distanceMultiplier,
			);
			if (!calculatedForce) continue;

			const strength2 = magnetj.getStrength() * magicNumber * dt;
			if (strength2 === 0) continue;

			const appliedForce = calculatedForce.mul(strength1).add(calculatedForce.mul(strength2));
			forcesApplied.set(magneti, (forcesApplied.get(magneti) ?? Vector3.zero).add(appliedForce));
			forcesApplied.set(magnetj, (forcesApplied.get(magnetj) ?? Vector3.zero).add(appliedForce.mul(-1)));
		}

		const finalForce = forcesApplied.get(magneti);
		if (finalForce) {
			magneti.part.ApplyImpulseAtPosition(finalForce, magneti.part.Position);
		}
	}
});

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

		this.onEnable(() => magnets.push(this));
		forcesApplied.set(this, Vector3.zero);
	}

	getStrength(): number {
		return this.strength * this.scale;
	}

	destroy() {
		magnets.remove(magnets.indexOf(this));
		forcesApplied.delete(this);
		super.destroy();
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
