import { RunService } from "@rbxts/services";
import { BlastImpulse } from "shared/BlastImpulse";
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

			// Pushed here rather than on the round trip: this client owns these blocks, so it is the only peer
			// whose impulse takes at all, and waiting would put the shove after they have started breaking.
			if (RunService.IsClient()) BlastImpulse.apply(mainPart.Position, radius.get(), pressure.get());

			// Only the block is sent: the server reads radius, pressure and flammability off its saved config,
			// so a forged payload cannot ask for a bigger blast than the block is built for.
			RemoteEvents.Explode.send({ part: mainPart });
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
};
export const TNTBlocks = BlockCreation.arrayFromObject(list);
