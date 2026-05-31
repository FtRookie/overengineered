import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { RemoteEvents } from "shared/RemoteEvents";
import type { BlockDamageController } from "engine/shared/BlockDamageController";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults, BlockLogicInfo } from "shared/blocks/Block";

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

type TNTBlock = BlockModel & {
	Part: UnionOperation | BasePart;
};

export type { Logic as TNTBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition, TNTBlock> {
	constructor(block: InstanceBlockLogicArgs, @inject damageController: BlockDamageController) {
		super(definition, block);

		const mainPart = this.instance.Part;

		const radius = this.initializeInputCache("radius");
		const pressure = this.initializeInputCache("pressure");
		const flammable = this.initializeInputCache("flammable");
		const impact = this.initializeInputCache("impact");

		// Reentrancy guard — Touched, Explode input, and `blockBroken` (self-destruct or
		// chain reaction from another TNT) all funnel here. Without this, applying damage
		// to ourselves inside the explosion loop would re-fire blockBroken → re-enter.
		let hasExploded = false;

		const explodeTNT = () => {
			if (hasExploded) return;
			hasExploded = true;

			const r = radius.get();
			const p = pressure.get();

			// Server owns HP: the Explode handler applies the radial damage, physics push, fire
			// spread, and the visual/sound effect.
			RemoteEvents.Explode.send({
				part: mainPart,
				radius: r,
				pressure: p,
				isFlammable: flammable.get(),
			});
			this.disable();
		};

		this.on(({ explode }) => {
			if (!explode) return;
			explodeTNT();
		});

		this.event.subscribe(mainPart.Touched, (part) => {
			if (!impact.get()) return;

			const velocity1 = mainPart.AssemblyLinearVelocity.Magnitude;
			const velocity2 = part.AssemblyLinearVelocity.Magnitude;

			if (velocity1 > (velocity2 + 1) * 10) explodeTNT();
		});

		// Chain reaction: if any damage source kills this block (including the explosive
		// damage from a neighbouring TNT), detonate. Run on a fresh coroutine — Signal.Fire
		// throws after 10 nested self-fires on the same thread, which would cap chain length.
		this.event.subscribe(damageController.blockBroken, (brokenBlock) => {
			if (brokenBlock === this.instance) task.spawn(explodeTNT);
		});
	}
}

const logic: BlockLogicInfo = { definition, ctor: Logic };
const list: BlockBuildersWithoutIdAndDefaults = {
	tnt: {
		displayName: "TNT",
		description: "A box of explosives. DO NOT HIT!",
		limit: 100,
		logic,
	},
	cylindricaltnt: {
		displayName: "Cylindrical TNT",
		description: "Not a boxed version",
		limit: 100,
		logic,
	},
	sphericaltnt: {
		displayName: "Spherical TNT",
		description: "Catch this, anarchid boy!",
		limit: 100,
		logic,
	},
	halfsphericaltnt: {
		displayName: "Half Spherical TNT",
		description: "Had to cut corners. Unfortunately, sphere doesn't have corners.. So we sliced it in half!",
		limit: 100,
		logic,
	},
};
export const TNTBlocks = BlockCreation.arrayFromObject(list);
