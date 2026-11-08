import { PerFrame } from "engine/shared/PerFrame";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import type { FireEffect } from "shared/effects/FireEffect";

const definition = {
	input: {
		detectionradius: {
			displayName: "Detection Radius",
			types: {
				number: {
					config: 20,
					clamp: {
						showAsSlider: true,
						min: 1,
						max: 300,
						step: 1,
					},
				},
			},
		},
	},
	output: {
		detected: {
			displayName: "Detected",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

/** Every sensor checks the same burning parts, so each part's position is read once per frame and shared. */
const burningPositions = new PerFrame(() => new Map<BasePart, Vector3>());

export type { Logic as FireSensorBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition> {
	/** Burning parts move, so the distance cannot be settled when the effect arrives — only membership can. */
	private readonly burning = new Set<BasePart>();

	constructor(block: InstanceBlockLogicArgs, @inject fireffect: FireEffect) {
		super(definition, block);

		const detectionRadiusCache = this.initializeInputCache("detectionradius");
		this.event.subscribe(fireffect.event.s2c.invoked, (args) => {
			if (!args.part) return;

			if (args.extinguish) this.burning.delete(args.part);
			else this.burning.add(args.part);
		});

		this.onTicc(() => {
			const detectionRadius = detectionRadiusCache.tryGet();
			if (detectionRadius === undefined) return;

			const origin = this.instance.GetPivot().Position;
			const positions = burningPositions.get();
			let detected = false;

			for (const part of this.burning) {
				// fire destroys what it burns, and a destroyed part never sends an extinguish
				if (part.Parent === undefined) {
					this.burning.delete(part);
					continue;
				}

				if (detected) continue;
				let position = positions.get(part);
				if (!position) {
					position = part.GetPivot().Position;
					positions.set(part, position);
				}
				if (position.sub(origin).Magnitude <= detectionRadius) detected = true;
			}

			this.output.detected.set("bool", detected);
		});
		this.unsetOutputsOnDisable();
	}
}

export const FireSensorBlock = {
	...BlockCreation.defaults,
	id: "firesensor",
	displayName: "Fire Sensor",
	description: "Returns true if fire got detected",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
