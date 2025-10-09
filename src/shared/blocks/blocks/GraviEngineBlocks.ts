import { RunService } from "@rbxts/services";
import { EventHandler } from "engine/shared/event/EventHandler";
import { Instances } from "engine/shared/fixes/Instances";
import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { Physics } from "shared/Physics";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults, BlockLogicInfo } from "shared/blocks/Block";
import type { SoundEffect } from "shared/effects/SoundEffect";

const definition = {
	inputOrder: ["thrust", "strength", "color"],
	input: {
		thrust: {
			displayName: "Thrust",
			unit: "Percentage",
			types: {
				number: {
					config: 0,
					clamp: {
						showAsSlider: false,
						min: -100,
						max: 100,
					},
					control: {
						config: {
							enabled: true,
							startValue: 0,
							mode: {
								type: "smooth",
								instant: {
									mode: "onRelease",
								},
								smooth: {
									speed: 20,
									mode: "stopOnRelease",
								},
							},
							keys: [
								{ key: "W", value: 100 },
								{ key: "S", value: -100 },
							],
						},
					},
				},
			},
		},
		strength: {
			displayName: "Strength",
			unit: "Percentage",
			types: {
				number: {
					config: 100,
					clamp: {
						showAsSlider: true,
						max: 100,
						min: 0,
					},
				},
			},
		},

		color: {
			displayName: "Color",
			types: {
				color: {
					config: Color3.fromRGB(4, 175, 236),
				},
			},
		},
	},
	output: {
		maxpower: {
			displayName: "Force",
			unit: "Rowtons",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type engineModel = BlockModel & {
	readonly InnerRing: Instance & {
		readonly VectorForce: VectorForce;
	};

	readonly Base: Instance & {
		readonly Sound: Sound;
	};
	readonly ColBox: Part;
	readonly PropRings: Instance &
		Record<
			`ring${0 | 1 | 2 | 3 | 4 | 5 | 6}`,
			UnionOperation & {
				AlignOrientation: AlignOrientation;
				AlignPosition: AlignPosition;
				RingAttachment: Attachment;
			}
		>;
};

const updateEventType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<engineModel>(),
	strength: t.number,
});
type UpdateData = t.Infer<typeof updateEventType>;

const initEventType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<engineModel>(),
	color: t.color,
});
type InitData = t.Infer<typeof initEventType>;

const blockInstances = new Map<engineModel, number>();
const childAmount = 7;
const events = {
	updateRings: new BlockSynchronizer("b_graviengine_update", updateEventType, ({ block, strength }: UpdateData) => {
		blockInstances.set(block, strength);
	}),

	init: new BlockSynchronizer("b_graviengine_init", initEventType, ({ block, color }: InitData) => {
		const folder = block.WaitForChild("PropRings");
		const rings = new Array(childAmount, {}).map(
			(v, i) => folder.WaitForChild(`ring${i as 0}`) as typeof block.PropRings.ring0,
		);

		const len = block.PropRings.GetChildren().size();
		for (let i = 0; i < len; i++) {
			rings[i].Color = color;

			if (i > 0) {
				const indx = len - i;
				const ring = rings[indx];
				// make sure each item actually exists
				const at = rings[indx - 1].FindFirstChild("RingAttachment") && rings[indx - 1].RingAttachment;
				if (!at) return;

				// AlignOrientation
				const alo = ring.FindFirstChild("AlignOrientation") as typeof ring.AlignOrientation;
				if (!alo) return;

				// AlignPosition
				const alp = ring.FindFirstChild("AlignPosition") as typeof ring.AlignPosition;
				if (!alp) return;

				alo.Attachment1 = at;
				alp.Attachment1 = at;

				alo.Responsiveness = 30;
				alp.Responsiveness = 30;

				const prp = i / (len - 1);
				const sz = block.PropRings.ring0.Size;
				ring.Size = sz.apply((v) => prp * v);
			}
		}

		const handler = new EventHandler();
		handler.subscribe(RunService.Heartbeat, () => {
			const stren = blockInstances.get(block);
			if (stren === undefined) return;

			const gravModifier = Physics.GetGravityModifierOnHeight(Physics.LocalHeight.fromGlobal(block.GetPivot().Y));
			const trp = math.clamp(0.85 - stren * (1 - gravModifier), 0, 1);
			const len = rings.size();
			for (let i = 0; i < len; i++) {
				rings[i].Transparency = trp;
			}
		});

		handler.subscribe(block.Destroying, () => handler.unsubscribeAll());
	}),
};

export type { Logic as JetBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition, engineModel> {
	// Math
	private readonly basePower = 30_000;
	private readonly maxPower;

	constructor(
		block: InstanceBlockLogicArgs,
		@inject private readonly soundEffect: SoundEffect,
	) {
		super(definition, block);

		// Instances
		const colbox = this.instance.ColBox;
		const vectorForce = this.instance.InnerRing.VectorForce;

		// store rings in a folder
		const folder = this.instance.WaitForChild("PropRings");
		const rings = new Array(childAmount, {}).map(
			(v, i) => folder.WaitForChild(`ring${i as 0}`) as typeof this.instance.PropRings.ring0,
		);
		const ringCount = this.instance.PropRings.GetChildren().size();

		// Sounds
		const wSound = this.instance.Base.Sound;

		// Math
		let multiplier = (colbox.Size.X * colbox.Size.Y * colbox.Size.Z) / 8;

		// The strength depends on the material
		const material = BlockManager.manager.material.get(this.instance);
		multiplier *= math.max(1, new PhysicalProperties(material).Density / 2);

		// Max power
		this.maxPower = this.basePower * multiplier;
		this.output.maxpower.set("number", this.maxPower);
		const magicThreshold = 0.2;
		const updateForce = (modifier: number) => {
			const gravModifier = Physics.GetAirDensityModifierOnHeight(
				Physics.LocalHeight.fromGlobal(this.instance.GetPivot().Y),
			);

			const mod = 1 - math.clamp(gravModifier - magicThreshold, 0, 1);

			const f = this.maxPower * modifier;
			vectorForce.Force = new Vector3(0, 0, -f * mod);

			events.updateRings.send({
				block: this.instance,
				strength: math.abs(f) / this.maxPower,
			});
		};

		// why do we even have two values to begin with :sob:
		this.on(({ thrust, strength, color, colorChanged }) => {
			//nan check
			// no strength check lol
			// this code is so old, holy crap
			if (typeIs(thrust, "number") && thrust !== thrust) return;
			const v = (thrust / 100) * (strength / 100);
			const base = 0.4;
			this.soundEffect.send(this.instance.PrimaryPart!, {
				sound: wSound,
				isPlaying: true,
				volume: math.abs(v) * base,
			});
			updateForce(v);

			// also update ring color
			if (colorChanged) {
				for (let i = 0; i < ringCount; i++) {
					if (rings[i]) rings[i].Color = color;
				}
			}
		});

		this.onDisable(() => {
			updateForce(0);
		});
	}
}

const immediate = BlockCreation.immediate(definition, (block: engineModel, config) => {
	for (let i = 0; i < childAmount; i++) Instances.waitForChild(block, "PropRings", `ring${i}`);

	events.init.send({
		block,
		color: BlockCreation.defaultIfWiredUnset(config?.color, definition.input.color.types.color.config),
	});
});

const search = { partialAliases: ["propeller", "gravity"] };
const logic: BlockLogicInfo = { definition, ctor: Logic, immediate };
const list: BlockBuildersWithoutIdAndDefaults = {
	gravipane: {
		displayName: "Gravi Pane",
		description:
			"Basically a bi-directonal magic board that works well in space and not so well in the existing gravity field of the planet",
		logic,
		limit: 50,
		search,
	},
};
export const GraviEngineBlocks = BlockCreation.arrayFromObject(list);
